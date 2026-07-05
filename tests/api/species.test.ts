import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { loadDatasets } from "../../src/ingest/load";
import type { WaterDataset } from "../../src/ingest/datasetSchema";
import { app } from "../../src/api/server";

afterAll(async () => { await closeDb(); });

type Source = WaterDataset["sources"][number];
type Authority = WaterDataset["authorities"][number];
type Regulation = WaterDataset["regulations"][number];
type Species = WaterDataset["species"][number];

const src: Source = { key: "s1", url: "https://example.gov/reg", title: "Reg", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null };
const cdfw: Authority = { key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] };
const reg: Regulation = { ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "7.50", humanSummary: "5/day", verbatimText: "5", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } };
const rainbowStocked: Species = { commonName: "Rainbow trout", scientificName: "Oncorhynchus mykiss", category: "trout", nativeStatus: "stocked", presence: "stocked" };
const rainbowNative: Species = { commonName: "Rainbow trout", scientificName: "Oncorhynchus mykiss", category: "trout", nativeStatus: "native", presence: "native" };
const brookNative: Species = { commonName: "Brook trout", scientificName: "Salvelinus fontinalis", category: "char", nativeStatus: "introduced", presence: "introduced" };

function water(name: string, lon: number, lat: number, species: Species[], stockedEvents: WaterDataset["stockingEvents"] = []): WaterDataset {
  return {
    asOf: "2026-07-01",
    water: { name, waterType: "lake", states: ["CA"], counties: ["Placer"], aliases: [], gnisId: null, lon, lat, verifyCurrent: false },
    authorities: [{ ...cdfw }], reaches: [], species, speciesGroups: [],
    sources: [{ ...src }], groups: [], seasonPeriods: [], regulations: [{ ...reg }], reciprocity: [],
    stockingEvents: stockedEvents, stockingSchedule: [],
  };
}

// A: rainbow stocked (present + stocking record). B: rainbow native only (present, not stocked).
// C: brook only.
const waterA = water("Alpha Lake", -120.10, 39.10, [{ ...rainbowStocked }], [
  { speciesCommonName: "Rainbow trout", quantity: 100, sizeNote: null, date: "2026-05-01", sourceKeys: { primary: "s1", corroborating: [] } },
]);
const waterB = water("Beta Lake", -120.20, 39.20, [{ ...rainbowNative }]);
const waterC = water("Gamma Lake", -120.30, 39.30, [{ ...brookNative }]);

describe("species / fish filter API", () => {
  beforeAll(async () => { await loadDatasets(db, [waterA, waterB, waterC]); });

  it("GET /api/species lists all present species with water + stocked counts", async () => {
    const body = await (await app.request("/api/species")).json();
    const rainbow = body.species.find((s: any) => s.commonName === "Rainbow trout");
    const brook = body.species.find((s: any) => s.commonName === "Brook trout");
    expect(rainbow).toEqual({ commonName: "Rainbow trout", waterCount: 2, stockedCount: 1 });
    expect(brook).toEqual({ commonName: "Brook trout", waterCount: 1, stockedCount: 0 });
    // rainbow (2 waters) before brook (1)
    expect(body.species.indexOf(rainbow)).toBeLessThan(body.species.indexOf(brook));
  });

  it("GET /api/species/waters lists waters where a species is present, flagging stocked", async () => {
    const body = await (await app.request("/api/species/waters?name=rainbow%20trout")).json();
    expect(body.waters.map((w: any) => w.name)).toEqual(["Alpha Lake", "Beta Lake"]);
    expect(body.waters.find((w: any) => w.name === "Alpha Lake").stocked).toBe(true);
    expect(body.waters.find((w: any) => w.name === "Beta Lake").stocked).toBe(false);
    expect((await app.request("/api/species/waters")).status).toBe(400);
  });

  it("GET /api/waters honors the present-species filter", async () => {
    const bbox = "bbox=-121,39,-119,40";
    const all = await (await app.request(`/api/waters?${bbox}`)).json();
    expect(all.waters.map((w: any) => w.name).sort()).toEqual(["Alpha Lake", "Beta Lake", "Gamma Lake"]);

    const rainbow = await (await app.request(`/api/waters?${bbox}&species=Rainbow%20trout`)).json();
    expect(rainbow.waters.map((w: any) => w.name).sort()).toEqual(["Alpha Lake", "Beta Lake"]);

    const stockedOnly = await (await app.request(`/api/waters?${bbox}&stocked=Rainbow%20trout`)).json();
    expect(stockedOnly.waters.map((w: any) => w.name)).toEqual(["Alpha Lake"]);
  });
});
