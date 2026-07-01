import { Hono } from "hono";
import { and, eq, or, inArray, isNull, lte, gte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client";
import {
  waterBody, reach, waterBodyAuthority, authority, regulation, regulationTarget,
  seasonPeriod, regulationGroup, regulationSource, source, regulationSpecies,
  species, speciesGroup, waterBodySpecies, licenseReciprocity,
} from "../db/schema";
import type { DateSpec } from "../params/shared";
import { isDateInWindow, windowResolvable } from "./season";

export const rules = new Hono();

type Params = Record<string, unknown>;
type ScopeStatus = "open" | "catch_and_release" | "closed" | "unknown";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
function validDate(on: string): boolean {
  if (!isoDate.test(on)) return false;
  const t = Date.parse(on + "T00:00:00Z");
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === on;
}

const STATUS_LABEL: Record<ScopeStatus, string> = {
  open: "Open",
  catch_and_release: "Catch & release only",
  closed: "Closed",
  unknown: "Check current regulations",
};

// A single active period status contributed by a rule that is in force on `on`.
type PeriodStatus = "open" | "closed" | "open_catch_release";

interface ResolvedRule {
  regId: number;
  ruleType: string;
  summary: string;
  detail: Params;
  citation: string | null;
  sourceUrl: string | null;
  polarity: string;
  confidence: string;
  appliesTo: string;
  species: string[];
  // resolution bookkeeping (stripped before serialization)
  _scopeKey: string; // "water" or `reach:<id>`
  _inForce: boolean; // definitely applies on `on` (not unknown-activity)
  _activePeriodStatuses: PeriodStatus[]; // season statuses this rule contributes on `on`
  _authorityName?: string;
  // season-type rules also carry per-period activeNow annotations
  periods?: Array<{ label: string; status: PeriodStatus; activeNow: boolean }>;
}

/** Whether an active closure rule forces its whole scope to "closed".
 *  Reach-scope closures always close their reach. Water-scope closures close the whole water
 *  ONLY when they are not partial-area ('spatial') closures — spatial buffers around tributary
 *  mouths / swim areas render as informational rule cards without flipping the water to closed.
 *  Fail-closed: any non-spatial water-scoped closure (year_round/seasonal/emergency/…) closes. */
function closureClosesScope(isWaterScope: boolean, params: unknown): boolean {
  if (!isWaterScope) return true;
  const kind = (params as { closure_kind?: string } | null)?.closure_kind;
  return kind !== "spatial";
}

rules.get("/api/waters/:id/rules", async (c) => {
  const idRaw = c.req.param("id");
  const waterId = Number(idRaw);
  if (!Number.isInteger(waterId) || waterId <= 0) return c.json({ error: "unknown water" }, 404);

  const on = c.req.query("on") ?? new Date().toISOString().slice(0, 10);
  if (!validDate(on)) return c.json({ error: "on must be a valid YYYY-MM-DD date" }, 400);

  const [water] = await db.select().from(waterBody).where(eq(waterBody.id, waterId));
  if (!water) return c.json({ error: "unknown water" }, 404);

  const reaches = await db.select().from(reach).where(eq(reach.waterBodyId, waterId));
  const reachIds = reaches.map((r) => r.id);
  const reachById = new Map(reaches.map((r) => [r.id, r]));

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
      or(isNull(regulation.validFrom), lte(regulation.validFrom, on)),
      or(isNull(regulation.validTo), gte(regulation.validTo, on)),
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

  // --- resolve each candidate into a rule row + season bookkeeping ---
  const resolved: ResolvedRule[] = [];
  for (const r of candidates) {
    const params = (r.parameters ?? {}) as Params;
    const scopeKey = r.targetType === "reach" ? `reach:${r.targetId}` : "water";
    const base: Omit<ResolvedRule, "_inForce" | "_activePeriodStatuses" | "periods"> = {
      regId: r.regId,
      ruleType: r.ruleType,
      summary: r.humanSummary,
      detail: params,
      citation: r.citation ?? r.groupCitation ?? null,
      sourceUrl: urlByReg.get(r.regId) ?? null,
      polarity: r.rulePolarity,
      confidence: r.confidence,
      appliesTo: r.appliesToClass,
      species: speciesByReg.get(r.regId) ?? [],
      _scopeKey: scopeKey,
      _authorityName: authNameById.get(r.authorityId),
    };

    if (r.ruleType === "season") {
      // season-type rules always render (they describe the calendar); annotate activeNow per period.
      const periodsRaw = Array.isArray((params as any).periods) ? (params as any).periods : [];
      const periods = periodsRaw.map((p: any) => {
        const active = windowResolvable(p.start as DateSpec, p.end as DateSpec)
          ? isDateInWindow(p.start as DateSpec, p.end as DateSpec, on)
          : false;
        return { label: p.label as string, status: p.status as PeriodStatus, activeNow: active };
      });
      const activeStatuses = periods.filter((p: any) => p.activeNow).map((p: any) => p.status as PeriodStatus);
      resolved.push({ ...base, _inForce: true, _activePeriodStatuses: activeStatuses, periods });
      continue;
    }

    if (r.seasonPeriodId != null && r.periodStart && r.periodEnd) {
      const start = r.periodStart as DateSpec;
      const end = r.periodEnd as DateSpec;
      if (!windowResolvable(start, end)) {
        // Unresolvable spec: activity unknown — keep the card, contribute no season evidence.
        resolved.push({ ...base, _inForce: false, _activePeriodStatuses: [] });
        continue;
      }
      if (!isDateInWindow(start, end, on)) continue; // resolved and out of window → not in force today
      resolved.push({ ...base, _inForce: true, _activePeriodStatuses: [r.periodStatus as PeriodStatus] });
      continue;
    }

    // Unbound rule (no season period): always in force (subject to validity, already filtered).
    resolved.push({ ...base, _inForce: true, _activePeriodStatuses: [] });
  }

  // --- derive per-scope status ---
  function deriveStatus(scopeRules: ResolvedRule[], isWaterScope: boolean): ScopeStatus {
    // 1. Active closure that closes this whole scope, or an active "closed" season period.
    for (const rr of scopeRules) {
      if (!rr._inForce) continue;
      if (rr.ruleType === "closure" && closureClosesScope(isWaterScope, rr.detail)) return "closed";
      if (rr._activePeriodStatuses.includes("closed")) return "closed";
    }

    // 2. Collect active season-period evidence for this scope. `_activePeriodStatuses` already
    //    folds in BOTH bound season_period bindings (in-window via isDateInWindow) AND `season`-rule
    //    parameters.periods entries that are active on `on`.
    let hasOpen = false;
    let hasOpenCR = false;
    for (const rr of scopeRules) {
      if (!rr._inForce) continue;
      for (const st of rr._activePeriodStatuses) {
        if (st === "open") hasOpen = true;
        else if (st === "open_catch_release") hasOpenCR = true;
      }
    }

    // 3. An open period exists. Scope status must reflect only bags that could permit harvest in
    //    THIS scope — an unrelated always-in-force catch-and-release protection bag for a different
    //    species (cui-ui at Pyramid, LCT at Independence) must not downgrade a keepable fishery.
    if (hasOpen) {
      const activeBags = scopeRules.filter((rr) => rr._inForce && rr.ruleType === "bag");
      const permitsHarvest = activeBags.some((rr) => {
        if (rr.polarity !== "applies") return false; // asserts_none bags are neutral, not permissive
        if (rr.detail.catch_and_release === true) return false;
        const daily = rr.detail.daily;
        return (typeof daily === "number" && daily > 0) || daily == null;
      });
      if (permitsHarvest) return "open";
      const hasCRBag = activeBags.some(
        (rr) => rr.detail.catch_and_release === true || rr.detail.daily === 0,
      );
      if (hasCRBag) return "catch_and_release";
      return "open"; // open season, no bag rule (or only asserts_none) → open
    }

    // 4. No open period, but an active catch-and-release ("open_catch_release") season period.
    if (hasOpenCR) return "catch_and_release";

    // 5. Nothing resolvable.
    return "unknown";
  }

  const serialize = (rr: ResolvedRule) => ({
    ruleType: rr.ruleType,
    summary: rr.summary,
    detail: rr.detail,
    citation: rr.citation,
    sourceUrl: rr.sourceUrl,
    polarity: rr.polarity,
    confidence: rr.confidence,
    appliesTo: rr.appliesTo,
    species: rr.species,
    ...(rr.periods ? { periods: rr.periods } : {}),
  });

  // license rules surface in a dedicated top-level section, not the scope rule cards.
  const licenseRules = resolved.filter((r) => r.ruleType === "license");
  const scopeableRules = resolved.filter((r) => r.ruleType !== "license");

  // --- assemble scopes: water first, then each reach in id order ---
  const scopes: Array<{ scope: string; kind: "water" | "reach"; sublabel: string | null; status: ScopeStatus; rules: ReturnType<typeof serialize>[] }> = [];

  const waterScopeRules = scopeableRules.filter((r) => r._scopeKey === "water");
  const waterStatus = deriveStatus(waterScopeRules, true);
  scopes.push({ scope: "water", kind: "water", sublabel: null, status: waterStatus, rules: waterScopeRules.map(serialize) });

  for (const rc of reaches) {
    const scopeRules = scopeableRules.filter((r) => r._scopeKey === `reach:${rc.id}`);
    if (scopeRules.length === 0) continue; // omit reaches with no applicable rules
    const status = deriveStatus(scopeRules, false);
    const sublabel = rc.fromDesc && rc.toDesc ? `${rc.fromDesc} → ${rc.toDesc}` : null;
    scopes.push({ scope: rc.name ?? `Reach ${rc.id}`, kind: "reach", sublabel, status, rules: scopeRules.map(serialize) });
  }

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

  const overall: ScopeStatus = waterStatus;

  return c.json({
    water: {
      id: water.id,
      name: water.name,
      waterType: water.waterType,
      states: water.states,
      counties: water.counties,
      verifyCurrent: water.verifyCurrent,
    },
    status: { overall, label: STATUS_LABEL[overall], verifyCurrent: water.verifyCurrent },
    scopes,
    licenses: licenseRules.map((r) => ({ ...serialize(r), authority: r._authorityName ?? null })),
    reciprocity: recRows,
    species: speciesRows,
    asOf: on,
  });
});
