import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, lte, or, isNull, gte } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { authority, regulation, auditLog } from "../../src/db/schema";
import { applySqlFile } from "../../src/db/applySql";
import { supersedeRegulation } from "../../src/validation/versioning";

beforeAll(async () => { await applySqlFile("db/sql/audit_trigger.sql"); });
afterAll(async () => { await closeDb(); });

describe("as-of reconstruction", () => {
  it("returns the version valid on a given date and writes an audit row", async () => {
    const [a] = await db.insert(authority).values({ name: "CDFW-2", state: "CA", type: "state_agency" }).returning();
    const [v1] = await db.insert(regulation).values({
      ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" },
      authorityId: a.id, humanSummary: "5 trout", validFrom: "2025-01-01", status: "published",
    }).returning();
    await supersedeRegulation(v1.id, { parameters: { daily: 2, unit: "fish", aggregation: "combined_group" }, humanSummary: "2 trout", validFrom: "2026-01-01" });

    const asOf = "2025-07-01";
    const rows = await db.select().from(regulation).where(and(
      eq(regulation.authorityId, a.id),
      lte(regulation.validFrom, asOf),
      or(isNull(regulation.validTo), gte(regulation.validTo, asOf)),
    ));
    expect(rows).toHaveLength(1);
    expect((rows[0].parameters as any).daily).toBe(5);

    // The audit trigger recorded the mutations on the regulation table.
    const audits = await db.select().from(auditLog).where(eq(auditLog.tableName, "regulation"));
    expect(audits.length).toBeGreaterThan(0);
    // v1 was inserted then updated (superseded); the new version was inserted.
    const v1Audits = audits.filter((r) => r.rowId === v1.id);
    expect(v1Audits.some((r) => r.action === "insert")).toBe(true);
    expect(v1Audits.some((r) => r.action === "update")).toBe(true);
  });
});
