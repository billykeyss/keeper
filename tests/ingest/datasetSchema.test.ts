import { describe, it, expect } from "vitest";
import { waterDataset } from "../../src/ingest/datasetSchema";

const minimal = {
  asOf: "2026-07-01",
  water: { name: "Donner Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.2437, lat: 39.3237, verifyCurrent: false },
  authorities: [{ key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [{ key: "s1", url: "https://example.gov", title: "CCR T14 §7.50", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null }],
  groups: [], seasonPeriods: [],
  regulations: [{ ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "7.50(b)", humanSummary: "5 trout/day", verbatimText: "5 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } }],
  reciprocity: [],
};

describe("waterDataset schema", () => {
  it("accepts a minimal valid dataset", () => {
    expect(waterDataset.parse(minimal).water.name).toBe("Donner Lake");
  });
  it("rejects an unknown source key reference shape and unknown fields", () => {
    expect(() => waterDataset.parse({ ...minimal, bogus: 1 })).toThrow();
  });
  it("rejects a listed regulation without species targets", () => {
    const bad = structuredClone(minimal);
    (bad.regulations[0] as any).speciesScope = "listed";
    expect(() => waterDataset.parse(bad)).toThrow(/listed/);
  });

  it("accepts a dataset with stocking events and schedule, defaults both to [] when absent", () => {
    const withStocking = {
      ...minimal,
      stockingEvents: [{ speciesCommonName: "Rainbow trout", quantity: 1500, sizeNote: "9.5 in", date: "2026-05-14", sourceKeys: { primary: "s1", corroborating: [] } }],
      stockingSchedule: [{ speciesCommonName: "Rainbow trout", frequency: "seasonal", seasonStartMonth: 4, seasonEndMonth: 9, note: "Stocked biweekly through the summer season.", sourceKeys: { primary: "s1", corroborating: [] } }],
    };
    const parsed = waterDataset.parse(withStocking);
    expect(parsed.stockingEvents).toHaveLength(1);
    expect(parsed.stockingSchedule).toHaveLength(1);

    const withoutStocking = waterDataset.parse(minimal);
    expect(withoutStocking.stockingEvents).toEqual([]);
    expect(withoutStocking.stockingSchedule).toEqual([]);
  });

  it("rejects a stocking event with a malformed date", () => {
    const bad = { ...minimal, stockingEvents: [{ speciesCommonName: "Rainbow trout", quantity: 100, sizeNote: null, date: "05-14-2026", sourceKeys: { primary: "s1", corroborating: [] } }] };
    expect(() => waterDataset.parse(bad)).toThrow();
  });

  it("rejects a stocking schedule with an invalid frequency", () => {
    const bad = { ...minimal, stockingSchedule: [{ speciesCommonName: "Rainbow trout", frequency: "daily", seasonStartMonth: null, seasonEndMonth: null, note: "x", sourceKeys: { primary: "s1", corroborating: [] } }] };
    expect(() => waterDataset.parse(bad)).toThrow();
  });
});
