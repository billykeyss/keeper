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

  it("409s while a turn is in flight, then recovers after it drains", async () => {
    const { runChatTurn } = await import("../../src/chat/agent");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    (runChatTurn as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_text: string, opts: any) => {
      await gate;
      await opts.events.onDelta("slow reply");
      return { text: "slow reply", sdkSessionId: "sdk-slow", costUsd: 0.001 };
    });

    const created = await app.request("/api/chat/sessions", { method: "POST", headers: JSON_HDRS, body: "{}" });
    const { id } = await created.json();

    const first = await app.request(`/api/chat/sessions/${id}/messages`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: "slow one" }),
    });
    expect(first.status).toBe(200); // headers ready; stream still open, in-flight held

    const second = await app.request(`/api/chat/sessions/${id}/messages`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: "too soon" }),
    });
    expect(second.status).toBe(409);

    release();
    await first.text(); // drain the stream — finally releases in-flight

    const third = await app.request(`/api/chat/sessions/${id}/messages`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: "after drain" }),
    });
    expect(third.status).toBe(200);
    await third.text();
  });

  it("retries with a fresh SDK session when resuming a stale one fails", async () => {
    const { runChatTurn } = await import("../../src/chat/agent");

    const created = await app.request("/api/chat/sessions", { method: "POST", headers: JSON_HDRS, body: "{}" });
    const { id } = await created.json();

    // First turn (default mock): succeeds and stores sdkSessionId "sdk-abc".
    const first = await app.request(`/api/chat/sessions/${id}/messages`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: "first turn" }),
    });
    await first.text();
    let [sess] = await db.select().from(chatSession).where(eq(chatSession.id, id));
    expect(sess.sdkSessionId).toBe("sdk-abc");

    // Second turn: the resume attempt dies (stale transcript), the fresh-session retry succeeds.
    (runChatTurn as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () => { throw new Error("No conversation found with session ID sdk-abc"); })
      .mockImplementationOnce(async (_text: string, opts: any) => {
        expect(opts.resumeSessionId).toBeNull(); // retry must NOT resume
        await opts.events.onDelta("fresh reply");
        return { text: "fresh reply", sdkSessionId: "sdk-fresh", costUsd: 0.002 };
      });

    const second = await app.request(`/api/chat/sessions/${id}/messages`, {
      method: "POST", headers: JSON_HDRS, body: JSON.stringify({ text: "second turn" }),
    });
    const frames = parseSSE(await second.text());
    expect(frames.filter((f) => f.event === "delta").map((f) => f.data.text).join("")).toBe("fresh reply");
    expect(frames.some((f) => f.event === "done")).toBe(true);
    expect(frames.some((f) => f.event === "error")).toBe(false);

    [sess] = await db.select().from(chatSession).where(eq(chatSession.id, id));
    expect(sess.sdkSessionId).toBe("sdk-fresh"); // stale id overwritten
  });
});
