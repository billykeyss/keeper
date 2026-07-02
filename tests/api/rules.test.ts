import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { waterBody } from "../../src/db/schema";
import { loadDatasets } from "../../src/ingest/load";
import type { WaterDataset } from "../../src/ingest/datasetSchema";
import { app } from "../../src/api/server";

afterAll(async () => { await closeDb(); });

const lastSatApr = { type: "relative", ordinal: "last", weekday: "sat", month: 4, verbatim: "last Sat Apr" } as const;
const nov15 = { type: "fixed", month: 11, day: 15, verbatim: "Nov 15" } as const;
const nov16 = { type: "fixed", month: 11, day: 16, verbatim: "Nov 16" } as const;
const friBeforeLastSatApr = { type: "relative", ordinal: "last", weekday: "sat", month: 4, relation: "preceding", offset_days: -1, verbatim: "Fri preceding last Sat Apr" } as const;
const jan1 = { type: "fixed", month: 1, day: 1, verbatim: "Jan 1" } as const;
const dec31 = { type: "fixed", month: 12, day: 31, verbatim: "Dec 31" } as const;

const src = { key: "s1", url: "https://example.gov/reg", title: "Test Reg", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null } as const;

const water1: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Truckee Test River", waterType: "river", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.18, lat: 39.33, verifyCurrent: false },
  authorities: [
    { key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] },
    { key: "tribe", name: "Test Paiute Tribe", state: null, type: "tribal", roles: ["take_rules", "permit_issuer"] },
  ],
  reaches: [
    { key: "reachA", name: "Reach A", fromDesc: "Dam", toDesc: "Bridge", lon: -120.19, lat: 39.34 },
    { key: "reachB", name: "Reach B", fromDesc: "Bridge", toDesc: "Confluence", lon: -120.17, lat: 39.32 },
  ],
  species: [], speciesGroups: [],
  sources: [{ ...src }],
  groups: [],
  seasonPeriods: [
    { key: "take", groupKey: null, label: "Take season", status: "open", startSpec: lastSatApr, endSpec: nov15 },
    { key: "winter", groupKey: null, label: "Winter season", status: "open", startSpec: nov16, endSpec: friBeforeLastSatApr },
  ],
  regulations: [
    // reach-A bag bound to the take season (daily 2)
    { ruleType: "bag", parameters: { daily: 2, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: "take", authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "reach", reachKey: "reachA" }, appliesToClass: "any", jurisdictionState: "CA", citation: "5.85(take)", humanSummary: "2 trout/day (take season)", verbatimText: "2 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
    // reach-A bag bound to the winter season (daily 0, catch-and-release)
    { ruleType: "bag", parameters: { daily: 0, unit: "fish", aggregation: "combined_group", catch_and_release: true }, groupKey: null, seasonPeriodKey: "winter", authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "reach", reachKey: "reachA" }, appliesToClass: "any", jurisdictionState: "CA", citation: "5.85(winter)", humanSummary: "0 trout, catch-and-release (winter)", verbatimText: "0 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
    // water-scoped unbound gear rule
    { ruleType: "gear_method", parameters: { bait_allowed: true, artificial_only: false, flies_only: false, lures_allowed: true, barbless_required: false, single_hook_required: false }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "2.00", humanSummary: "Any legal gear", verbatimText: "Any gear", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
    // authority_territory license (tribe) — applies via water_body_authority link
    { ruleType: "license", parameters: { required: true, min_age: 12 }, groupKey: null, seasonPeriodKey: null, authorityKey: "tribe", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "authority_territory", authorityKey: "tribe" }, appliesToClass: "non_tribal", jurisdictionState: "CA", citation: "Tribe §20", humanSummary: "Tribal fishing permit required", verbatimText: "Permit required", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
    // asserts_none size limit (water scope)
    { ruleType: "size_limit", parameters: { measurement: "total_length", unit: "inch" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "asserts_none", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "5.85(none)", humanSummary: "No size limit", verbatimText: null, isParaphrase: true, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
    // reach-B year-round closure
    { ruleType: "closure", parameters: { closure_kind: "year_round", boundary_definition: "described" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "reach", reachKey: "reachB" }, appliesToClass: "any", jurisdictionState: "CA", citation: "7.50(closed)", humanSummary: "Closed to fishing all year", verbatimText: "Closed all year", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
  ],
  reciprocity: [],
  stockingEvents: [],
  stockingSchedule: [],
};

const water2: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "No Season Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.30, lat: 39.30, verifyCurrent: true },
  authorities: [{ key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [{ ...src }],
  groups: [], seasonPeriods: [],
  regulations: [
    { ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "7.50(b)", humanSummary: "5 trout/day", verbatimText: "5 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
  ],
  reciprocity: [],
  stockingEvents: [],
  stockingSchedule: [],
};

// water3: an open (year-round) season with a period-bound *keepable* bag for one species PLUS an
// unbound, always-in-force catch-and-release protection bag for a *different* species. The scope
// must read as "open" — the unrelated C&R bag must not downgrade it. (Fails before the fix, which
// downgraded on ANY active catch_and_release bag.)
const water3: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Mixed Bag Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.25, lat: 39.28, verifyCurrent: false },
  authorities: [{ key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [{ ...src }],
  groups: [],
  seasonPeriods: [
    { key: "yr", groupKey: null, label: "All year", status: "open", startSpec: jan1, endSpec: dec31 },
  ],
  regulations: [
    // period-bound keepable bag for species A (daily 2)
    { ruleType: "bag", parameters: { daily: 2, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: "yr", authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "spA", humanSummary: "2 species-A/day (keepable)", verbatimText: "2 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
    // UNBOUND always-in-force catch-and-release protection bag for species B (daily 0)
    { ruleType: "bag", parameters: { daily: 0, unit: "fish", aggregation: "combined_group", catch_and_release: true }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "spB", humanSummary: "0 species-B, catch-and-release (protected)", verbatimText: "0 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
  ],
  reciprocity: [],
  stockingEvents: [],
  stockingSchedule: [],
};

// water4: open season, and the ONLY active bag is catch-and-release → scope stays catch_and_release.
const water4: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Release Only Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.26, lat: 39.27, verifyCurrent: false },
  authorities: [{ key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [{ ...src }],
  groups: [],
  seasonPeriods: [
    { key: "yr", groupKey: null, label: "All year", status: "open", startSpec: jan1, endSpec: dec31 },
  ],
  regulations: [
    { ruleType: "bag", parameters: { daily: 0, unit: "fish", aggregation: "combined_group", catch_and_release: true }, groupKey: null, seasonPeriodKey: "yr", authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "cr", humanSummary: "0/day, catch-and-release only", verbatimText: "0 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
  ],
  reciprocity: [],
  stockingEvents: [],
  stockingSchedule: [],
};

// water5: an open season PLUS a genuine whole-water (non-spatial) closure → closure wins, scope closed.
const water5: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Fully Closed Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.28, lat: 39.25, verifyCurrent: false },
  authorities: [{ key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [{ ...src }],
  groups: [],
  seasonPeriods: [
    { key: "yr", groupKey: null, label: "All year", status: "open", startSpec: jan1, endSpec: dec31 },
  ],
  regulations: [
    { ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: "yr", authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "cr", humanSummary: "5/day", verbatimText: "5 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
    { ruleType: "closure", parameters: { closure_kind: "year_round", boundary_definition: "described", note: "Entire lake closed to all fishing." }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "cr", humanSummary: "Closed to all fishing all year", verbatimText: "Closed to all fishing all year.", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } },
  ],
  reciprocity: [],
  stockingEvents: [],
  stockingSchedule: [],
};

let water1Id: number;
let water2Id: number;
let water3Id: number;
let water4Id: number;
let water5Id: number;

describe("GET /api/waters/:id/rules", () => {
  beforeAll(async () => {
    await loadDatasets(db, [water1, water2, water3, water4, water5]);
    const ws = await db.select().from(waterBody);
    water1Id = ws.find((w) => w.name === "Truckee Test River")!.id;
    water2Id = ws.find((w) => w.name === "No Season Lake")!.id;
    water3Id = ws.find((w) => w.name === "Mixed Bag Lake")!.id;
    water4Id = ws.find((w) => w.name === "Release Only Lake")!.id;
    water5Id = ws.find((w) => w.name === "Fully Closed Lake")!.id;
  });

  it("on 2026-07-01: reach A has the take bag (not winter), closed reach is closed, license + asserts_none render", async () => {
    const res = await app.request(`/api/waters/${water1Id}/rules?on=2026-07-01`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asOf).toBe("2026-07-01");

    const reachA = body.scopes.find((s: any) => s.scope === "Reach A");
    expect(reachA).toBeTruthy();
    expect(reachA.sublabel).toBe("Dam → Bridge");
    const bagDailies = reachA.rules.filter((r: any) => r.ruleType === "bag").map((r: any) => r.detail.daily);
    expect(bagDailies).toContain(2);
    expect(bagDailies).not.toContain(0); // winter bag filtered out
    expect(reachA.status).toBe("open");

    const reachB = body.scopes.find((s: any) => s.scope === "Reach B");
    expect(reachB.status).toBe("closed");

    // territory license surfaces
    expect(body.licenses.some((l: any) => l.ruleType === "license")).toBe(true);

    // asserts_none size limit renders with polarity
    const water = body.scopes.find((s: any) => s.kind === "water");
    const assertsNone = water.rules.find((r: any) => r.ruleType === "size_limit");
    expect(assertsNone.polarity).toBe("asserts_none");
  });

  it("on 2026-01-15: reach A shows the winter C&R bag and its scope is catch_and_release", async () => {
    const res = await app.request(`/api/waters/${water1Id}/rules?on=2026-01-15`);
    const body = await res.json();
    const reachA = body.scopes.find((s: any) => s.scope === "Reach A");
    const bags = reachA.rules.filter((r: any) => r.ruleType === "bag");
    expect(bags.map((r: any) => r.detail.daily)).toContain(0);
    expect(bags.some((r: any) => r.detail.catch_and_release === true)).toBe(true);
    expect(reachA.status).toBe("catch_and_release");
  });

  it("a water with no season data reports overall unknown", async () => {
    const res = await app.request(`/api/waters/${water2Id}/rules?on=2026-07-01`);
    const body = await res.json();
    expect(body.status.overall).toBe("unknown");
    expect(body.status.verifyCurrent).toBe(true);
  });

  it("open season + keepable bag is 'open' even when an unrelated-species C&R bag is in force", async () => {
    const res = await app.request(`/api/waters/${water3Id}/rules?on=2026-07-01`);
    const body = await res.json();
    // both bags surface on the water scope, but the keepable daily-2 bag drives status
    const water = body.scopes.find((s: any) => s.kind === "water");
    const dailies = water.rules.filter((r: any) => r.ruleType === "bag").map((r: any) => r.detail.daily).sort();
    expect(dailies).toEqual([0, 2]);
    expect(water.status).toBe("open");
    expect(body.status.overall).toBe("open");
  });

  it("open season whose only active bag is catch-and-release stays 'catch_and_release'", async () => {
    const res = await app.request(`/api/waters/${water4Id}/rules?on=2026-07-01`);
    const body = await res.json();
    expect(body.status.overall).toBe("catch_and_release");
  });

  it("a genuine whole-water (non-spatial) closure closes the water despite an open season", async () => {
    const res = await app.request(`/api/waters/${water5Id}/rules?on=2026-07-01`);
    const body = await res.json();
    expect(body.status.overall).toBe("closed");
  });

  it("404 for an unknown water id", async () => {
    expect((await app.request(`/api/waters/99999999/rules?on=2026-07-01`)).status).toBe(404);
    expect((await app.request(`/api/waters/not-an-id/rules`)).status).toBe(404);
  });

  it("400 for a malformed date", async () => {
    expect((await app.request(`/api/waters/${water1Id}/rules?on=not-a-date`)).status).toBe(400);
    expect((await app.request(`/api/waters/${water1Id}/rules?on=2026-02-30`)).status).toBe(400);
  });
});
