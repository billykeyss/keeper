import { describe, it, expect } from "vitest";
import { findOverlaps } from "../../src/validation/integrity";

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
