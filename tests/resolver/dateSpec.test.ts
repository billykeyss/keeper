import { describe, it, expect } from "vitest";
import { resolveDateSpec } from "../../src/resolver/dateSpec";

describe("resolveDateSpec", () => {
  // ── Plan-specified cases ─────────────────────────────────────────────────

  it("fixed month/day", () => {
    expect(resolveDateSpec({ type: "fixed", month: 11, day: 15, verbatim: "Nov 15" }, 2026)).toBe("2026-11-15");
  });

  it("last Saturday in April 2026 = 2026-04-25", () => {
    expect(
      resolveDateSpec({ type: "relative", ordinal: "last", weekday: "sat", month: 4, verbatim: "last Sat Apr" }, 2026),
    ).toBe("2026-04-25");
  });

  it("Friday preceding the last Saturday in April 2026 = 2026-04-24", () => {
    expect(
      resolveDateSpec(
        { type: "relative", ordinal: "last", weekday: "sat", month: 4, relation: "preceding", offset_days: -1, verbatim: "Fri before" },
        2026,
      ),
    ).toBe("2026-04-24");
  });

  // ── Extended coverage ────────────────────────────────────────────────────

  // First weekday of a month: first Monday in September 2026
  // Sep 1, 2026 is a Tuesday → first Monday is Sep 7.
  it("first Monday in September 2026 = 2026-09-07", () => {
    expect(
      resolveDateSpec({ type: "relative", ordinal: "first", weekday: "mon", month: 9, verbatim: "first Mon Sep" }, 2026),
    ).toBe("2026-09-07");
  });

  // Fourth ordinal: fourth Thursday in November 2026 (Thanksgiving)
  // Nov 1, 2026 is a Sunday → first Thursday is Nov 5 → fourth is Nov 26.
  it("fourth Thursday in November 2026 = 2026-11-26", () => {
    expect(
      resolveDateSpec({ type: "relative", ordinal: "fourth", weekday: "thu", month: 11, verbatim: "fourth Thu Nov" }, 2026),
    ).toBe("2026-11-26");
  });

  // Fixed date that falls one day before a relative date across a month boundary:
  // first Saturday in May 2026 = May 2 (May 1 is a Friday), so day before = April 30.
  it("fixed April 30 2026 (day before first Saturday in May) = 2026-04-30", () => {
    expect(resolveDateSpec({ type: "fixed", month: 4, day: 30, verbatim: "Apr 30" }, 2026)).toBe("2026-04-30");
  });

  // Unsupported types must throw — these are resolved elsewhere per spec
  it("astronomical type throws", () => {
    expect(() =>
      resolveDateSpec({ type: "astronomical", verbatim: "spring equinox" }, 2026),
    ).toThrow(/astronomical|year_round|elsewhere/i);
  });

  it("year_round type throws", () => {
    expect(() =>
      resolveDateSpec({ type: "year_round", verbatim: "All year" }, 2026),
    ).toThrow(/astronomical|year_round|elsewhere/i);
  });
});
