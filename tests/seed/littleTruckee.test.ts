import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { regulation } from "../../src/db/schema";
import { validateParameters } from "../../src/params";
import { seedLittleTruckee } from "../../src/seed/corridor";

afterAll(async () => { await closeDb(); });

describe("Little Truckee zero-limit C&R (canonical case 7)", () => {
  it("seeds one group of season+bag+gear_method that all validate", async () => {
    const { groupId } = await seedLittleTruckee();
    const rows = await db.select().from(regulation).where(eq(regulation.regulationGroupId, groupId));
    const types = rows.map((r) => r.ruleType).sort();
    expect(types).toEqual(["bag", "gear_method", "season"]);
    for (const r of rows) expect(validateParameters(r.ruleType, r.parameters).success).toBe(true);
    const bag = rows.find((r) => r.ruleType === "bag")!;
    expect((bag.parameters as any).catch_and_release).toBe(true);
    expect((bag.parameters as any).daily).toBe(0);
  });
});
