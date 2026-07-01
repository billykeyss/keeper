import { describe, it, expect } from "vitest";
import { checkLegalInstrument } from "../../src/validation/legalInstrument";
const legal = { authorityLevel: "primary_regulatory", instrumentType: "commission_reg" };
const booklet = { authorityLevel: "agency_mirror", instrumentType: "booklet" };
describe("checkLegalInstrument", () => {
  it("rejects published+binding backed only by a booklet", () => {
    expect(checkLegalInstrument({ status: "published", isBinding: true, rulePolarity: "applies", verbatimText: "x" }, [{ role: "primary", source: booklet }]).ok).toBe(false);
  });
  it("rejects published+binding with null verbatim (not asserts_none)", () => {
    expect(checkLegalInstrument({ status: "published", isBinding: true, rulePolarity: "applies", verbatimText: null }, [{ role: "primary", source: legal }]).ok).toBe(false);
  });
  it("accepts published+binding with a legal instrument and verbatim", () => {
    expect(checkLegalInstrument({ status: "published", isBinding: true, rulePolarity: "applies", verbatimText: "x" }, [{ role: "primary", source: legal }]).ok).toBe(true);
  });
  it("allows asserts_none with null verbatim", () => {
    expect(checkLegalInstrument({ status: "published", isBinding: true, rulePolarity: "asserts_none", verbatimText: null }, [{ role: "primary", source: legal }]).ok).toBe(true);
  });
  it("ignores draft rules", () => {
    expect(checkLegalInstrument({ status: "draft", isBinding: true, rulePolarity: "applies", verbatimText: null }, []).ok).toBe(true);
  });
});
