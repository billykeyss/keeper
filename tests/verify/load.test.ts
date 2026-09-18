import { describe, expect, test } from "vitest";
import { indexWaterFile } from "../../src/verify/load";

const source = (key: string, over: Record<string, unknown> = {}) => ({
  key, url: `https://example.org/${key}`, title: `Source ${key}`,
  documentType: "pdf", instrumentType: "commission_reg",
  authorityLevel: "primary_regulatory", authorityKey: "ndow",
  retrievedDate: "2026-07-01", quotedText: "Open year around", ...over,
});

const regulation = (over: Record<string, unknown> = {}) => ({
  ruleType: "season", parameters: {}, groupKey: null, seasonPeriodKey: null,
  authorityKey: "ndow", rulePolarity: "applies", speciesScope: "all",
  speciesTargets: [], scope: { type: "water" }, appliesToClass: "any",
  jurisdictionState: "NV", citation: "NBWC CR 25-16", humanSummary: "Open year-round.",
  verbatimText: "Open year around", isParaphrase: false, confidence: "high",
  sourceKeys: { primary: "s_primary", corroborating: ["s_corrob"] }, ...over,
});

const dataset = (over: Record<string, unknown> = {}) => ({
  asOf: "2026-07-01",
  water: { name: "Battle Born Pond", waterType: "pond", states: ["NV"], counties: ["Washoe"],
           aliases: [], gnisId: null, lon: -119.711, lat: 39.609, verifyCurrent: false },
  authorities: [{ key: "ndow", name: "NDOW", state: "NV", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [source("s_primary"), source("s_corrob"), source("s_orphan")],
  groups: [], seasonPeriods: [], regulations: [regulation()], reciprocity: [], ...over,
});

describe("indexWaterFile", () => {
  test("assigns primary, corroborating and unreferenced roles from sourceKeys", () => {
    const { entries } = indexWaterFile("data/corridor/x.json", dataset());
    const role = (k: string) => entries.find((e) => e.key === k)?.role;
    expect(role("s_primary")).toBe("primary");
    expect(role("s_corrob")).toBe("corroborating");
    expect(role("s_orphan")).toBe("unreferenced");
  });

  test("primary wins when a source is cited both ways", () => {
    const d = dataset({ regulations: [regulation({ sourceKeys: { primary: "s_corrob", corroborating: [] } }), regulation()] });
    const { entries } = indexWaterFile("data/corridor/x.json", d);
    expect(entries.find((e) => e.key === "s_corrob")?.role).toBe("primary");
  });

  test("collects the citations of every regulation that cites a source", () => {
    const { entries } = indexWaterFile("data/corridor/x.json", dataset());
    expect(entries.find((e) => e.key === "s_primary")?.citations).toEqual(["NBWC CR 25-16"]);
  });

  test("a file failing the schema is itself a finding, with no entries", () => {
    const { entries, error } = indexWaterFile("data/corridor/bad.json", { asOf: "nope" });
    expect(entries).toEqual([]);
    expect(error).toBeDefined();
  });

  test("an authorityKey not declared in authorities is a finding — this broke re-ingest in July", () => {
    const d = dataset({ sources: [source("s_primary", { authorityKey: "cdfw" }), source("s_corrob")] });
    const { undeclaredAuthorityKeys } = indexWaterFile("data/corridor/x.json", d);
    expect(undeclaredAuthorityKeys).toContain("cdfw");
  });

  test("declared authority keys are not reported", () => {
    const { undeclaredAuthorityKeys } = indexWaterFile("data/corridor/x.json", dataset());
    expect(undeclaredAuthorityKeys).toEqual([]);
  });
});
