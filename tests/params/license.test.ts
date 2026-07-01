import { describe, it, expect } from "vitest";
import { licenseParams } from "../../src/params/license";

describe("licenseParams", () => {
  it("encodes Tahoe reciprocity", () => {
    const v = licenseParams.parse({
      required: true, min_age: 16, under_min_age: "no_license_required",
      reciprocity: { applies: true, honored_authority_ids: [1, 2], note: "CA or NV honored; NV needs trout stamp" },
    });
    expect(v.reciprocity?.honored_authority_ids).toEqual([1, 2]);
  });
});
