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
