import type {
  CandidateRule, PeriodStatus, ReachInfo, ResolvedWater, Scope, ScopeStatus, SerializedRule,
} from "./types.ts";
import { isDateInWindow, windowResolvable } from "./season.ts";

type Params = Record<string, unknown>;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
/** Is `on` a real calendar date in YYYY-MM-DD form (rejects 2026-02-30 style rollovers)? */
export function isValidIsoDate(on: string): boolean {
  if (!isoDate.test(on)) return false;
  const t = Date.parse(on + "T00:00:00Z");
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === on;
}

export const STATUS_LABEL: Record<ScopeStatus, string> = {
  open: "Open",
  catch_and_release: "Catch & release only",
  closed: "Closed",
  unknown: "Check current regulations",
};

interface ResolvedRule {
  ruleType: string;
  summary: string;
  detail: Params;
  citation: string | null;
  sourceUrl: string | null;
  polarity: string;
  confidence: string;
  appliesTo: string;
  species: string[];
  // resolution bookkeeping (stripped before serialization)
  _scopeKey: string; // "water" or `reach:<key>`
  _inForce: boolean; // definitely applies on `on` (not unknown-activity)
  _activePeriodStatuses: PeriodStatus[]; // season statuses this rule contributes on `on`
  _authorityName?: string;
  // season-type rules also carry per-period activeNow annotations
  periods?: Array<{ label: string; status: PeriodStatus; activeNow: boolean }>;
}

/** Whether an active closure rule forces its whole scope to "closed".
 *  Reach-scope closures always close their reach. Water-scope closures close the whole water
 *  ONLY when they are not partial-area ('spatial') closures — spatial buffers around tributary
 *  mouths / swim areas render as informational rule cards without flipping the water to closed.
 *  Fail-closed: any non-spatial water-scoped closure (year_round/seasonal/emergency/…) closes. */
function closureClosesScope(isWaterScope: boolean, params: unknown): boolean {
  if (!isWaterScope) return true;
  const kind = (params as { closure_kind?: string } | null)?.closure_kind;
  return kind !== "spatial";
}

/** Is the rule's validity window [validFrom, validTo] (ISO dates, inclusive) open on `on`? */
function isValidOn(r: CandidateRule, on: string): boolean {
  return (r.validFrom == null || r.validFrom <= on) && (r.validTo == null || r.validTo >= on);
}

function resolveCandidate(r: CandidateRule, on: string): ResolvedRule | null {
  const params = (r.parameters ?? {}) as Params;
  const base: Omit<ResolvedRule, "_inForce" | "_activePeriodStatuses" | "periods"> = {
    ruleType: r.ruleType,
    summary: r.summary,
    detail: params,
    citation: r.citation,
    sourceUrl: r.sourceUrl,
    polarity: r.polarity,
    confidence: r.confidence,
    appliesTo: r.appliesTo,
    species: r.species,
    _scopeKey: r.scopeKey,
    _authorityName: r.authorityName,
  };

  if (r.ruleType === "season") {
    // season-type rules always render (they describe the calendar); annotate activeNow per period.
    const periodsRaw = Array.isArray((params as any).periods) ? (params as any).periods : [];
    const periods = periodsRaw.map((p: any) => {
      const active = windowResolvable(p.start, p.end) ? isDateInWindow(p.start, p.end, on) : false;
      return { label: p.label as string, status: p.status as PeriodStatus, activeNow: active };
    });
    const activeStatuses = periods.filter((p: any) => p.activeNow).map((p: any) => p.status as PeriodStatus);
    return { ...base, _inForce: true, _activePeriodStatuses: activeStatuses, periods };
  }

  if (r.period) {
    const { start, end } = r.period;
    // Unresolvable spec: activity unknown — keep the card, contribute no season evidence.
    if (!windowResolvable(start, end)) return { ...base, _inForce: false, _activePeriodStatuses: [] };
    if (!isDateInWindow(start, end, on)) return null; // resolved and out of window → not in force today
    return { ...base, _inForce: true, _activePeriodStatuses: [r.period.status] };
  }

  // Unbound rule (no season period): always in force (subject to validity, already filtered).
  return { ...base, _inForce: true, _activePeriodStatuses: [] };
}

