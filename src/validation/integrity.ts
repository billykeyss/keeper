export interface ActiveRule {
  id: number; ruleType: string; status: string; scopeKey: string; speciesKey: string;
  validFrom: string | null; validTo: string | null;
}
const lo = (d: string | null) => (d == null ? -Infinity : Date.parse(d));
const hi = (d: string | null) => (d == null ? Infinity : Date.parse(d));
function rangesOverlap(a: ActiveRule, b: ActiveRule): boolean {
  return lo(a.validFrom) <= hi(b.validTo) && lo(b.validFrom) <= hi(a.validTo);
}
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
