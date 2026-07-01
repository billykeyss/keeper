import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";

afterAll(async () => { await closeDb(); });

describe("database", () => {
  it("has PostGIS available", async () => {
    const rows = await db.execute(sql`select postgis_version() as v`);
    expect(String((rows as any)[0].v)).toMatch(/^3\./);
  });
});