function deriveStatus(scopeRules: ResolvedRule[], isWaterScope: boolean): ScopeStatus {
  // 1. Active closure that closes this whole scope, or an active "closed" season period.
  for (const rr of scopeRules) {
    if (!rr._inForce) continue;
    if (rr.ruleType === "closure" && closureClosesScope(isWaterScope, rr.detail)) return "closed";
    if (rr._activePeriodStatuses.includes("closed")) return "closed";
  }

  // 2. Collect active season-period evidence for this scope. `_activePeriodStatuses` already
  //    folds in BOTH bound season_period bindings (in-window via isDateInWindow) AND `season`-rule
  //    parameters.periods entries that are active on `on`.
  let hasOpen = false;
  let hasOpenCR = false;
  for (const rr of scopeRules) {
    if (!rr._inForce) continue;
    for (const st of rr._activePeriodStatuses) {
      if (st === "open") hasOpen = true;
      else if (st === "open_catch_release") hasOpenCR = true;
    }
  }

  // 3. An open period exists. Scope status must reflect only bags that could permit harvest in
  //    THIS scope — an unrelated always-in-force catch-and-release protection bag for a different
  //    species (cui-ui at Pyramid, LCT at Independence) must not downgrade a keepable fishery.
  if (hasOpen) {
    const activeBags = scopeRules.filter((rr) => rr._inForce && rr.ruleType === "bag");
    const permitsHarvest = activeBags.some((rr) => {
      if (rr.polarity !== "applies") return false; // asserts_none bags are neutral, not permissive
      if (rr.detail.catch_and_release === true) return false;
      const daily = rr.detail.daily;
      return (typeof daily === "number" && daily > 0) || daily == null;
    });
    if (permitsHarvest) return "open";
    const hasCRBag = activeBags.some(
      (rr) => rr.detail.catch_and_release === true || rr.detail.daily === 0,
    );
    if (hasCRBag) return "catch_and_release";
    return "open"; // open season, no bag rule (or only asserts_none) → open
  }

  // 4. No open period, but an active catch-and-release ("open_catch_release") season period.
  if (hasOpenCR) return "catch_and_release";

  // 5. Nothing resolvable.
  return "unknown";
}

const serialize = (rr: ResolvedRule): SerializedRule => ({
  ruleType: rr.ruleType,
  summary: rr.summary,
  detail: rr.detail,
  citation: rr.citation,
  sourceUrl: rr.sourceUrl,
  polarity: rr.polarity,
  confidence: rr.confidence,
  appliesTo: rr.appliesTo,
  species: rr.species,
  ...(rr.periods ? { periods: rr.periods } : {}),
});

/** Resolve one water's candidate rules into per-scope status + rule cards on date `on`.
 *  `cands` should already be deduped and have exclude-targets removed; validity
 *  (`validFrom`/`validTo`) is applied here. Reaches are emitted in the order given. */
export function resolveWater(
  cands: CandidateRule[],
  reaches: ReachInfo[],
  on: string,
  verifyCurrent: boolean,
): ResolvedWater {
  const resolved: ResolvedRule[] = [];
  for (const c of cands) {
    if (!isValidOn(c, on)) continue;
    const rr = resolveCandidate(c, on);
    if (rr) resolved.push(rr);
  }

  // license rules surface in a dedicated top-level section, not the scope rule cards.
  const licenseRules = resolved.filter((r) => r.ruleType === "license");
  const scopeableRules = resolved.filter((r) => r.ruleType !== "license");

  // --- assemble scopes: water first, then each reach in the given order ---
  // `line` is the traced path when known (few reaches have it); `point` is the always-present
  // representative marker — the map spotlights the line if it has one, else zooms to the point.
  const scopes: Scope[] = [];

  const waterScopeRules = scopeableRules.filter((r) => r._scopeKey === "water");
  const waterStatus = deriveStatus(waterScopeRules, true);
  scopes.push({ scope: "water", kind: "water", reachId: null, line: null, point: null, sublabel: null, status: waterStatus, rules: waterScopeRules.map(serialize) });

  for (const rc of reaches) {
    const scopeRules = scopeableRules.filter((r) => r._scopeKey === `reach:${rc.key}`);
    if (scopeRules.length === 0) continue; // omit reaches with no applicable rules
    const status = deriveStatus(scopeRules, false);
    const sublabel = rc.fromDesc && rc.toDesc ? `${rc.fromDesc} → ${rc.toDesc}` : null;
    const point: [number, number] | null = rc.lon != null && rc.lat != null ? [rc.lon, rc.lat] : null;
    scopes.push({ scope: rc.name ?? `Reach ${rc.key}`, kind: "reach", reachId: rc.key, line: rc.line ?? null, point, sublabel, status, rules: scopeRules.map(serialize) });
  }

  const overall: ScopeStatus = waterStatus;
  return {
    status: { overall, label: STATUS_LABEL[overall], verifyCurrent },
    scopes,
    licenses: licenseRules.map((r) => ({ ...serialize(r), authority: r._authorityName ?? null })),
  };
}
