import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", hellip: "…", deg: "°",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Visible text of an HTML document, without an HTML parser dependency.
 *
 * Deliberately rough: matching happens on normalized token windows, not DOM
 * structure, so tag-accurate parsing buys little here. Tags become spaces so
 * adjacent cells ("<td>a</td><td>b</td>") do not fuse into one token.
 */
export function extractHtml(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  // Fold NBSP into an ordinary space here so extracted text is already clean;
  // normalize() folds any that survive on either side of a comparison.
  return text.replace(/\s+/g, " ").trim();
}

export type Runner = (cmd: string, args: string[]) => Promise<string>;

const defaultRun: Runner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout));
  });

/**
 * Text of a PDF via poppler's `pdftotext -layout`, which preserves the column
 * alignment that regulation tables depend on. No PDF library is added to the
 * repo's dependencies for this.
 */
export async function extractPdf(bytes: Uint8Array, run: Runner = defaultRun): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "keeper-verify-"));
  const pdf = join(dir, "doc.pdf");
  try {
    await writeFile(pdf, bytes);
    return await run("pdftotext", ["-layout", "-enc", "UTF-8", pdf, "-"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
