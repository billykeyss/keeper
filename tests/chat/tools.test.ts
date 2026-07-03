import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { waterBody } from "../../src/db/schema";
import { loadDatasets } from "../../src/ingest/load";
import type { WaterDataset } from "../../src/ingest/datasetSchema";
import { searchWaters, getWaterRules, searchRegulations } from "../../src/chat/tools";

afterAll(async () => { await closeDb(); });

const tahoeish: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Big Blue Lake", waterType: "lake", states: ["CA"], counties: ["Placer"], aliases: ["Old Blue"], gnisId: null, lon: -120.10, lat: 39.10, verifyCurrent: false },
  authorities: [{ key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] }], reaches: [], species: [], speciesGroups: [],
  sources: [{ key: "s1", url: "https://example.gov/reg", title: "Test Reg", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null }], groups: [], seasonPeriods: [],
  regulations: [{ ruleType: "bag", parameters: { daily: 2, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "5.05", humanSummary: "Two-fish night bag", verbatimText: "2 per day at night", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } }],
  reciprocity: [], stockingEvents: [], stockingSchedule: [],
};
const nvWater: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Silver Pond", waterType: "pond", states: ["NV"], counties: ["Washoe"], aliases: [], gnisId: null, lon: -119.80, lat: 39.50, verifyCurrent: false },
  authorities: [{ key: "ndow", name: "Nevada Department of Wildlife", state: "NV", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [{ key: "s2", url: "https://example.gov/nv", title: "NV Reg", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "ndow", retrievedDate: "2026-07-01", quotedText: null }],
  groups: [], seasonPeriods: [],
  regulations: [{ ruleType: "bag", parameters: { daily: 3, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "ndow", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "NV", citation: "NAC 503", humanSummary: "Three-fish night bag", verbatimText: "3 per day at night", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s2", corroborating: [] } }],
  reciprocity: [], stockingEvents: [], stockingSchedule: [],
};

let blueId: number;

describe("chat retrieval tools", () => {
  beforeAll(async () => {
    await loadDatasets(db, [tahoeish, nvWater]);
    const ws = await db.select().from(waterBody);
    blueId = ws.find((w) => w.name === "Big Blue Lake")!.id;
  });

  it("searchWaters matches name, alias, and county case-insensitively", async () => {
    expect((await searchWaters("big blue")).map((w) => w.name)).toEqual(["Big Blue Lake"]);
    expect((await searchWaters("old BLUE")).map((w) => w.name)).toEqual(["Big Blue Lake"]);
    expect((await searchWaters("washoe")).map((w) => w.name)).toEqual(["Silver Pond"]);
    expect(await searchWaters("zzz-nothing")).toEqual([]);
  });

  it("getWaterRules returns the resolved rules JSON with sourceUrls", async () => {
    const body = (await getWaterRules(blueId)) as any;
    expect(body.water.name).toBe("Big Blue Lake");
    const bag = body.scopes[0].rules.find((r: any) => r.ruleType === "bag");
    expect(bag.sourceUrl).toBe("https://example.gov/reg");
    await expect(getWaterRules(99999999)).rejects.toThrow();
  });

  it("searchRegulations finds by keyword and filters by state", async () => {
    const all = await searchRegulations("night bag");
    expect(all.map((r) => r.waterName).sort()).toEqual(["Big Blue Lake", "Silver Pond"]);
    expect(all[0].sourceUrl).toMatch(/^https:\/\/example\.gov\//);
    const nv = await searchRegulations("night bag", "NV");
    expect(nv.map((r) => r.waterName)).toEqual(["Silver Pond"]);
  });
});
