import { describe, it, expect, afterAll } from "vitest";
import { closeDb } from "../../src/db/client";
import * as seed from "../../src/seed/corridor";

afterAll(async () => { await closeDb(); });

describe("canonical corridor cases round-trip", () => {
  it("compound bag: Topaz sub-limit ≤5 black bass", async () => {
    const { bag } = await seed.seedTopazCompoundBag();
    expect((bag.parameters as any).sub_limits[0].max_daily).toBe(5);
  });
  it("slot limit: Pyramid cutthroat protected 20–24in, fork length", async () => {
    const { size } = await seed.seedPyramidSlot();
    expect((size.parameters as any).protected_slot).toEqual({ min_in: 20, max_in: 24 });
    expect((size.parameters as any).measurement).toBe("fork_length");
  });
  it("reach closure: Truckee Reach A closed, anchored 1000ft below dam", async () => {
    const { reach, target } = await seed.seedTruckeeReachClosure();
    expect(reach.toOffsetFt).toBe(1000);
    expect(target.targetType).toBe("reach");
  });
  it("reciprocity: Tahoe honored=true, Donner honored=false", async () => {
    const { tahoe, donner } = await seed.seedReciprocity();
    expect(tahoe.honored).toBe(true);
    expect(donner.honored).toBe(false);
  });
  it("tribal permit: replaces state license, reservation-wide territory scope", async () => {
    const { license, target } = await seed.seedPyramidTribalPermit();
    expect((license.parameters as any).replaces_state_license).toBe(true);
    expect(target.targetType).toBe("authority_territory");
  });
  it("AIS gate: Tahoe inspection + decon + drain plug", async () => {
    const { ais } = await seed.seedTahoeAis();
    expect((ais.parameters as any).inspection_required).toBe(true);
  });
  it("verified absence: NV Truckee size_limit asserts_none, disputed source refuted", async () => {
    const { size, source } = await seed.seedNvTruckeeNoSizeLimit();
    expect(size.rulePolarity).toBe("asserts_none");
    expect(source.disputed).toBe(true);
  });
});
