import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

export const stocking = new Hono();

/** All species recorded present at any water (native/introduced/stocked/historical),
 *  aggregated case-insensitively by common name, with how many of those waters also have
 *  source-backed stocking records for the species. Feeds the unified fish filter. */
stocking.get("/api/species", async (c) => {
  const rows = (await db.execute(sql`
    select mode() within group (order by sp.common_name) as "commonName",
           count(distinct wbs.water_body_id)::int as "waterCount",
           count(distinct case when stk.water_body_id is not null then wbs.water_body_id end)::int as "stockedCount"
    from water_body_species wbs
    join species sp on sp.id = wbs.species_id
    left join (
      select species_id, water_body_id from species_stocking_event
      union
      select species_id, water_body_id from species_stocking_schedule
    ) stk on stk.species_id = wbs.species_id and stk.water_body_id = wbs.water_body_id
    group by lower(sp.common_name)
    order by count(distinct wbs.water_body_id) desc, lower(sp.common_name)
  `)) as unknown as Array<Record<string, unknown>>;

  return c.json({
    species: rows.map((r) => ({
      commonName: r.commonName as string,
      waterCount: Number(r.waterCount),
      stockedCount: Number(r.stockedCount),
    })),
  });
});

/** Waters where a species is recorded present (case-insensitive), viewport-independent —
 *  feeds the fish filter's water list. `stocked` flags waters with a stocking record. */
stocking.get("/api/species/waters", async (c) => {
  const name = c.req.query("name")?.trim();
  if (!name) return c.json({ error: "name query param is required" }, 400);

  const rows = (await db.execute(sql`
    select w.id, w.name, w.water_type as "waterType", w.states,
           st_x(st_centroid(w.geom)) as lon, st_y(st_centroid(w.geom)) as lat,
           bool_or(stk.water_body_id is not null) as "stocked"
    from water_body_species wbs
    join species sp on sp.id = wbs.species_id
    join water_body w on w.id = wbs.water_body_id
    left join (
      select species_id, water_body_id from species_stocking_event
      union
      select species_id, water_body_id from species_stocking_schedule
    ) stk on stk.species_id = wbs.species_id and stk.water_body_id = wbs.water_body_id
    where lower(sp.common_name) = lower(${name}) and w.geom is not null
    group by w.id, w.name, w.water_type, w.states, w.geom
    order by w.name
  `)) as unknown as Array<Record<string, unknown>>;

  return c.json({
    waters: rows.map((r) => ({
      id: Number(r.id),
      name: r.name as string,
      waterType: r.waterType as string,
      states: (r.states as string[]) ?? [],
      lon: Number(r.lon),
      lat: Number(r.lat),
      stocked: Boolean(r.stocked),
    })),
  });
});

/** Species that have source-backed stocking records (events or schedules), aggregated by
 *  common name — the species table holds one row per (water, species), so identity here is
 *  the name, not the id. Grouping is case-insensitive (files vary: "Rainbow trout" vs
 *  "Rainbow Trout"); the displayed casing is the most frequent variant (mode()). */
stocking.get("/api/stocking/species", async (c) => {
  const rows = (await db.execute(sql`
    select mode() within group (order by sp.common_name) as "commonName",
           count(distinct x.water_body_id)::int as "watersCount",
           count(*) filter (where x.kind = 'event')::int as "eventCount",
           count(*) filter (where x.kind = 'schedule')::int as "scheduleCount",
           max(x.stocked_on)::text as "lastStockedOn"
    from (
      select e.species_id, e.water_body_id, e.stocked_on, 'event' as kind
        from species_stocking_event e
      union all
      select s.species_id, s.water_body_id, null::date, 'schedule'
        from species_stocking_schedule s
    ) x
    join species sp on sp.id = x.species_id
    group by lower(sp.common_name)
    order by count(distinct x.water_body_id) desc, lower(sp.common_name)
  `)) as unknown as Array<Record<string, unknown>>;

  return c.json({
    species: rows.map((r) => ({
      commonName: r.commonName as string,
      watersCount: Number(r.watersCount),
      eventCount: Number(r.eventCount),
      scheduleCount: Number(r.scheduleCount),
      lastStockedOn: (r.lastStockedOn as string | null) ?? null,
    })),
  });
});

/** Waters stocked with one species (case-insensitive common-name match), viewport-independent —
 *  feeds the panel's water list; lastStockedOn is per-species-at-this-water (null = schedule only). */
stocking.get("/api/stocking/waters", async (c) => {
  const species = c.req.query("species")?.trim();
  if (!species) return c.json({ error: "species query param is required" }, 400);

  const rows = (await db.execute(sql`
    select w.id, w.name, w.water_type as "waterType", w.states,
           st_x(st_centroid(w.geom)) as lon, st_y(st_centroid(w.geom)) as lat,
           max(x.stocked_on)::text as "lastStockedOn"
    from (
      select e.species_id, e.water_body_id, e.stocked_on from species_stocking_event e
      union all
      select s.species_id, s.water_body_id, null::date from species_stocking_schedule s
    ) x
    join species sp on sp.id = x.species_id
    join water_body w on w.id = x.water_body_id
    where lower(sp.common_name) = lower(${species}) and w.geom is not null
    group by w.id, w.name, w.water_type, w.states, w.geom
    order by w.name
  `)) as unknown as Array<Record<string, unknown>>;

  return c.json({
    waters: rows.map((r) => ({
      id: Number(r.id),
      name: r.name as string,
      waterType: r.waterType as string,
      states: (r.states as string[]) ?? [],
      lon: Number(r.lon),
      lat: Number(r.lat),
      lastStockedOn: (r.lastStockedOn as string | null) ?? null,
    })),
  });
});
