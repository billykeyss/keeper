/**
 * Canonical text form used for every quote/document comparison.
 *
 * Both sides of a match go through this, so the pipeline never compares raw
 * source text against raw document text. Order matters: NFKC first so ligatures
 * and full-width forms decompose, then the hyphenated-line-break rejoin (which
 * needs the newlines still present), then punctuation folding, and only then
 * whitespace collapsing.
 */
const PUNCT: ReadonlyArray<readonly [RegExp, string]> = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐‑‒–—―−]/g, "-"],
  [/…/g, "..."],
  [/ /g, " "],
];

export function normalize(input: string): string {
  let text = input.normalize("NFKC");
  // A word split across a line break: "regu-\nlations" -> "regulations".
  text = text.replace(/-[ \t]*\r?\n[ \t]*/g, "");
  for (const [pattern, replacement] of PUNCT) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
