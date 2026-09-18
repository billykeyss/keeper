import { normalize } from "./normalize";

export type MatchClass = "EXACT" | "PARTIAL" | "MISSING" | "NO_QUOTE";

export interface MatchResult {
  cls: MatchClass;
  /** For MISSING: the passage of the document that came closest, to show in the report. */
  snippet?: string;
}

/** Words too common to count as evidence that a quote is still present. */
const STOPWORDS = new Set([
  "the","a","an","and","or","of","to","in","on","for","is","are","be","by","with",
  "at","as","from","that","this","it","its","all","any","no","not","per","may",
]);

const tokens = (s: string): string[] => s.split(/[^a-z0-9:\-\/]+/i).filter(Boolean);
const isNumeric = (t: string): boolean => /\d/.test(t);
const isContent = (t: string): boolean => !isNumeric(t) && t.length >= 3 && !STOPWORDS.has(t);

/** Fraction of a quote's content words that must appear for a PARTIAL match. */
const CONTENT_THRESHOLD = 0.6;

/**
 * Classify whether `quotedText` is still supported by the current document.
 *
 * EXACT   - the normalized quote is present verbatim.
 * PARTIAL - not verbatim, but every numeric token and most content words appear
 *           within a single window. Composite quotes stitched from table rows
 *           land here; they are never evidence of a changed regulation.
 * MISSING - fetched fine, but the quote is not supported. This is the signal
 *           that a rule may actually have changed.
 */
export function classifyQuote(quotedText: string | null, documentText: string): MatchResult {
  if (quotedText === null) return { cls: "NO_QUOTE" };

  const quote = normalize(quotedText);
  const doc = normalize(documentText);
  if (quote.length === 0) return { cls: "NO_QUOTE" };
  if (doc.includes(quote)) return { cls: "EXACT" };

  const qTokens = tokens(quote);
  const numerics = qTokens.filter(isNumeric);
  const content = qTokens.filter(isContent);

  // Every number must survive. A changed limit or date is exactly what we must catch.
  const docTokens = new Set(tokens(doc));
  const allNumbersPresent = numerics.every((n) => docTokens.has(n));

  if (allNumbersPresent) {
    const present = content.filter((w) => docTokens.has(w)).length;
    const ratio = content.length === 0 ? 1 : present / content.length;
    if (ratio >= CONTENT_THRESHOLD) return { cls: "PARTIAL" };
  }

  return { cls: "MISSING", snippet: closestSnippet(quote, doc) };
}

/**
 * The window of `doc` sharing the most tokens with the quote, so a reviewer can
 * see what the page says now without refetching it.
 */
function closestSnippet(quote: string, doc: string, width = 200): string | undefined {
  if (doc.length === 0) return undefined;
  const wanted = new Set(tokens(quote).filter((t) => isNumeric(t) || isContent(t)));
  if (wanted.size === 0) return doc.slice(0, width);

  const step = Math.max(1, Math.floor(width / 4));
  let best = doc.slice(0, width);
  let bestScore = -1;
  for (let start = 0; start < doc.length; start += step) {
    const window = doc.slice(start, start + width);
    let score = 0;
    for (const t of new Set(tokens(window))) if (wanted.has(t)) score++;
    if (score > bestScore) { bestScore = score; best = window; }
  }
  return best;
}
