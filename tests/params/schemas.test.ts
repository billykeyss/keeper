import { describe, it, expect } from "vitest";
import { seasonParams } from "../../src/params/season";
import { sizeLimitParams } from "../../src/params/sizeLimit";
import { gearMethodParams } from "../../src/params/gearMethod";
import { fishingHoursParams } from "../../src/params/fishingHours";
import { handlingParams } from "../../src/params/handling";
import { vesselParams } from "../../src/params/vessel";
import { documentationParams } from "../../src/params/documentation";
import { definitionParams } from "../../src/params/definition";
import { specialParams } from "../../src/params/special";

const yearRoundDate = { type: "year_round" as const, verbatim: "all year" };

describe("seasonParams", () => {
  it("accepts a valid season", () => {
    expect(seasonParams.safeParse({ periods: [{ label: "x", status: "open", start: yearRoundDate, end: yearRoundDate }] }).success).toBe(true);
  });
  it("rejects an unknown key", () => {
    expect(seasonParams.safeParse({ periods: [{ label: "x", status: "open", start: yearRoundDate, end: yearRoundDate }], bogus: 1 }).success).toBe(false);
  });
});

describe("sizeLimitParams", () => {
  it("accepts a valid size limit", () => {
    expect(sizeLimitParams.safeParse({ measurement: "total_length", unit: "inch" }).success).toBe(true);
  });
  it("rejects an unknown key", () => {
    expect(sizeLimitParams.safeParse({ measurement: "total_length", unit: "inch", bogus: 1 }).success).toBe(false);
  });
});

describe("gearMethodParams", () => {
  const validGear = { bait_allowed: true, artificial_only: false, flies_only: false, lures_allowed: true, barbless_required: false, single_hook_required: false };
  it("accepts all 6 required booleans", () => {
    expect(gearMethodParams.safeParse(validGear).success).toBe(true);
  });
  it("rejects an unknown key", () => {
    expect(gearMethodParams.safeParse({ ...validGear, bogus: 1 }).success).toBe(false);
  });
});

describe("fishingHoursParams", () => {
  it("accepts basis-only (no time bounds needed after fix)", () => {
    expect(fishingHoursParams.safeParse({ basis: "any_hour" }).success).toBe(true);
  });
  it("rejects an invalid basis value", () => {
    expect(fishingHoursParams.safeParse({ basis: "bogus" }).success).toBe(false);
  });
});

describe("handlingParams", () => {
  it("accepts an empty-ish handling object", () => {
    expect(handlingParams.safeParse({ must_release_unharmed: true }).success).toBe(true);
  });
  it("rejects an unknown key", () => {
    expect(handlingParams.safeParse({ must_release_unharmed: true, bogus: 1 }).success).toBe(false);
  });
});

describe("vesselParams", () => {
  const validVessel = { gas_motor_allowed: false, electric_motor_allowed: true, non_motorized_allowed: true };
  it("accepts valid vessel params", () => {
    expect(vesselParams.safeParse(validVessel).success).toBe(true);
  });
  it("rejects an unknown key", () => {
    expect(vesselParams.safeParse({ ...validVessel, bogus: 1 }).success).toBe(false);
  });
});

describe("documentationParams", () => {
  it("accepts valid documentation params", () => {
    expect(documentationParams.safeParse({ report_card_required: true }).success).toBe(true);
  });
  it("rejects an unknown key", () => {
    expect(documentationParams.safeParse({ report_card_required: true, bogus: 1 }).success).toBe(false);
  });
});

describe("definitionParams", () => {
  it("accepts a valid definition", () => {
    expect(definitionParams.safeParse({ term: "possession", applies_to_rule_types: ["bag"], text: "the combined daily and possession limit" }).success).toBe(true);
  });
  it("rejects an unrecognised rule type after fix", () => {
    expect(definitionParams.safeParse({ term: "possession", applies_to_rule_types: ["not_a_rule_type"], text: "x" }).success).toBe(false);
  });
});

describe("specialParams", () => {
  it("accepts a valid special object", () => {
    expect(specialParams.safeParse({ description: "x", raw: {} }).success).toBe(true);
  });
  it("rejects an unknown key", () => {
    expect(specialParams.safeParse({ description: "x", raw: {}, bogus: 1 }).success).toBe(false);
  });
});
