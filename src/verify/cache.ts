import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CachedDoc } from "./fetch";

/** Gitignored; holds conditional-request metadata and extracted text per URL. */
export const CACHE_DIR = ".cache/verify";

const fileFor = (dir: string, url: string) =>
  join(dir, `${createHash("sha256").update(url).digest("hex")}.json`);

export async function readCache(url: string, dir = CACHE_DIR): Promise<CachedDoc | undefined> {
  try {
    const raw = await readFile(fileFor(dir, url), "utf8");
    const parsed = JSON.parse(raw) as CachedDoc;
    return typeof parsed?.hash === "string" && typeof parsed?.text === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function writeCache(url: string, doc: CachedDoc, dir = CACHE_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(fileFor(dir, url), JSON.stringify({ url, ...doc, fetchedAt: new Date().toISOString() }), "utf8");
}
