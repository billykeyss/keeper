import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { authority, waterBody } from "../../src/db/schema";

afterAll(async () => { await closeDb(); });

describe("schema smoke", () => {
  it("inserts an authority and a water body with a point geometry", async () => {
    const [a] = await db.insert(authority).values({ name: "CDFW", state: "CA", type: "state_agency" }).returning();
    const [w] = await db.insert(waterBody).values({
      name: "Donner Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"],
      geom: "SRID=4326;POINT(-120.2436 39.3230)",
    }).returning();
    expect(a.id).toBeGreaterThan(0);
    const [{ lon }] = await db.execute(sql`select st_x(geom) as lon from water_body where id = ${w.id}`) as any;
    expect(Number(lon)).toBeCloseTo(-120.2436, 3);
  });
});
