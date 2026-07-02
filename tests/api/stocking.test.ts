import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { waterBody } from "../../src/db/schema";
import { loadDatasets } from "../../src/ingest/load";
import type { WaterDataset } from "../../src/ingest/datasetSchema";
import { app } from "../../src/api/server";

afterAll(async () => { await closeDb(); });

type Source = WaterDataset["sources"][number];
type Authority = WaterDataset["authorities"][number];
type Regulation = WaterDataset["regulations"][number];
type Species = WaterDataset["species"][number];

const src: Source = { key: "s1", url: "https://example.gov/stocking", title: "Stocking Report", documentType: "webpage", instrumentType: "webpage", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null };
const cdfw: Authority = { key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] };
const baseReg: Regulation = { ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "7.50", humanSummary: "5/day", verbatimText: "5 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } };
const rainbow: Species = { commonName: "Rainbow trout", scientificName: "Oncorhynchus mykiss", category: "trout", nativeStatus: "stocked", presence: "stocked" };
const brown: Species = { commonName: "Brown trout", scientificName: "Salmo trutta", category: "trout", nativeStatus: "stocked", presence: "stocked" };

// Water A: two rainbow events. Water B: rainbow schedule + brown event. Water C: no stocking.
const waterA: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Stocked Lake A", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.10, lat: 39.10, verifyCurrent: false },
  authorities: [{ ...cdfw }], reaches: [], species: [{ ...rainbow }], speciesGroups: [],
  sources: [{ ...src }], groups: [], seasonPeriods: [], regulations: [{ ...baseReg }], reciprocity: [],
  stockingEvents: [
    { speciesCommonName: "Rainbow trout", quantity: 500, sizeNote: null, date: "2026-04-01", sourceKeys: { primary: "s1", corroborating: [] } },
    { speciesCommonName: "Rainbow trout", quantity: 300, sizeNote: null, date: "2026-06-15", sourceKeys: { primary: "s1", corroborating: [] } },
  ],
  stockingSchedule: [],
};
const waterB: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Stocked Lake B", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.20, lat: 39.20, verifyCurrent: false },
  authorities: [{ ...cdfw }], reaches: [], species: [{ ...rainbow }, { ...brown }], speciesGroups: [],
  sources: [{ ...src }], groups: [], seasonPeriods: [], regulations: [{ ...baseReg }], reciprocity: [],
  stockingEvents: [
    { speciesCommonName: "Brown trout", quantity: 100, sizeNote: null, date: "2026-05-01", sourceKeys: { primary: "s1", corroborating: [] } },
  ],
  stockingSchedule: [
    { speciesCommonName: "Rainbow trout", frequency: "seasonal", seasonStartMonth: 4, seasonEndMonth: 9, note: "Stocked through summer.", sourceKeys: { primary: "s1", corroborating: [] } },
  ],
};
const waterC: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Wild Lake C", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.30, lat: 39.30, verifyCurrent: false },
  authorities: [{ ...cdfw }], reaches: [], species: [{ ...rainbow }], speciesGroups: [],
  sources: [{ ...src }], groups: [], seasonPeriods: [], regulations: [{ ...baseReg }], reciprocity: [],
  stockingEvents: [], stockingSchedule: [],
};

describe("stocking browse API", () => {
  beforeAll(async () => { await loadDatasets(db, [waterA, waterB, waterC]); });

  it("GET /api/stocking/species aggregates by common name across waters", async () => {
    const res = await app.request("/api/stocking/species");
    expect(res.status).toBe(200);
    const body = await res.json();
    const rainbowRow = body.species.find((s: any) => s.commonName === "Rainbow trout");
    const brownRow = body.species.find((s: any) => s.commonName === "Brown trout");
    expect(rainbowRow).toEqual({ commonName: "Rainbow trout", watersCount: 2, eventCount: 2, scheduleCount: 1, lastStockedOn: "2026-06-15" });
    expect(brownRow).toEqual({ commonName: "Brown trout", watersCount: 1, eventCount: 1, scheduleCount: 0, lastStockedOn: "2026-05-01" });
    // rainbow (2 waters) sorts before brown (1 water)
    expect(body.species.indexOf(rainbowRow)).toBeLessThan(body.species.indexOf(brownRow));
  });

  it("GET /api/stocking/waters lists waters stocked with a species (case-insensitive)", async () => {
    const res = await app.request("/api/stocking/waters?species=rainbow%20trout");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.waters.map((w: any) => w.name)).toEqual(["Stocked Lake A", "Stocked Lake B"]);
    const a = body.waters.find((w: any) => w.name === "Stocked Lake A");
    expect(a.lastStockedOn).toBe("2026-06-15");
    expect(typeof a.lon).toBe("number");
    const b = body.waters.find((w: any) => w.name === "Stocked Lake B");
    expect(b.lastStockedOn).toBeNull(); // schedule-only for this species
  });

  it("GET /api/stocking/waters without species is a 400", async () => {
    expect((await app.request("/api/stocking/waters")).status).toBe(400);
    expect((await app.request("/api/stocking/waters?species=")).status).toBe(400);
  });

  it("GET /api/waters honors the stocked= filter for pins", async () => {
    const bbox = "bbox=-121,39,-119,40";
    const all = await (await app.request(`/api/waters?${bbox}`)).json();
    expect(all.waters.map((w: any) => w.name).sort()).toEqual(["Stocked Lake A", "Stocked Lake B", "Wild Lake C"]);

    const brownOnly = await (await app.request(`/api/waters?${bbox}&stocked=Brown%20trout`)).json();
    expect(brownOnly.waters.map((w: any) => w.name)).toEqual(["Stocked Lake B"]);

    const rainbowOnly = await (await app.request(`/api/waters?${bbox}&stocked=RAINBOW%20TROUT`)).json();
    expect(rainbowOnly.waters.map((w: any) => w.name).sort()).toEqual(["Stocked Lake A", "Stocked Lake B"]);

    const none = await (await app.request(`/api/waters?${bbox}&stocked=Golden%20trout`)).json();
    expect(none.waters).toEqual([]);
  });
});
