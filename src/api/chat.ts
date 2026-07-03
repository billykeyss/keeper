import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { chatSession, chatMessage } from "../db/schema";
import { runChatTurn, chatConfigured } from "../chat/agent";

export const chat = new Hono();

// --- simple in-memory limits (single-process server) ---
const WINDOW_MS = 60_000;
const PER_IP_MAX = 10;
const GLOBAL_MAX = 30;
let sends: Array<{ ip: string; at: number }> = [];
const inFlight = new Set<number>();

/** Test hook: clear rate-limit + in-flight state between tests. */
export function resetChatLimiter(): void {
  sends = [];
  inFlight.clear();
}

function overLimit(ip: string): boolean {
  const cutoff = Date.now() - WINDOW_MS;
  sends = sends.filter((s) => s.at > cutoff);
  if (sends.length >= GLOBAL_MAX) return true;
  return sends.filter((s) => s.ip === ip).length >= PER_IP_MAX;
}

const messageBody = z.object({ text: z.string().min(1).max(2000) });

chat.use("/api/chat/*", async (c, next) => {
  if (!chatConfigured()) return c.json({ error: "chat not configured" }, 503);
  return next();
});

chat.post("/api/chat/sessions", async (c) => {
  const [row] = await db.insert(chatSession).values({ title: "New chat" }).returning();
  return c.json({ id: row.id, title: row.title }, 201);
});

chat.get("/api/chat/sessions", async (c) => {
  const rows = await db
    .select({
      id: chatSession.id,
      title: chatSession.title,
      updatedAt: chatSession.updatedAt,
      messageCount: sql<number>`(select count(*)::int from chat_message m where m.session_id = ${chatSession.id})`,
    })
    .from(chatSession)
    .orderBy(desc(chatSession.updatedAt));
  return c.json({ sessions: rows });
});

chat.get("/api/chat/sessions/:id/messages", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "unknown session" }, 404);
  const [sess] = await db.select().from(chatSession).where(eq(chatSession.id, id));
  if (!sess) return c.json({ error: "unknown session" }, 404);
  const rows = await db
    .select({ id: chatMessage.id, role: chatMessage.role, content: chatMessage.content, createdAt: chatMessage.createdAt })
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, id))
    .orderBy(chatMessage.id);
  return c.json({ messages: rows });
});

chat.post("/api/chat/sessions/:id/messages", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "unknown session" }, 404);
  const [sess] = await db.select().from(chatSession).where(eq(chatSession.id, id));
  if (!sess) return c.json({ error: "unknown session" }, 404);

  const parsed = messageBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "text is required (max 2000 chars)" }, 400);
  const { text } = parsed.data;

  // CF-Connecting-IP is set authoritatively by the Cloudflare tunnel in front of the
  // public deployment; X-Forwarded-For's first hop is client-forgeable, so it's only a
  // fallback. Direct LAN/localhost access has neither and shares the "local" bucket —
  // acceptable for password-holders; the global cap backstops everything.
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local";
  if (overLimit(ip)) return c.json({ error: "rate limit exceeded — slow down" }, 429);
  if (inFlight.has(id)) return c.json({ error: "a reply is already in progress for this session" }, 409);
  sends.push({ ip, at: Date.now() });
  inFlight.add(id);

  try {
    await db.insert(chatMessage).values({ sessionId: id, role: "user", content: text });
    if (sess.title === "New chat") {
      await db.update(chatSession).set({ title: text.slice(0, 60) }).where(eq(chatSession.id, id));
    }
  } catch (e) {
    inFlight.delete(id);
    console.error("[chat] failed to persist user message:", e);
    return c.json({ error: "failed to save your message — try again" }, 500);
  }

  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    stream.onAbort(() => ac.abort());
    try {
      const events = {
        onTool: async (name: string) => { await stream.writeSSE({ event: "tool", data: JSON.stringify({ name }) }); },
        onDelta: async (t: string) => { await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: t }) }); },
      };
      let result;
      try {
        result = await runChatTurn(text, { resumeSessionId: sess.sdkSessionId, abortController: ac, events });
      } catch (e) {
        // A stored SDK session can go stale (transcript cleanup, repo move) — per the
        // design spec, degrade transparently: retry once as a fresh session and let the
        // success path overwrite the stored id. Resume failures happen at subprocess
        // init, before any deltas stream, so a retry can't duplicate output.
        if (!sess.sdkSessionId || ac.signal.aborted) throw e;
        console.warn("[chat] resume failed — retrying with a fresh SDK session:", e);
        result = await runChatTurn(text, { resumeSessionId: null, abortController: ac, events });
      }
      const saved = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(chatMessage)
          .values({ sessionId: id, role: "assistant", content: result.text })
          .returning();
        await tx
          .update(chatSession)
          .set({ sdkSessionId: result.sdkSessionId, updatedAt: new Date() })
          .where(eq(chatSession.id, id));
        return row;
      });
      await stream.writeSSE({ event: "done", data: JSON.stringify({ messageId: saved.id, costUsd: result.costUsd }) });
    } catch (e) {
      console.error("[chat] turn error:", e);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ message: "Something went wrong answering that — try again." }) });
    } finally {
      inFlight.delete(id);
    }
  });
});
