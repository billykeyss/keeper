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

/** Name/alias/county search for the map's search box: case-insensitive substring match,
 *  name matches ranked above alias/county-only matches, ≤8 rows, centroid included for
 *  fly-to. (Static path — never shadowed by /api/waters/:id/rules.) */
waters.get("/api/waters/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ error: "q query param is required" }, 400);
  const like = `%${q}%`;

  const rows = (await db.execute(sql`
    select w.id, w.name, w.water_type as "waterType", w.states, w.counties,
           st_x(st_centroid(w.geom)) as lon, st_y(st_centroid(w.geom)) as lat
    from water_body w
    where w.geom is not null and (
          w.name ilike ${like}
       or exists (select 1 from unnest(w.aliases) a where a ilike ${like})
       or exists (select 1 from unnest(w.counties) ct where ct ilike ${like})
    )
    order by (w.name ilike ${like}) desc, w.name
    limit 8
  `)) as unknown as Array<Record<string, unknown>>;

  return c.json({
    waters: rows.map((r) => ({
      id: Number(r.id),
      name: r.name as string,
      waterType: r.waterType as string,
      states: (r.states as string[]) ?? [],
      counties: (r.counties as string[]) ?? [],
      lon: Number(r.lon),
      lat: Number(r.lat),
    })),
  });
});

waters.get("/api/waters", async (c) => {
  const bbox = parseBbox(c.req.query("bbox"));
  if (!bbox) return c.json({ error: "bbox must be minLon,minLat,maxLon,maxLat with min < max" }, 400);
  const [minLon, minLat, maxLon, maxLat] = bbox;
  // Optional stocked-species filter: restrict pins to waters with a source-backed stocking
  // record (event or schedule) for this species, matched case-insensitively by common name.
  const stocked = c.req.query("stocked")?.trim() || null;

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
      and (${stocked}::text is null or exists (
        select 1 from (
          select e.water_body_id, e.species_id from species_stocking_event e
          union all
          select s.water_body_id, s.species_id from species_stocking_schedule s
        ) sx join species sp on sp.id = sx.species_id
        where sx.water_body_id = w.id and lower(sp.common_name) = lower(${stocked})
      ))
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

  // Reaches carrying their own point (e.g. river segments with distinct regs) — plotted as
  // a real line when we have traced path geometry (geom), else as a satellite marker at the
  // representative point, so a multi-reach river doesn't collapse into one ambiguous water pin.
  // Status is intentionally NOT resolved here (same lazy-status pattern as water pins above);
  // it's only computed per-water, on demand, in /api/waters/:id/rules.
  const reachRows = (await db.execute(sql`
    select r.id, r.water_body_id as "waterBodyId", w.name as "waterName", r.name,
           r.from_desc as "fromDesc", r.to_desc as "toDesc", r.lon, r.lat,
           case when r.geom is not null then st_asgeojson(r.geom) end as "geomJson"
    from reach r
    join water_body w on w.id = r.water_body_id
    where (
          (r.geom is not null and st_intersects(r.geom, st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)))
       or (r.geom is null and r.lon is not null and r.lat is not null
           and st_intersects(st_setsrid(st_makepoint(r.lon, r.lat), 4326), st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)))
    )
      and (${stocked}::text is null or exists (
        select 1 from (
          select e.water_body_id, e.species_id from species_stocking_event e
          union all
          select s.water_body_id, s.species_id from species_stocking_schedule s
        ) sx join species sp on sp.id = sx.species_id
        where sx.water_body_id = w.id and lower(sp.common_name) = lower(${stocked})
      ))
    order by w.name, r.id
  `)) as unknown as Array<Record<string, unknown>>;

  const reachPins = reachRows.map((r) => {
    const geomJson = r.geomJson ? (JSON.parse(r.geomJson as string) as { type: string; coordinates: number[][][] }) : null;
    // MultiLineString -> flatten to the single line we store (one line per reach today).
    const line = geomJson ? geomJson.coordinates[0].map(([lon, lat]) => [lon, lat] as [number, number]) : null;
    return {
      id: Number(r.id),
      waterBodyId: Number(r.waterBodyId),
      waterName: r.waterName as string,
      name: r.name as string | null,
      sublabel: r.fromDesc && r.toDesc ? `${r.fromDesc} → ${r.toDesc}` : null,
      lon: Number(r.lon),
      lat: Number(r.lat),
      line,
    };
  });

  return c.json({ waters: waterPins, reaches: reachPins });
});
