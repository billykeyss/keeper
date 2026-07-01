import { describe, it, expect, afterAll } from "vitest";
import { closeDb } from "../../src/db/client";
import * as seed from "../../src/seed/corridor";
import type { DateSpec } from "../../src/params/shared";
import { resolveDateSpec } from "../../src/resolver/dateSpec";

afterAll(async () => { await closeDb(); });

describe("canonical corridor cases round-trip", () => {
  it("compound bag: Topaz sub-limit ≤5 black bass", async () => {
    const { bag } = await seed.seedTopazCompoundBag();
    expect((bag.parameters as any).sub_limits[0].max_daily).toBe(5);
  });
  it("two-period season: Truckee Reach C take(2 trout)/winter(0 C&R) bind to season_period windows", async () => {
    const { takePeriod, winterPeriod, takeBag, winterBag } = await seed.seedTruckeeReachC();
    // take-season bag: 2 trout, bound to the take window.
    expect((takeBag.parameters as any).daily).toBe(2);
    expect(takeBag.seasonPeriodId).toBe(takePeriod.id);
    // winter bag: 0 trout, catch-and-release, bound to the winter window.
    expect((winterBag.parameters as any).daily).toBe(0);
    expect((winterBag.parameters as any).catch_and_release).toBe(true);
    expect(winterBag.seasonPeriodId).toBe(winterPeriod.id);
    // both windows persisted with the right period status.
    expect(takePeriod.status).toBe("open");
    expect(winterPeriod.status).toBe("open_catch_release");
    // the stored JSONB date_specs round-trip through the resolver:
    // take season opens on the last Saturday in April 2026 (Apr 25);
    // winter C&R ends the Friday preceding it (Apr 24).
    expect(resolveDateSpec(takePeriod.startSpec as DateSpec, 2026)).toBe("2026-04-25");
    expect(resolveDateSpec(winterPeriod.endSpec as DateSpec, 2026)).toBe("2026-04-24");
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
