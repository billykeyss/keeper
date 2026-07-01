import { describe, it, expect } from "vitest";
import { aisParams } from "../../src/params/ais";

describe("aisParams", () => {
  it("encodes the Tahoe inspection gate", () => {
    const v = aisParams.parse({
      inspection_required: true, decontamination_required: true, seal_or_sticker_required: true,
      drain_plug_out_required: true, applies_to: "motorized",
    });
    expect(v.inspection_required).toBe(true);
  });
});
