import { describe, expect, test } from "vitest";
import { fetchDocument, USER_AGENT } from "../../src/verify/fetch";

const ok = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html", ...headers } });

describe("fetchDocument", () => {
  test("identifies itself with a descriptive User-Agent", async () => {
    let seen: string | null = null;
    await fetchDocument("https://x.test/a", {
      fetchImpl: async (_u, init) => { seen = new Headers(init?.headers).get("user-agent"); return ok("<p>hi</p>"); },
    });
    expect(seen).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/keeper/i);
  });

  test("sends If-None-Match when the cache holds an ETag", async () => {
    let seen: string | null = null;
    await fetchDocument("https://x.test/a", {
      cached: { etag: 'W/"abc"', hash: "h1", text: "old" },
      fetchImpl: async (_u, init) => { seen = new Headers(init?.headers).get("if-none-match"); return ok("<p>hi</p>"); },
    });
    expect(seen).toBe('W/"abc"');
  });

  test("a 304 reuses cached text and reports the document unchanged", async () => {
    const r = await fetchDocument("https://x.test/a", {
      cached: { etag: 'W/"abc"', hash: "h1", text: "cached body" },
      fetchImpl: async () => new Response(null, { status: 304 }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.text).toBe("cached body"); expect(r.changed).toBe(false); }
  });

  test("flags the document as changed when its content hash moves", async () => {
    const r = await fetchDocument("https://x.test/a", {
      cached: { hash: "stale-hash", text: "old" },
      fetchImpl: async () => ok("<p>brand new</p>"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.changed).toBe(true);
  });

  test("retries a 503 and succeeds on the next attempt", async () => {
    let calls = 0;
    const r = await fetchDocument("https://x.test/a", {
      sleep: async () => {},
      fetchImpl: async () => { calls++; return calls === 1 ? new Response("busy", { status: 503 }) : ok("<p>fine</p>"); },
    });
    expect(calls).toBe(2);
    expect(r.ok).toBe(true);
  });

  test("does not retry a 404 — it is unreachable, not flaky", async () => {
    let calls = 0;
    const r = await fetchDocument("https://x.test/a", {
      sleep: async () => {},
      fetchImpl: async () => { calls++; return new Response("gone", { status: 404 }); },
    });
    expect(calls).toBe(1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("404");
  });

  test("gives up after the retry budget and reports the failure", async () => {
    const r = await fetchDocument("https://x.test/a", {
      sleep: async () => {},
      fetchImpl: async () => { throw new Error("ECONNRESET"); },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ECONNRESET");
  });
});
