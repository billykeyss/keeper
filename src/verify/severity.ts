import type { MatchClass } from "./match";

/** A source's outcome: how its quote matched, plus the fetch-level failure case. */
export type FindingClass = MatchClass | "UNREACHABLE";

/** How a source is cited by the regulations in its file. */
export type SourceRole = "primary" | "corroborating" | "unreferenced";

export type Severity = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface SeverityInput {
  cls: FindingClass;
  instrumentType: string;
  role: SourceRole;
  /** From the source row; "third_party" marks a mirror rather than the issuing authority. */
  authorityLevel?: string;
}

/**
 * Only MISSING and UNREACHABLE are actionable; everything else is NONE.
 *
 * `webpage` short-circuits to LOW even when primary: those pages (NDOW stocking
 * tables and the like) are rewritten on a weekly cadence by design, so treating
 * their drift as urgent would bury the real signal every single run.
 *
 * `third_party` is capped below HIGH for the same reason. Aggregators such as
 * justia and findlaw answer 403 to any non-browser client, so a mirror being
 * unreadable is a citation-quality issue, not evidence the law moved. The
 * issuing authority's own copy is what can escalate.
 */
export function severityFor({ cls, instrumentType, role, authorityLevel }: SeverityInput): Severity {
  if (cls !== "MISSING" && cls !== "UNREACHABLE") return "NONE";
  if (instrumentType === "webpage") return "LOW";
  if (authorityLevel === "third_party") return "MEDIUM";
  return role === "primary" ? "HIGH" : "MEDIUM";
}
