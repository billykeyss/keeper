import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

export const waters = new Hono();

/** Parse a `bbox=minLon,minLat,maxLon,maxLat` query value into four finite numbers.
 *  Returns null on any malformed input (wrong arity, NaN, or min >= max). */
function parseBbox(raw: string | undefined): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon >= maxLon || minLat >= maxLat) return null;
  return [minLon, minLat, maxLon, maxLat];
}

waters.get("/api/waters", async (c) => {
  const bbox = parseBbox(c.req.query("bbox"));
  if (!bbox) return c.json({ error: "bbox must be minLon,minLat,maxLon,maxLat with min < max" }, 400);
  const [minLon, minLat, maxLon, maxLat] = bbox;

  const rows = (await db.execute(sql`
    select w.id, w.name, w.water_type as "waterType", w.states, w.verify_current as "verifyCurrent",
           st_x(st_centroid(w.geom)) as lon, st_y(st_centroid(w.geom)) as lat,
           (select count(*)::int from regulation_target t
              join regulation r on r.id = t.regulation_id and r.status in ('verified','published')
             where t.mode = 'include' and (
                   (t.target_type = 'water_body' and t.target_id = w.id)
                or (t.target_type = 'reach' and t.target_id in (select id from reach where water_body_id = w.id))
                or (t.target_type = 'authority_territory' and t.target_id in (select authority_id from water_body_authority where water_body_id = w.id))
             )) as "ruleCount"
    from water_body w
    where w.geom is not null
      and st_intersects(w.geom, st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))
    order by w.name
  `)) as unknown as Array<Record<string, unknown>>;

  const waterPins = rows.map((r) => ({
    id: Number(r.id),
    name: r.name as string,
    waterType: r.waterType as string,
    states: (r.states as string[]) ?? [],
    lon: Number(r.lon),
    lat: Number(r.lat),
    verifyCurrent: Boolean(r.verifyCurrent),
    ruleCount: Number(r.ruleCount),
  }));

  return c.json({ waters: waterPins });
});
