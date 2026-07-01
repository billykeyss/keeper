import { describe, it, expect } from "vitest";
import { closureParams } from "../../src/params/closure";

describe("closureParams", () => {
  it("encodes a flow-triggered closure", () => {
    const v = closureParams.parse({
      closure_kind: "flow_triggered", boundary_definition: "described",
      trigger: { kind: "flow", gauge_station: "USGS 11463500", threshold_cfs: 300, comparison: "below", status_source_url: "https://example.gov" },
    });
    expect(v.trigger?.threshold_cfs).toBe(300);
  });
});
