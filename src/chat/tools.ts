import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { rules } from "../api/rules";

/** Resolve waters by name, alias, or county (case-insensitive substring). ≤8 results. */
export async function searchWaters(query: string) {
  const like = `%${query}%`;
  const rows = (await db.execute(sql`
    select w.id, w.name, w.water_type as "waterType", w.states, w.counties
    from water_body w
    where w.name ilike ${like}
       or exists (select 1 from unnest(w.aliases) a where a ilike ${like})
       or exists (select 1 from unnest(w.counties) ct where ct ilike ${like})
    order by w.name
    limit 8
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name as string,
    waterType: r.waterType as string,
    states: (r.states as string[]) ?? [],
    counties: (r.counties as string[]) ?? [],
  }));
}

/** Full resolved ruleset for one water — reuses the tested /api/waters/:id/rules handler
 *  by invoking the rules sub-app in-process (no HTTP, no import cycle: this imports the
 *  sub-app, not server.ts). */
export async function getWaterRules(waterId: number): Promise<unknown> {
  const res = await rules.request(`/api/waters/${waterId}/rules`);
  if (res.status !== 200) throw new Error(`no water with id ${waterId}`);
  return await res.json();
}

/** Full stocking history for one water — every recorded dated plant (newest first) plus any
 *  stated recurring schedule, each with its source URL. Distinct from getWaterRules so the
 *  agent (and the chat's interactive stocking-timeline card) can pull just the history. */
export async function getStockingHistory(waterId: number) {
  const [water] = (await db.execute(sql`
    select id, name, states from water_body where id = ${waterId}
  `)) as unknown as Array<Record<string, unknown>>;
  if (!water) throw new Error(`no water with id ${waterId}`);

  const events = (await db.execute(sql`
    select sp.common_name as "species", e.quantity, e.size_note as "sizeNote",
           e.stocked_on::text as "date", s.url as "sourceUrl"
    from species_stocking_event e
    join species sp on sp.id = e.species_id
    join source s on s.id = e.source_id
    where e.water_body_id = ${waterId}
    order by e.stocked_on desc
  `)) as unknown as Array<Record<string, unknown>>;

  const schedule = (await db.execute(sql`
    select sp.common_name as "species", sc.frequency,
           sc.season_start_month as "seasonStartMonth", sc.season_end_month as "seasonEndMonth",
           sc.note, s.url as "sourceUrl"
    from species_stocking_schedule sc
    join species sp on sp.id = sc.species_id
    join source s on s.id = sc.source_id
    where sc.water_body_id = ${waterId}
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    waterId: Number(water.id),
    waterName: water.name as string,
    events: events.map((e) => ({
      species: e.species as string,
      quantity: e.quantity == null ? null : Number(e.quantity),
      sizeNote: (e.sizeNote as string | null) ?? null,
      date: e.date as string,
      sourceUrl: (e.sourceUrl as string | null) ?? null,
    })),
    schedule: schedule.map((s) => ({
      species: s.species as string,
      frequency: s.frequency as string,
      seasonStartMonth: s.seasonStartMonth == null ? null : Number(s.seasonStartMonth),
      seasonEndMonth: s.seasonEndMonth == null ? null : Number(s.seasonEndMonth),
      note: (s.note as string | null) ?? null,
      sourceUrl: (s.sourceUrl as string | null) ?? null,
    })),
  };
}

/** Keyword search over regulation text (summary, verbatim, citation), joined to the water
 *  and the primary source URL. Water-body and reach targets only (statewide
 *  authority-territory rules are intentionally excluded — they aren't water-specific). */
export async function searchRegulations(keyword: string, state?: "CA" | "NV") {
  const like = `%${keyword}%`;
  const rows = (await db.execute(sql`
    with reg_water as (
      select t.regulation_id, t.target_id as water_id
        from regulation_target t
       where t.target_type = 'water_body' and t.mode = 'include'
      union
      select t.regulation_id, rc.water_body_id
        from regulation_target t
        join reach rc on rc.id = t.target_id
       where t.target_type = 'reach' and t.mode = 'include'
    )
    select distinct r.id as "regId", w.id as "waterId", w.name as "waterName",
           r.rule_type as "ruleType", r.citation, r.human_summary as "humanSummary",
           (select s.url from regulation_source rs join source s on s.id = rs.source_id
             where rs.regulation_id = r.id and rs.role = 'primary' limit 1) as "sourceUrl"
    from regulation r
    join reg_water rw on rw.regulation_id = r.id
    join water_body w on w.id = rw.water_id
    where r.status in ('verified', 'published')
      and (r.human_summary ilike ${like} or r.verbatim_text ilike ${like} or r.citation ilike ${like})
      and (${state ?? null}::text is null or ${state ?? null} = any(w.states))
    order by w.name
    limit 15
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    waterId: Number(r.waterId),
    waterName: r.waterName as string,
    ruleType: r.ruleType as string,
    citation: (r.citation as string | null) ?? null,
    humanSummary: r.humanSummary as string,
    sourceUrl: (r.sourceUrl as string | null) ?? null,
  }));
}
