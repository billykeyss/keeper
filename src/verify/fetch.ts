import { createHash } from "node:crypto";
import { extractHtml, extractPdf } from "./extract";

export const USER_AGENT =
  "keeper-verify-sources/1.0 (fishing-regulation source re-verification; +https://github.com/billykeyss/keeper)";

export interface CachedDoc {
  etag?: string;
  lastModified?: string;
  hash: string;
  /** Extracted text, so an unchanged document is never re-parsed. */
  text: string;
}

export type FetchOutcome =
  | { ok: true; text: string; hash: string; changed: boolean }
  | { ok: false; error: string };

export interface FetchOptions {
  cached?: CachedDoc;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hashOf = (s: string) => createHash("sha256").update(s).digest("hex");

/** 5xx and 429 are worth another try; 4xx means the document is genuinely gone. */
const isRetryableStatus = (status: number) => status === 429 || status >= 500;

/**
 * Fetch one document and return its extracted text.
 *
 * Conditional on ETag/Last-Modified so an unchanged document costs one 304 and
 * no re-parsing. `changed` reports whether the content hash moved since the last
 * run, which the report surfaces as DOC_CHANGED.
 */
export async function fetchDocument(url: string, opts: FetchOptions = {}): Promise<FetchOutcome> {
  const {
    cached, fetchImpl = fetch, sleep = defaultSleep,
    timeoutMs = 30_000, maxAttempts = 3,
  } = opts;

  const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "*/*" };
  if (cached?.etag) headers["if-none-match"] = cached.etag;
  if (cached?.lastModified) headers["if-modified-since"] = cached.lastModified;

  let lastError = "unknown error";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers, signal: controller.signal, redirect: "follow" });

      if (res.status === 304 && cached) {
        return { ok: true, text: cached.text, hash: cached.hash, changed: false };
      }
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (!isRetryableStatus(res.status)) return { ok: false, error: lastError };
        if (attempt < maxAttempts) { await sleep(500 * 2 ** (attempt - 1)); continue; }
        return { ok: false, error: lastError };
      }

      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      const buf = new Uint8Array(await res.arrayBuffer());
      const looksPdf = type.includes("pdf") || (buf[0] === 0x25 && buf[1] === 0x50); // %P
      const text = looksPdf
        ? await extractPdf(buf)
        : extractHtml(new TextDecoder("utf-8").decode(buf));

      const hash = hashOf(text);
      return { ok: true, text, hash, changed: cached ? cached.hash !== hash : true };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) { await sleep(500 * 2 ** (attempt - 1)); continue; }
      return { ok: false, error: lastError };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: lastError };
}
