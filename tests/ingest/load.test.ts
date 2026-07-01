import { describe, it, expect, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { regulation, waterBody } from "../../src/db/schema";
import { loadDatasets } from "../../src/ingest/load";
import type { WaterDataset } from "../../src/ingest/datasetSchema";

afterAll(async () => { await closeDb(); });

// Same fixture as Task 2's `minimal` dataset (Donner Lake), typed as WaterDataset.
const ds: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Donner Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.2437, lat: 39.3237, verifyCurrent: false },
  authorities: [{ key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [{ key: "s1", url: "https://example.gov", title: "CCR T14 §7.50", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null }],
  groups: [], seasonPeriods: [],
  regulations: [{ ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "7.50(b)", humanSummary: "5 trout/day", verbatimText: "5 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } }],
  reciprocity: [],
};

describe("loadDatasets", () => {
  it("wipes and reloads idempotently", async () => {
    await loadDatasets(db, [ds]);
    const first = await db.select().from(regulation);
    await loadDatasets(db, [ds]);
    const second = await db.select().from(regulation);
    expect(second.length).toBe(first.length); // no accumulation
    const waters = await db.select().from(waterBody);
    expect(waters).toHaveLength(1);
    expect(waters[0].geom).toBeTruthy();
  });
  it("aborts atomically on an invalid parameters blob", async () => {
    const bad = structuredClone(ds);
    (bad.regulations[0].parameters as any).bogus = 1;
    await expect(loadDatasets(db, [bad])).rejects.toThrow(/bag/);
    const waters = await db.select().from(waterBody); // previous good load still intact
    expect(waters).toHaveLength(1);
  });
});
