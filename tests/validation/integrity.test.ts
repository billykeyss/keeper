import { describe, it, expect } from "vitest";
import { findOverlaps, findSupersessionGaps } from "../../src/validation/integrity";

const base = { ruleType: "bag", status: "published", scopeKey: "water_body:10", speciesKey: "group:trout" };
describe("findOverlaps", () => {
  it("flags two published same-type rules with overlapping scope/species/dates", () => {
    const rows = [
      { id: 1, ...base, validFrom: "2026-01-01", validTo: "2026-12-31" },
      { id: 2, ...base, validFrom: "2026-06-01", validTo: null },
    ];
    expect(findOverlaps(rows).length).toBe(1);
  });
  it("does not flag disjoint date ranges", () => {
    const rows = [
      { id: 1, ...base, validFrom: "2025-01-01", validTo: "2025-12-31" },
      { id: 2, ...base, validFrom: "2026-01-01", validTo: "2026-12-31" },
    ];
    expect(findOverlaps(rows).length).toBe(0);
  });
  it("does not flag different species", () => {
    const rows = [
      { id: 1, ...base, validFrom: "2026-01-01", validTo: null },
      { id: 2, ...base, speciesKey: "group:bass", validFrom: "2026-01-01", validTo: null },
    ];
    expect(findOverlaps(rows).length).toBe(0);
  });

  it("flags a null-start (open-ended) row against a bounded range that intersects it", () => {
    const rows = [
      { id: 1, ...base, validFrom: null, validTo: "2026-12-31" },  // open start
      { id: 2, ...base, validFrom: "2026-06-01", validTo: "2027-06-30" }, // overlaps
    ];
    expect(findOverlaps(rows)).toHaveLength(1);
  });

  it("flags two both-open rows (null validFrom and null validTo)", () => {
    const rows = [
      { id: 1, ...base, validFrom: null, validTo: null },
      { id: 2, ...base, validFrom: null, validTo: null },
    ];
    expect(findOverlaps(rows)).toHaveLength(1);
  });
});

describe("findSupersessionGaps", () => {
  it("detects a gap when next version starts more than one day after previous ends", () => {
    // v1 covers 2025-01-01 to 2025-12-31; v2 starts 2026-06-01 (gap: 2026-01-01 to 2026-05-31)
    const rows = [
      { id: 1, validFrom: "2025-01-01", validTo: "2025-12-31", supersedesId: null },
      { id: 2, validFrom: "2026-06-01", validTo: null, supersedesId: 1 },
    ];
    const gaps = findSupersessionGaps(rows);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].afterId).toBe(1);
    expect(gaps[0].beforeId).toBe(2);
    expect(gaps[0].gapStart).toBe("2026-01-01");
    expect(gaps[0].gapEnd).toBe("2026-05-31");
  });

  it("returns no gaps for a contiguous chain (next starts the day after previous ends)", () => {
    // v1 ends 2025-12-31; v2 starts 2026-01-01 — exactly one day later, no gap
    const rows = [
      { id: 1, validFrom: "2025-01-01", validTo: "2025-12-31", supersedesId: null },
      { id: 2, validFrom: "2026-01-01", validTo: null, supersedesId: 1 },
    ];
    expect(findSupersessionGaps(rows)).toHaveLength(0);
  });
});
