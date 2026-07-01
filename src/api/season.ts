import type { DateSpec } from "../params/shared";
import { resolveDateSpec } from "../resolver/dateSpec";

/** Is `on` (YYYY-MM-DD) inside the recurring window [start, end]?
 *  Handles year_round and windows spanning the calendar-year boundary by testing the
 *  window anchored at both `year` and `year - 1`. Invalid dates return false. */
export function isDateInWindow(start: DateSpec, end: DateSpec, on: string): boolean {
  const t = Date.parse(on + "T00:00:00Z");
  if (Number.isNaN(t)) return false;
  const d = new Date(t);
  if (d.toISOString().slice(0, 10) !== on) return false; // reject 2026-02-30 style rollovers
  if (start.type === "year_round" || end.type === "year_round") return true;
  const year = d.getUTCFullYear();
  for (const y of [year, year - 1]) {
    try {
      const s = Date.parse(resolveDateSpec(start, y) + "T00:00:00Z");
      let e = Date.parse(resolveDateSpec(end, y) + "T00:00:00Z");
      if (e < s) e = Date.parse(resolveDateSpec(end, y + 1) + "T00:00:00Z"); // spans boundary
      if (t >= s && t <= e) return true;
    } catch { /* unresolvable spec (astronomical) → skip */ }
  }
  return false;
}

/** Can both ends of a window be resolved to concrete dates (year_round counts as resolvable)?
 *  When false, a season binding's activity on a given date is *unknown* — callers must not
 *  filter the rule out nor treat it as open/closed (see rules resolution, critical semantics). */
export function windowResolvable(start: DateSpec, end: DateSpec): boolean {
  const ok = (s: DateSpec): boolean => {
    if (s.type === "year_round") return true;
    try { resolveDateSpec(s, 2000); return true; } catch { return false; }
  };
  return ok(start) && ok(end);
}
