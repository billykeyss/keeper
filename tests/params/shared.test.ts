import { describe, it, expect } from "vitest";
import { dateSpec } from "../../src/params/shared";

describe("dateSpec", () => {
  it("accepts a relative 'last Saturday in April'", () => {
    const v = dateSpec.parse({ type: "relative", ordinal: "last", weekday: "sat", month: 4, verbatim: "last Saturday in April" });
    expect(v.month).toBe(4);
  });
  it("rejects an unknown type", () => {
    expect(() => dateSpec.parse({ type: "lunar", verbatim: "x" })).toThrow();
  });
});
