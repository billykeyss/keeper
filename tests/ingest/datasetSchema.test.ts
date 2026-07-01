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
});
