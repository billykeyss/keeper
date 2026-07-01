export interface VersionChainRow {
  id: number;
  validFrom: string | null;
  validTo: string | null;
  supersedesId: number | null;
}

export interface SupersessionGap {
  afterId: number;
  beforeId: number;
  gapStart: string;
  gapEnd: string;
}

/**
 * Given the rows of one logical rule's version chain (e.g. all versions sharing the same
 * root regulation id), ordered by ascending validity, detect GAPS — date ranges where no
 * version is active between one version's `validTo` and the next version's `validFrom`.
 *
 * A gap exists when `next.validFrom` is more than one calendar day after `prev.validTo`
 * (i.e. there is at least one day not covered by either version). Open-ended tails
 * (`validTo = null`) and open-start heads (`validFrom = null`) are treated as "forever"
 * in the respective direction, so they can never produce a gap at that boundary.
 *
 * @param rows - Version chain rows ordered by ascending `validFrom` (nulls first).
 * @returns Array of gaps, each identifying the surrounding version ids and the uncovered
 *          date range `[gapStart, gapEnd]` (inclusive, ISO 8601 date strings).
 */
export function findSupersessionGaps(rows: VersionChainRow[]): SupersessionGap[] {
  const gaps: SupersessionGap[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const prev = rows[i];
    const next = rows[i + 1];
    // If prev has an open end (null), there's no gap possible after it.
    if (prev.validTo == null) continue;
    // If next has an open start (null), there's no gap possible before it.
    if (next.validFrom == null) continue;
    const prevTo = new Date(prev.validTo);
    const nextFrom = new Date(next.validFrom);
    // Gap exists if next starts more than one day after prev ends.
    // "One day after" means nextFrom > prevTo + 1 day.
    const dayAfterPrevTo = new Date(prevTo);
    dayAfterPrevTo.setUTCDate(dayAfterPrevTo.getUTCDate() + 1);
    if (nextFrom > dayAfterPrevTo) {
      // gapStart is the day after prevTo; gapEnd is the day before nextFrom.
      const gapStart = new Date(dayAfterPrevTo);
      const gapEnd = new Date(nextFrom);
      gapEnd.setUTCDate(gapEnd.getUTCDate() - 1);
      gaps.push({
        afterId: prev.id,
        beforeId: next.id,
        gapStart: gapStart.toISOString().slice(0, 10),
        gapEnd: gapEnd.toISOString().slice(0, 10),
      });
    }
  }
  return gaps;
}

export interface ActiveRule {
  id: number; ruleType: string; status: string; scopeKey: string; speciesKey: string;
  validFrom: string | null; validTo: string | null;
}
const lo = (d: string | null) => (d == null ? -Infinity : Date.parse(d));
const hi = (d: string | null) => (d == null ? Infinity : Date.parse(d));
function rangesOverlap(a: ActiveRule, b: ActiveRule): boolean {
  return lo(a.validFrom) <= hi(b.validTo) && lo(b.validFrom) <= hi(a.validTo);
}
/**
 * O(n²) overlap detector intended for rows already scoped to one authority/regulation-group
 * context (keep n small). Flags pairs of PUBLISHED rows that share the same ruleType,
 * scopeKey, and speciesKey whose validity ranges overlap. A null validFrom means open-start
 * (−∞) and a null validTo means open-end (+∞).
 */
export function findOverlaps(rows: ActiveRule[]): Array<[number, number]> {
  const pub = rows.filter((r) => r.status === "published");
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pub.length; i++)
    for (let j = i + 1; j < pub.length; j++) {
      const a = pub[i], b = pub[j];
      if (a.ruleType === b.ruleType && a.scopeKey === b.scopeKey && a.speciesKey === b.speciesKey && rangesOverlap(a, b))
        out.push([a.id, b.id]);
    }
  return out;
}
