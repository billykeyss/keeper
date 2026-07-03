import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { loadDatasets } from "../../src/ingest/load";
import type { WaterDataset } from "../../src/ingest/datasetSchema";
import { app } from "../../src/api/server";

afterAll(async () => { await closeDb(); });

type Source = WaterDataset["sources"][number];
type Authority = WaterDataset["authorities"][number];
type Regulation = WaterDataset["regulations"][number];

const src: Source = { key: "s1", url: "https://example.gov/reg", title: "Test Reg", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null };
const cdfw: Authority = { key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] };
const baseReg: Regulation = { ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "7.50", humanSummary: "5/day", verbatimText: "5 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } };

function water(name: string, aliases: string[], counties: string[], lon: number, lat: number): WaterDataset {
  return {
    asOf: "2026-07-01",
    water: { name, waterType: "lake", states: ["CA"], counties, aliases, gnisId: null, lon, lat, verifyCurrent: false },
    authorities: [{ ...cdfw }], reaches: [], species: [], speciesGroups: [],
    sources: [{ ...src }], groups: [], seasonPeriods: [], regulations: [{ ...baseReg }], reciprocity: [],
    stockingEvents: [], stockingSchedule: [],
  };
}

describe("GET /api/waters/search", () => {
  beforeAll(async () => {
    await loadDatasets(db, [
      water("Webber Lake", ["Webber Reservoir"], ["Sierra"], -120.42, 39.48),
      water("Donner Lake", [], ["Nevada"], -120.24, 39.32),
      water("Prosser Creek", [], ["Nevada"], -120.13, 39.37),
    ]);
  });

  it("finds waters by name substring, case-insensitively, with coordinates", async () => {
    const res = await app.request("/api/waters/search?q=webber");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.waters).toHaveLength(1);
    expect(body.waters[0].name).toBe("Webber Lake");
    expect(typeof body.waters[0].lon).toBe("number");
    expect(typeof body.waters[0].lat).toBe("number");
  });

  it("matches aliases and counties too", async () => {
    const byAlias = await (await app.request("/api/waters/search?q=webber%20reservoir")).json();
    expect(byAlias.waters.map((w: any) => w.name)).toEqual(["Webber Lake"]);

    const byCounty = await (await app.request("/api/waters/search?q=sierra")).json();
    expect(byCounty.waters.map((w: any) => w.name)).toContain("Webber Lake");
  });

  it("prefers name matches over alias/county-only matches and caps at 8", async () => {
    const res = await (await app.request("/api/waters/search?q=lake")).json();
    expect(res.waters.length).toBeLessThanOrEqual(8);
    expect(res.waters.map((w: any) => w.name)).toEqual(["Donner Lake", "Webber Lake"]);
  });

  it("400s without a query", async () => {
    expect((await app.request("/api/waters/search")).status).toBe(400);
    expect((await app.request("/api/waters/search?q=")).status).toBe(400);
  });
});
