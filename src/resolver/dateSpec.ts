import type { DateSpec } from "../params/shared";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const ORDINAL_TO_N: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Resolve a DateSpec to a concrete ISO-8601 date string ("YYYY-MM-DD") for a
 * given regulation year.
 *
 * Handles:
 *  - type="fixed"    → uses spec.month and spec.day directly.
 *  - type="relative" → computes the nth/last <weekday> of <month>, then applies
 *                       spec.offset_days if present.
 *
 * Throws for type="astronomical" and type="year_round" — those are not concrete
 * calendar dates and must be resolved by higher-level season logic elsewhere.
 */
export function resolveDateSpec(spec: DateSpec, year: number): string {
  if (spec.type === "fixed") {
    if (spec.month == null || spec.day == null) {
      throw new Error(`fixed date_spec requires month and day (got month=${spec.month}, day=${spec.day})`);
    }
    return iso(new Date(Date.UTC(year, spec.month - 1, spec.day)));
  }

  if (spec.type === "relative") {
    if (spec.month == null || spec.ordinal == null || spec.weekday == null) {
      throw new Error(
        `relative date_spec requires month, ordinal, and weekday ` +
          `(got month=${spec.month}, ordinal=${spec.ordinal}, weekday=${spec.weekday})`,
      );
    }

    const targetDow = WEEKDAYS.indexOf(spec.weekday); // 0=Sun … 6=Sat

    let base: Date;
    if (spec.ordinal === "last") {
      // Start from the last calendar day of the month and walk back to the target DOW.
      const lastDay = new Date(Date.UTC(year, spec.month, 0)); // day-0 of next month = last day of this month
      const daysBack = (lastDay.getUTCDay() - targetDow + 7) % 7;
      base = new Date(Date.UTC(year, spec.month - 1, lastDay.getUTCDate() - daysBack));
    } else {
      const nthWeek = ORDINAL_TO_N[spec.ordinal];
      if (nthWeek == null) {
        throw new Error(`unsupported ordinal "${spec.ordinal}" — only first/second/third/fourth/last are supported`);
      }
      // Find the first occurrence of targetDow in the month, then advance by (nthWeek-1) weeks.
      const firstOfMonth = new Date(Date.UTC(year, spec.month - 1, 1));
      const daysForward = (targetDow - firstOfMonth.getUTCDay() + 7) % 7;
      base = new Date(Date.UTC(year, spec.month - 1, 1 + daysForward + (nthWeek - 1) * 7));
    }

    if (spec.offset_days) {
      base.setUTCDate(base.getUTCDate() + spec.offset_days);
    }

    return iso(base);
  }

  // astronomical and year_round are not concrete calendar dates; they are
  // handled by higher-level season-materialization logic.
  throw new Error(
    `resolveDateSpec does not handle type="${spec.type}" (astronomical/year_round are resolved elsewhere)`,
  );
}
