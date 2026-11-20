import { describe, it, expect } from "vitest";
import { resolveWater, type CandidateRule, type DateSpec, type ReachInfo } from "../../src/resolve/index.ts";

const jan1: DateSpec = { type: "fixed", month: 1, day: 1, verbatim: "Jan 1" };
const dec31: DateSpec = { type: "fixed", month: 12, day: 31, verbatim: "Dec 31" };
const astro: DateSpec = { type: "astronomical", anchor: "sunrise", verbatim: "first full moon" };

const ON = "2026-07-01";

let nextId = 1;
function rule(over: Partial<CandidateRule> = {}): CandidateRule {
  return {
    regId: nextId++,
    ruleType: "bag",
    parameters: {},
    polarity: "applies",
    confidence: "high",
    appliesTo: "all",
    citation: null,
    summary: "rule",
    sourceUrl: null,
    species: [],
    scopeKey: "water",
    period: null,
    validFrom: null,
    validTo: null,
    ...over,
  };
}

const openSeason = (over: Partial<CandidateRule> = {}) =>
  rule({ ruleType: "season", parameters: { periods: [{ label: "All year", status: "open", start: jan1, end: dec31 }] }, ...over });

const reach7: ReachInfo = { key: "7", name: "Upper", fromDesc: "Dam", toDesc: "Bridge", lon: -120, lat: 39, line: null };

describe("resolveWater", () => {
  it("closed season period wins", () => {
    const r = resolveWater([
      openSeason(),
      rule({ ruleType: "gear_method", period: { status: "closed", start: jan1, end: dec31 } }),
      rule({ parameters: { daily: 5 } }),
    ], [], ON, false);
    expect(r.status.overall).toBe("closed");
    expect(r.status.label).toBe("Closed");
  });

  it("open season + daily 5 bag", () => {
    const r = resolveWater([openSeason(), rule({ parameters: { daily: 5 } })], [], ON, false);
    expect(r.status).toEqual({ overall: "open", label: "Open", verifyCurrent: false });
  });

  it("open season + only C&R bag", () => {
    const r = resolveWater([openSeason(), rule({ parameters: { catch_and_release: true } })], [], ON, true);
    expect(r.status).toEqual({ overall: "catch_and_release", label: "Catch & release only", verifyCurrent: true });
  });

  it("unrelated C&R protection bag does not downgrade", () => {
    const r = resolveWater([
      openSeason(),
      rule({ parameters: { daily: 5 } }),
      rule({ parameters: { catch_and_release: true } }),
    ], [], ON, false);
    expect(r.status.overall).toBe("open");
  });

  it("spatial water closure stays informational; the same closure on a reach closes that reach", () => {
    const spatial = { closure_kind: "spatial" };
    const r = resolveWater([
      openSeason(),
      rule({ ruleType: "closure", parameters: spatial }),
      rule({ ruleType: "closure", parameters: spatial, scopeKey: "reach:7" }),
    ], [reach7], ON, false);
    expect(r.status.overall).toBe("open");
    expect(r.scopes[0].rules.map((x) => x.ruleType)).toEqual(["season", "closure"]);
    expect(r.scopes[1]).toMatchObject({ kind: "reach", reachId: "7", scope: "Upper", sublabel: "Dam → Bridge", point: [-120, 39], status: "closed" });
  });

  it("unresolvable period contributes nothing", () => {
    const r = resolveWater([rule({ ruleType: "gear_method", period: { status: "open", start: astro, end: dec31 } })], [], ON, false);
    expect(r.status.overall).toBe("unknown");
    expect(r.scopes[0].rules).toHaveLength(1); // card kept
  });

  it("validTo before on drops the rule", () => {
    const r = resolveWater([
      openSeason(),
      rule({ ruleType: "closure", validTo: "2026-06-30" }),
      rule({ ruleType: "closure", validFrom: "2026-07-02" }),
    ], [], ON, false);
    expect(r.status.overall).toBe("open");
    expect(r.scopes[0].rules.map((x) => x.ruleType)).toEqual(["season"]);
    const kept = resolveWater([openSeason(), rule({ ruleType: "closure", validFrom: ON, validTo: ON })], [], ON, false);
    expect(kept.status.overall).toBe("closed");
  });

  it("license rules go to licenses, not scopes", () => {
    const r = resolveWater([openSeason(), rule({ ruleType: "license", summary: "CA license", authorityName: "CDFW" })], [], ON, false);
    expect(r.scopes[0].rules.map((x) => x.ruleType)).toEqual(["season"]);
    expect(r.licenses).toHaveLength(1);
    expect(r.licenses[0]).toMatchObject({ ruleType: "license", summary: "CA license", authority: "CDFW" });
  });

  it("reach with no rules is omitted", () => {
    const r = resolveWater([openSeason()], [reach7, { ...reach7, key: "8" }], ON, false);
    expect(r.scopes.map((s) => s.kind)).toEqual(["water"]);
  });

  it("serializes season periods with activeNow and the exact rule shape", () => {
    const r = resolveWater([openSeason({ citation: "CCR 7.50", species: ["Rainbow trout"] })], [], ON, false);
    expect(r.scopes[0]).toEqual({
      scope: "water", kind: "water", reachId: null, line: null, point: null, sublabel: null, status: "open",
      rules: [{
        ruleType: "season", summary: "rule",
        detail: { periods: [{ label: "All year", status: "open", start: jan1, end: dec31 }] },
        citation: "CCR 7.50", sourceUrl: null, polarity: "applies", confidence: "high", appliesTo: "all",
        species: ["Rainbow trout"],
        periods: [{ label: "All year", status: "open", activeNow: true }],
      }],
    });
  });
});
