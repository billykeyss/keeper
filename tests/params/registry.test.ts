import { describe, it, expect } from "vitest";
import { validateParameters, ruleTypeParamSchemas } from "../../src/params";

describe("validateParameters", () => {
  it("covers all 13 rule types", () => {
    expect(Object.keys(ruleTypeParamSchemas).sort()).toEqual([
      "ais","bag","closure","definition","documentation","fishing_hours","gear_method",
      "handling","license","season","size_limit","special","vessel",
    ]);
  });
  it("validates a good bag blob and rejects a bad one", () => {
    expect(validateParameters("bag", { daily: 5, unit: "fish", aggregation: "combined_group" }).success).toBe(true);
    expect(validateParameters("bag", { daily: -1, unit: "fish", aggregation: "combined_group" }).success).toBe(false);
    expect(validateParameters("bag", { daily: 5, unit: "fish", aggregation: "combined_group", bogus: 1 }).success).toBe(false);
  });
  it("rejects an unknown rule_type", () => {
    expect(validateParameters("unknown_rule", {}).success).toBe(false);
  });
});
