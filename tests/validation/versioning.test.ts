import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { authority, regulation, regulationTarget } from "../../src/db/schema";
import { supersedeRegulation } from "../../src/validation/versioning";

afterAll(async () => { await closeDb(); });

describe("supersedeRegulation (clone-on-supersede)", () => {
  it("creates a new version, clones satellites, and closes the old validity", async () => {
    const [a] = await db.insert(authority).values({ name: "NDOW", state: "NV", type: "state_agency" }).returning();
    const [old] = await db.insert(regulation).values({
      ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" },
      authorityId: a.id, humanSummary: "5 trout", validFrom: "2025-01-01", validTo: null, status: "published",
    }).returning();
    await db.insert(regulationTarget).values({ regulationId: old.id, targetType: "water_body", targetId: 999, mode: "include" });

    const next = await supersedeRegulation(old.id, { parameters: { daily: 2, unit: "fish", aggregation: "combined_group" }, humanSummary: "2 trout", validFrom: "2026-01-01" });

    // New version identity + supersedes link.
    expect(next.id).not.toBe(old.id);
    expect(next.supersedesId).toBe(old.id);
    expect(next.status).toBe("published");
    expect(next.validFrom).toBe("2026-01-01");
    expect(next.validTo).toBeNull();

    // Satellites were cloned onto the new version (same targetType/targetId).
    const nextTargets = await db.select().from(regulationTarget).where(eq(regulationTarget.regulationId, next.id));
    expect(nextTargets).toHaveLength(1);
    expect(nextTargets[0].targetType).toBe("water_body");
    expect(nextTargets[0].targetId).toBe(999);
    expect(nextTargets[0].mode).toBe("include");
    // Original satellite is untouched (not moved).
    const oldTargets = await db.select().from(regulationTarget).where(eq(regulationTarget.regulationId, old.id));
    expect(oldTargets).toHaveLength(1);

    // Old row's validity was closed to the day before the new version's validFrom, status superseded.
    const [reloadedOld] = await db.select().from(regulation).where(eq(regulation.id, old.id));
    expect(reloadedOld.validTo).toBe("2025-12-31");
    expect(reloadedOld.status).toBe("superseded");
  });
});
