import { describe, it, expect } from "vitest";
import * as e from "../../src/db/enums";

describe("enums", () => {
  it("rule_type has all 13 fuller-v1 values", () => {
    expect(e.ruleTypeEnum.enumValues).toEqual([
      "season","bag","size_limit","gear_method","fishing_hours","closure",
      "handling","vessel","ais","documentation","license","definition","special",
    ]);
  });
  it("species_scope carries the explicit sentinel", () => {
    expect(e.speciesScopeEnum.enumValues).toEqual(["all","listed"]);
  });
});
