// Pure, dependency-free types for the rules engine. This directory must import nothing outside
// itself (no zod, drizzle, ../params, ../db) so it can be copied verbatim into other runtimes.

/** Structural copy of `z.infer<typeof dateSpec>` from `src/params/shared.ts`. Keep in sync. */
export interface DateSpec {
  type: "fixed" | "relative" | "astronomical" | "year_round";
  month?: number;
  day?: number;
  ordinal?: "first" | "second" | "third" | "fourth" | "last" | "nth";
  weekday?: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  relation?: "on" | "preceding" | "following";
  offset_days?: number;
  anchor_holiday?: string;
  anchor?: "sunrise" | "sunset";
  offset_minutes?: number;
  verbatim: string;
}

export type ScopeStatus = "open" | "catch_and_release" | "closed" | "unknown";

/** A single active period status contributed by a rule that is in force on a date. */
export type PeriodStatus = "open" | "closed" | "open_catch_release";

/** One regulation that targets this water (directly, via a reach, or via an authority territory). */
export interface CandidateRule {
  regId: number;
  ruleType: string;
  parameters: Record<string, unknown>;
  polarity: string;
  confidence: string;
  appliesTo: string;
  citation: string | null;
  summary: string;
  sourceUrl: string | null;
  species: string[];
  scopeKey: "water" | `reach:${string}`;
  /** Bound season period, present only when the regulation has one with both ends set. */
  period: { status: PeriodStatus; start: DateSpec; end: DateSpec } | null;
  /** ISO dates (inclusive); null = unbounded. */
  validFrom: string | null;
  validTo: string | null;
  authorityName?: string;
}

export interface ReachInfo {
  key: string;
  name: string | null;
  fromDesc: string | null;
  toDesc: string | null;
  lon: number | null;
  lat: number | null;
  line: [number, number][] | null;
}

export interface SerializedRule {
  ruleType: string;
  summary: string;
  detail: Record<string, unknown>;
  citation: string | null;
  sourceUrl: string | null;
  polarity: string;
  confidence: string;
  appliesTo: string;
  species: string[];
  periods?: Array<{ label: string; status: PeriodStatus; activeNow: boolean }>;
}

export interface Scope {
  scope: string;
  kind: "water" | "reach";
  /** The reach's `key` (null for the water scope). */
  reachId: string | null;
  line: [number, number][] | null;
  point: [number, number] | null;
  sublabel: string | null;
  status: ScopeStatus;
  rules: SerializedRule[];
}

export type SerializedLicense = SerializedRule & { authority: string | null };

export interface ResolvedWater {
  status: { overall: ScopeStatus; label: string; verifyCurrent: boolean };
  scopes: Scope[];
  licenses: SerializedLicense[];
}
