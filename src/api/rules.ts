import { Hono } from "hono";
import { and, eq, or, inArray, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client";
import {
  waterBody, reach, waterBodyAuthority, authority, regulation, regulationTarget,
  seasonPeriod, regulationGroup, regulationSource, source, regulationSpecies,
  species, speciesGroup, waterBodySpecies, licenseReciprocity,
  speciesStockingEvent, speciesStockingSchedule,
} from "../db/schema";
import { resolveWater, isValidIsoDate, type CandidateRule, type DateSpec, type PeriodStatus, type ReachInfo } from "../resolve/index.ts";

export const rules = new Hono();

rules.get("/api/waters/:id/rules", async (c) => {
  const idRaw = c.req.param("id");
  const waterId = Number(idRaw);
  if (!Number.isInteger(waterId) || waterId <= 0) return c.json({ error: "unknown water" }, 404);

  const on = c.req.query("on") ?? new Date().toISOString().slice(0, 10);
  if (!isValidIsoDate(on)) return c.json({ error: "on must be a valid YYYY-MM-DD date" }, 400);

  const [water] = await db.select().from(waterBody).where(eq(waterBody.id, waterId));
  if (!water) return c.json({ error: "unknown water" }, 404);

  const reaches = await db.select().from(reach).where(eq(reach.waterBodyId, waterId));
  const reachIds = reaches.map((r) => r.id);

  const wbaRows = await db.select({ authorityId: waterBodyAuthority.authorityId })
    .from(waterBodyAuthority).where(eq(waterBodyAuthority.waterBodyId, waterId));
  const authorityIds = [...new Set(wbaRows.map((r) => r.authorityId))];

  // Targets that place a regulation on this water: direct water_body, any of its reaches, or an
  // authority_territory the water is linked to. `or()` ignores undefined branches.
  const targetMatch = or(
    and(eq(regulationTarget.targetType, "water_body"), eq(regulationTarget.targetId, waterId)),
    reachIds.length ? and(eq(regulationTarget.targetType, "reach"), inArray(regulationTarget.targetId, reachIds)) : undefined,
    authorityIds.length ? and(eq(regulationTarget.targetType, "authority_territory"), inArray(regulationTarget.targetId, authorityIds)) : undefined,
  );

  // Candidate include-targets joined to their regulation + optional season period + group.
  const candidateRows = await db.select({
    regId: regulation.id,
    ruleType: regulation.ruleType,
    parameters: regulation.parameters,
    rulePolarity: regulation.rulePolarity,
    confidence: regulation.confidence,
    appliesToClass: regulation.appliesToClass,
    citation: regulation.citation,
    humanSummary: regulation.humanSummary,
    seasonPeriodId: regulation.seasonPeriodId,
    validFrom: regulation.validFrom,
    validTo: regulation.validTo,
    authorityId: regulation.authorityId,
    targetType: regulationTarget.targetType,
    targetId: regulationTarget.targetId,
    periodStatus: seasonPeriod.status,
    periodStart: seasonPeriod.startSpec,
    periodEnd: seasonPeriod.endSpec,
    groupCitation: regulationGroup.citation,
  })
    .from(regulationTarget)
    .innerJoin(regulation, eq(regulation.id, regulationTarget.regulationId))
    .leftJoin(seasonPeriod, eq(seasonPeriod.id, regulation.seasonPeriodId))
    .leftJoin(regulationGroup, eq(regulationGroup.id, regulation.regulationGroupId))
    .where(and(
      targetMatch,
      eq(regulationTarget.mode, "include"),
      inArray(regulation.status, ["verified", "published"]),
    ));

  // Any regulation carved out by an exclude target matching the same water/reach/authority set.
  const excludeRows = await db.select({ regId: regulationTarget.regulationId })
    .from(regulationTarget)
    .where(and(targetMatch, eq(regulationTarget.mode, "exclude")));
  const excluded = new Set(excludeRows.map((r) => r.regId));

  // Dedupe by regId (one include-target per regulation in practice) and drop excluded ones.
  const seen = new Set<number>();
  const candidates = candidateRows.filter((r) => {
    if (excluded.has(r.regId) || seen.has(r.regId)) return false;
    seen.add(r.regId);
    return true;
  });
  const candidateIds = candidates.map((r) => r.regId);

  // primary source url per regulation
  const urlByReg = new Map<number, string | null>();
  if (candidateIds.length) {
    const srcRows = await db.select({ regId: regulationSource.regulationId, url: source.url })
      .from(regulationSource)
      .innerJoin(source, eq(source.id, regulationSource.sourceId))
      .where(and(inArray(regulationSource.regulationId, candidateIds), eq(regulationSource.role, "primary")));
    for (const s of srcRows) if (!urlByReg.has(s.regId)) urlByReg.set(s.regId, s.url ?? null);
  }

  // species/species-group labels per regulation (target role)
  const speciesByReg = new Map<number, string[]>();
  if (candidateIds.length) {
    const spRows = await db.select({
      regId: regulationSpecies.regulationId,
      commonName: species.commonName,
      groupName: speciesGroup.name,
    })
      .from(regulationSpecies)
      .leftJoin(species, eq(species.id, regulationSpecies.speciesId))
      .leftJoin(speciesGroup, eq(speciesGroup.id, regulationSpecies.speciesGroupId))
      .where(and(inArray(regulationSpecies.regulationId, candidateIds), eq(regulationSpecies.role, "target")));
    for (const s of spRows) {
      const label = s.commonName ?? s.groupName;
      if (!label) continue;
      const arr = speciesByReg.get(s.regId) ?? [];
      arr.push(label);
      speciesByReg.set(s.regId, arr);
    }
  }

  // authority names for license rows
  const authNameById = new Map<number, string>();
  if (candidateIds.length) {
    const regAuthIds = [...new Set(candidates.map((r) => r.authorityId))];
    const aRows = await db.select({ id: authority.id, name: authority.name }).from(authority).where(inArray(authority.id, regAuthIds));
    for (const a of aRows) authNameById.set(a.id, a.name);
  }

  // Reach path geometry, for the map's "tap a section to highlight it" affordance. One lookup,
  // converted to the same [lon,lat][] line shape the map already uses for reach pins.
  const reachLineById = new Map<number, [number, number][]>();
  if (reaches.length) {
    const geomRows = (await db.execute(sql`
      select id, st_asgeojson(geom) as "geomJson"
      from reach
      where geom is not null and id in (${sql.join(reaches.map((r) => sql`${r.id}`), sql`, `)})
    `)) as unknown as Array<{ id: number | string; geomJson: string }>;
    for (const g of geomRows) {
      const gj = JSON.parse(g.geomJson) as { coordinates: number[][][] };
      // MultiLineString -> the single stored line (one line per reach today).
      const coords = gj?.coordinates?.[0];
      if (coords) reachLineById.set(Number(g.id), coords.map(([lon, lat]) => [lon, lat] as [number, number]));
    }
  }

  // --- build DB-free candidates and resolve them (validity, season windows, scope status) ---
  const cands: CandidateRule[] = candidates.map((r) => ({
    regId: r.regId,
    ruleType: r.ruleType,
    parameters: (r.parameters ?? {}) as Record<string, unknown>,
    polarity: r.rulePolarity,
    confidence: r.confidence,
    appliesTo: r.appliesToClass,
    citation: r.citation ?? r.groupCitation ?? null,
    summary: r.humanSummary,
    sourceUrl: urlByReg.get(r.regId) ?? null,
    species: speciesByReg.get(r.regId) ?? [],
    scopeKey: r.targetType === "reach" ? `reach:${r.targetId}` : "water",
    period: r.seasonPeriodId != null && r.periodStart && r.periodEnd
      ? { status: r.periodStatus as PeriodStatus, start: r.periodStart as DateSpec, end: r.periodEnd as DateSpec }
      : null,
    validFrom: r.validFrom ?? null,
    validTo: r.validTo ?? null,
    authorityName: authNameById.get(r.authorityId),
  }));
  const reachInfos: ReachInfo[] = reaches.map((rc) => ({
    key: String(rc.id),
    name: rc.name,
    fromDesc: rc.fromDesc,
    toDesc: rc.toDesc,
    lon: rc.lon,
    lat: rc.lat,
    line: reachLineById.get(rc.id) ?? null,
  }));
  const resolvedWater = resolveWater(cands, reachInfos, on, water.verifyCurrent);
  // The API's reachId stays the numeric DB id (the pure module keys reaches by string).
  const scopes = resolvedWater.scopes.map((s) => ({ ...s, reachId: s.reachId == null ? null : Number(s.reachId) }));

  // --- reciprocity (joined authority names) ---
  const honoring = alias(authority, "honoring_auth");
  const honored = alias(authority, "honored_auth");
  const recRows = await db.select({
    honoringAuthority: honoring.name,
    honoredAuthority: honored.name,
    honored: licenseReciprocity.honored,
    replacesStateLicense: licenseReciprocity.replacesStateLicense,
    condition: licenseReciprocity.condition,
  })
    .from(licenseReciprocity)
    .leftJoin(honoring, eq(honoring.id, licenseReciprocity.honoringAuthorityId))
    .leftJoin(honored, eq(honored.id, licenseReciprocity.honoredAuthorityId))
    .where(eq(licenseReciprocity.waterBodyId, waterId));

  // --- species present in the water ---
  const speciesRows = await db.select({
    commonName: species.commonName,
    scientificName: species.scientificName,
    category: species.category,
    presence: waterBodySpecies.presence,
  })
    .from(waterBodySpecies)
    .innerJoin(species, eq(species.id, waterBodySpecies.speciesId))
    .where(eq(waterBodySpecies.waterBodyId, waterId));

  // --- stocking events (newest first) + schedule ---
  const stockingEventRows = await db.select({
    species: species.commonName,
    quantity: speciesStockingEvent.quantity,
    sizeNote: speciesStockingEvent.sizeNote,
    date: speciesStockingEvent.stockedOn,
    sourceUrl: source.url,
  })
    .from(speciesStockingEvent)
    .innerJoin(species, eq(species.id, speciesStockingEvent.speciesId))
    .innerJoin(source, eq(source.id, speciesStockingEvent.sourceId))
    .where(eq(speciesStockingEvent.waterBodyId, waterId))
    .orderBy(desc(speciesStockingEvent.stockedOn));

  const stockingScheduleRows = await db.select({
    species: species.commonName,
    frequency: speciesStockingSchedule.frequency,
    seasonStartMonth: speciesStockingSchedule.seasonStartMonth,
    seasonEndMonth: speciesStockingSchedule.seasonEndMonth,
    note: speciesStockingSchedule.note,
    sourceUrl: source.url,
  })
    .from(speciesStockingSchedule)
    .innerJoin(species, eq(species.id, speciesStockingSchedule.speciesId))
    .innerJoin(source, eq(source.id, speciesStockingSchedule.sourceId))
    .where(eq(speciesStockingSchedule.waterBodyId, waterId));

  return c.json({
    water: {
      id: water.id,
      name: water.name,
      waterType: water.waterType,
      states: water.states,
      counties: water.counties,
      verifyCurrent: water.verifyCurrent,
    },
    status: resolvedWater.status,
    scopes,
    licenses: resolvedWater.licenses,
    reciprocity: recRows,
    species: speciesRows,
    stocking: { events: stockingEventRows, schedule: stockingScheduleRows },
    asOf: on,
  });
});
