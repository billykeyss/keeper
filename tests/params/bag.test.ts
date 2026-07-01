import { describe, it, expect } from "vitest";
import { bagParams } from "../../src/params/bag";

describe("bagParams", () => {
  it("encodes the Topaz compound bag (25 warmwater, <=5 bass)", () => {
    const v = bagParams.parse({
      daily: 25, possession: 50, unit: "fish", aggregation: "combined_group",
      relationship: "independent",
      sub_limits: [{ target: { species_group: "black_bass" }, mode: "carve_out", max_daily: 5, max_possession: 10 }],
    });
    expect(v.sub_limits?.[0].max_daily).toBe(5);
  });
  it("supports annual limits with reset_basis", () => {
    const v = bagParams.parse({ daily: 1, annual: 3, reset_basis: "calendar_year", unit: "fish", aggregation: "combined_group" });
    expect(v.annual).toBe(3);
  });
});
