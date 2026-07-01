import { describe, it, expect } from "vitest";
import { isDateInWindow } from "../../src/api/season";

const lastSatApr = { type: "relative", ordinal: "last", weekday: "sat", month: 4, verbatim: "last Sat Apr" } as const;
const nov15 = { type: "fixed", month: 11, day: 15, verbatim: "Nov 15" } as const;
const nov16 = { type: "fixed", month: 11, day: 16, verbatim: "Nov 16" } as const;
const friBefore = { ...lastSatApr, relation: "preceding", offset_days: -1, verbatim: "Fri preceding" } as const;
const yearRound = { type: "year_round", verbatim: "All year" } as const;

describe("isDateInWindow", () => {
  it("in-year window", () => {
    expect(isDateInWindow(lastSatApr, nov15, "2026-07-01")).toBe(true); // Apr 25 – Nov 15
    expect(isDateInWindow(lastSatApr, nov15, "2026-12-01")).toBe(false);
    expect(isDateInWindow(lastSatApr, nov15, "2026-01-15")).toBe(false);
  });
  it("cross-year window (winter season)", () => {
    expect(isDateInWindow(nov16, friBefore, "2026-01-15")).toBe(true); // Nov 16 2025 → Apr 24 2026
    expect(isDateInWindow(nov16, friBefore, "2026-12-01")).toBe(true); // Nov 16 2026 → Apr 2027
    expect(isDateInWindow(nov16, friBefore, "2026-07-01")).toBe(false);
  });
  it("year_round is always open", () => {
    expect(isDateInWindow(yearRound, yearRound, "2026-02-30" as any)).toBe(false); // invalid date → false
    expect(isDateInWindow(yearRound, yearRound, "2026-02-10")).toBe(true);
  });
  it("rejects malformed dates", () => {
    expect(isDateInWindow(lastSatApr, nov15, "not-a-date")).toBe(false);
    expect(isDateInWindow(lastSatApr, nov15, "2026-13-01")).toBe(false);
  });
});
