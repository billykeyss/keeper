import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { chatSession, chatMessage } from "../../src/db/schema";

vi.mock("../../src/chat/agent", () => ({
  chatConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY && process.env.KEEPER_PASSWORD),
  runChatTurn: vi.fn(async (_text: string, opts: any) => {
    await opts.events.onTool("mcp__keeper__search_waters");
    await opts.events.onDelta("Hello ");
    await opts.events.onDelta("world.");
    return { text: "Hello world.", sdkSessionId: "sdk-abc", costUsd: 0.012 };
  }),
}));

// import AFTER vi.mock so the route module binds to the mock
import { app } from "../../src/api/server";
import { resetChatLimiter } from "../../src/api/chat";

const HDRS = { "x-keeper-password": "test-pw" };
const JSON_HDRS = { ...HDRS, "content-type": "application/json" };

function parseSSE(raw: string): Array<{ event: string; data: any }> {
  return raw.split("\n\n").filter((f) => f.includes("event:")).map((frame) => {
    const event = /event: (.+)/.exec(frame)![1].trim();
    const dataLine = /data: (.+)/.exec(frame);
    return { event, data: dataLine ? JSON.parse(dataLine[1]) : null };
  });
}

beforeAll(() => {
  process.env.KEEPER_PASSWORD = "test-pw";
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterAll(async () => {
  delete process.env.KEEPER_PASSWORD;
  delete process.env.ANTHROPIC_API_KEY;
  await closeDb();
});
beforeEach(() => resetChatLimiter());

describe("chat API", () => {
  it("503s when chat is not configured", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const res = await app.request("/api/chat/sessions", { method: "POST", headers: JSON_HDRS, body: "{}" });
    expect(res.status).toBe(503);
    process.env.ANTHROPIC_API_KEY = saved;
  });

  it("creates, lists, and reads sessions", async () => {
    const created = await app.request("/api/chat/sessions", { method: "POST", headers: JSON_HDRS, body: "{}" });
    expect(created.status).toBe(201);
    const { id } = await created.json();

    const list = await (await app.request("/api/chat/sessions", { headers: HDRS })).json();
    expect(list.sessions.some((s: any) => s.id === id && s.title === "New chat")).toBe(true);

    const msgs = await (await app.request(`/api/chat/sessions/${id}/messages`, { headers: HDRS })).json();
    expect(msgs.messages).toEqual([]);

    expect((await app.request("/api/chat/sessions/99999999/messages", { headers: HDRS })).status).toBe(404);
  });

  it("streams a turn over SSE and persists both messages + sdk session id", async () => {
    const created = await app.request("/api/chat/sessions", { method: "POST", headers: JSON_HDRS, body: "{}" });
    const { id } = await created.json();

    const res = await app.request(`/api/chat/sessions/${id}/messages`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: "What are the rules at Big Blue Lake?" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = parseSSE(await res.text());
    expect(frames.find((f) => f.event === "tool")?.data).toEqual({ name: "mcp__keeper__search_waters" });
    expect(frames.filter((f) => f.event === "delta").map((f) => f.data.text).join("")).toBe("Hello world.");
    const done = frames.find((f) => f.event === "done");
    expect(done?.data.costUsd).toBe(0.012);

    const stored = await db.select().from(chatMessage).where(eq(chatMessage.sessionId, id));
    expect(stored.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(stored[1].content).toBe("Hello world.");
    const [sess] = await db.select().from(chatSession).where(eq(chatSession.id, id));
    expect(sess.sdkSessionId).toBe("sdk-abc");
    expect(sess.title).toBe("What are the rules at Big Blue Lake?");
  });

  it("rejects oversized messages and rate-limits", async () => {
    const created = await app.request("/api/chat/sessions", { method: "POST", headers: JSON_HDRS, body: "{}" });
    const { id } = await created.json();

    const big = await app.request(`/api/chat/sessions/${id}/messages`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: "x".repeat(2001) }),
    });
    expect(big.status).toBe(400);

    for (let i = 0; i < 10; i++) {
      const r = await app.request(`/api/chat/sessions/${id}/messages`, {
        method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: `q${i}` }),
      });
      expect(r.status).toBe(200);
      await r.text(); // drain
    }
    const eleventh = await app.request(`/api/chat/sessions/${id}/messages`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: "one too many" }),
    });
    expect(eleventh.status).toBe(429);
  });
});
