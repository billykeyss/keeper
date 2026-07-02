import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { loadDatasets } from "../../src/ingest/load";
import type { WaterDataset } from "../../src/ingest/datasetSchema";
import { app } from "../../src/api/server";

afterAll(async () => { await closeDb(); });

// Task 2 `minimal` fixture — Donner Lake at -120.2437, 39.3237.
const fixture: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Donner Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.2437, lat: 39.3237, verifyCurrent: false },
  authorities: [{ key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [{ key: "s1", url: "https://example.gov", title: "CCR T14 §7.50", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null }],
  groups: [], seasonPeriods: [],
  regulations: [{ ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "7.50(b)", humanSummary: "5 trout/day", verbatimText: "5 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } }],
  reciprocity: [],
  stockingEvents: [],
  stockingSchedule: [],
};

describe("GET /api/waters", () => {
  beforeAll(async () => { await loadDatasets(db, [fixture]); });

  it("returns waters inside the bbox with lon/lat", async () => {
    const res = await app.request("/api/waters?bbox=-120.5,39.2,-120.0,39.5");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.waters).toHaveLength(1);
    expect(body.waters[0]).toMatchObject({ name: "Donner Lake", waterType: "lake", lon: expect.closeTo(-120.2437, 3), lat: expect.closeTo(39.3237, 3) });
    expect(body.waters[0].states).toEqual(["CA"]);
    expect(body.waters[0].verifyCurrent).toBe(false);
    expect(body.waters[0].ruleCount).toBeGreaterThan(0);
  });

  it("excludes waters outside the bbox", async () => {
    const res = await app.request("/api/waters?bbox=-119.9,39.2,-119.5,39.5");
    expect((await res.json()).waters).toHaveLength(0);
  });

  it("400s on malformed bbox", async () => {
    expect((await app.request("/api/waters?bbox=nope")).status).toBe(400);
    expect((await app.request("/api/waters?bbox=-120.5,39.2,-120.0")).status).toBe(400);
    expect((await app.request("/api/waters")).status).toBe(400);
    expect((await app.request("/api/waters?bbox=-120.0,39.2,-120.5,39.5")).status).toBe(400); // minLon >= maxLon
  });
});
