import { sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  authority, waterBody, waterBodyAuthority, reach, species, speciesGroup, speciesGroupMember,
  waterBodySpecies, source, regulationGroup, seasonPeriod, regulation, regulationSpecies,
  regulationTarget, regulationSource, licenseReciprocity,
} from "../db/schema";
import { validateParameters } from "../params";
import { dateSpec } from "../params/shared";
import { checkSpeciesScope } from "../validation/allSpecies";
import type { WaterDataset } from "./datasetSchema";

// Exact domain table list, in an order that reads FK-dependents-first (CASCADE makes the
// order non-load-bearing, but this keeps the statement self-documenting and matches the
// migration bookkeeping table's isolation: drizzle's `__drizzle_migrations` is untouched).
const TRUNCATE_TABLES = [
  "license_reciprocity", "regulation_source", "regulation_target", "regulation_species", "regulation",
  "season_period", "regulation_group", "water_body_species", "species_group_member", "species_group",
  "species_alias", "species", "reach", "zone", "water_body_relation", "water_body_authority", "water_body",
  "source", "authority", "audit_log",
].join(", ");

/**
 * Wipe-and-reload corridor loader: truncates every domain table, then inserts every dataset
 * inside a single transaction. Any validation failure (parameters, date specs, unknown key
 * references, species-scope) throws and rolls back the whole load — nothing partial commits.
 * Authorities are deduped across files by `name` (a shared registry keyed by name, not by the
 * per-file local `key`), since multiple water files reference the same CDFW/NDOW/tribal rows.
 */
export async function loadDatasets(dbc: typeof db, datasets: WaterDataset[]): Promise<{ waters: number; regulations: number }> {
  return await dbc.transaction(async (tx) => {
    await tx.execute(sql.raw(`TRUNCATE ${TRUNCATE_TABLES} RESTART IDENTITY CASCADE`));

    const authorityRegistry = new Map<string, number>(); // authority name -> id, shared across files
    let waterCount = 0;
    let regulationCount = 0;

    for (const ds of datasets) {
      // --- authorities (cross-file dedupe by name) ---
      const authorityIdByKey = new Map<string, number>();
      for (const a of ds.authorities) {
        let id = authorityRegistry.get(a.name);
        if (id === undefined) {
          const [row] = await tx.insert(authority).values({ name: a.name, state: a.state, type: a.type }).returning();
          id = row.id;
          authorityRegistry.set(a.name, id);
        }
        authorityIdByKey.set(a.key, id);
      }

      // --- water ---
      const [wb] = await tx.insert(waterBody).values({
        name: ds.water.name, waterType: ds.water.waterType, states: ds.water.states, counties: ds.water.counties,
        aliases: ds.water.aliases, gnisId: ds.water.gnisId, verifyCurrent: ds.water.verifyCurrent,
        geom: `SRID=4326;POINT(${ds.water.lon} ${ds.water.lat})`,
      }).returning();
      waterCount++;

      // --- water_body_authority, one row per (authority, role) ---
      for (const a of ds.authorities) {
        const authorityId = authorityIdByKey.get(a.key)!;
        for (const role of a.roles) {
          await tx.insert(waterBodyAuthority).values({ waterBodyId: wb.id, authorityId, role });
        }
      }

      // --- reaches: descriptors only; geom stays null (v1 renders only the water pin) ---
      const reachIdByKey = new Map<string, number>();
      for (const r of ds.reaches) {
        const [row] = await tx.insert(reach).values({
          waterBodyId: wb.id, name: r.name, fromDesc: r.fromDesc, toDesc: r.toDesc,
        }).returning();
        reachIdByKey.set(r.key, row.id);
      }

      // --- species + water_body_species presence ---
      const speciesIdByCommonName = new Map<string, number>();
      for (const s of ds.species) {
        const [row] = await tx.insert(species).values({
          commonName: s.commonName, scientificName: s.scientificName, category: s.category, nativeStatus: s.nativeStatus,
        }).returning();
        speciesIdByCommonName.set(s.commonName, row.id);
        await tx.insert(waterBodySpecies).values({ waterBodyId: wb.id, speciesId: row.id, presence: s.presence });
      }

      // --- species groups (+ members for species sharing the group's category) ---
      const speciesGroupIdByKey = new Map<string, number>();
      for (const g of ds.speciesGroups) {
        const authorityId = g.authorityKey ? (authorityIdByKey.get(g.authorityKey) ?? null) : null;
        const [row] = await tx.insert(speciesGroup).values({ name: g.name, category: g.category, authorityId }).returning();
        speciesGroupIdByKey.set(g.key, row.id);
        if (g.category) {
          for (const s of ds.species) {
            if (s.category === g.category) {
              await tx.insert(speciesGroupMember).values({ groupId: row.id, speciesId: speciesIdByCommonName.get(s.commonName)! });
            }
          }
        }
      }

      // --- sources ---
      const sourceIdByKey = new Map<string, number>();
      for (const s of ds.sources) {
        const authorityId = authorityIdByKey.get(s.authorityKey);
        if (authorityId === undefined) throw new Error(`${ds.water.name}: source '${s.key}' references unknown authorityKey '${s.authorityKey}'`);
        const [row] = await tx.insert(source).values({
          authorityId, documentType: s.documentType, instrumentType: s.instrumentType, authorityLevel: s.authorityLevel,
          url: s.url, title: s.title, retrievedDate: s.retrievedDate, quotedText: s.quotedText,
        }).returning();
        sourceIdByKey.set(s.key, row.id);
      }

      // --- regulation groups ---
      const groupIdByKey = new Map<string, number>();
      for (const g of ds.groups) {
        const authorityId = authorityIdByKey.get(g.authorityKey);
        if (authorityId === undefined) throw new Error(`${ds.water.name}: group '${g.key}' references unknown authorityKey '${g.authorityKey}'`);
        const [row] = await tx.insert(regulationGroup).values({
          authorityId, citation: g.citation, humanSummary: g.humanSummary, verbatimText: g.verbatimText,
        }).returning();
        groupIdByKey.set(g.key, row.id);
      }

      // --- season periods (validate start/end date specs before insert) ---
      const seasonPeriodIdByKey = new Map<string, number>();
      for (const sp of ds.seasonPeriods) {
        dateSpec.parse(sp.startSpec);
        dateSpec.parse(sp.endSpec);
        const regulationGroupId = sp.groupKey ? (groupIdByKey.get(sp.groupKey) ?? null) : null;
        const [row] = await tx.insert(seasonPeriod).values({
          regulationGroupId, label: sp.label, status: sp.status, startSpec: sp.startSpec, endSpec: sp.endSpec,
        }).returning();
        seasonPeriodIdByKey.set(sp.key, row.id);
      }

      // --- regulations + satellites ---
      for (const r of ds.regulations) {
        const v = validateParameters(r.ruleType, r.parameters);
        if (!v.success) throw new Error(`${ds.water.name}/${r.ruleType}: ${v.error}`);

        const authorityId = authorityIdByKey.get(r.authorityKey);
        if (authorityId === undefined) throw new Error(`${ds.water.name}/${r.ruleType}: unknown authorityKey '${r.authorityKey}'`);
        const regulationGroupId = r.groupKey ? (groupIdByKey.get(r.groupKey) ?? null) : null;
        const seasonPeriodId = r.seasonPeriodKey ? (seasonPeriodIdByKey.get(r.seasonPeriodKey) ?? null) : null;

        const [reg] = await tx.insert(regulation).values({
          ruleType: r.ruleType, parameters: v.data, regulationGroupId, seasonPeriodId, authorityId,
          rulePolarity: r.rulePolarity, basis: "explicit", speciesScope: r.speciesScope, appliesToClass: r.appliesToClass,
          jurisdictionState: r.jurisdictionState, citation: r.citation, humanSummary: r.humanSummary,
          verbatimText: r.verbatimText, isParaphrase: r.isParaphrase, confidence: r.confidence,
          status: "verified", reviewer: "corridor-ingest", lastVerifiedAt: ds.asOf, validFrom: null,
        }).returning();
        regulationCount++;

        // regulation_species targets
        const insertedSpeciesRows: Array<{ role: string }> = [];
        for (const t of r.speciesTargets) {
          if ("speciesGroupKey" in t) {
            const speciesGroupId = speciesGroupIdByKey.get(t.speciesGroupKey);
            if (speciesGroupId === undefined) throw new Error(`${ds.water.name}/${r.ruleType}: unknown speciesGroupKey '${t.speciesGroupKey}'`);
            await tx.insert(regulationSpecies).values({ regulationId: reg.id, speciesGroupId, role: "target", mode: "include" });
          } else {
            const speciesId = speciesIdByCommonName.get(t.speciesCommonName);
            if (speciesId === undefined) throw new Error(`${ds.water.name}/${r.ruleType}: unknown speciesCommonName '${t.speciesCommonName}'`);
            await tx.insert(regulationSpecies).values({ regulationId: reg.id, speciesId, role: "target", mode: "include" });
          }
          insertedSpeciesRows.push({ role: "target" });
        }

        // regulation_target
        if (r.scope.type === "water") {
          await tx.insert(regulationTarget).values({ regulationId: reg.id, targetType: "water_body", targetId: wb.id, mode: "include" });
        } else if (r.scope.type === "reach") {
          const reachId = reachIdByKey.get(r.scope.reachKey);
          if (reachId === undefined) throw new Error(`${ds.water.name}/${r.ruleType}: unknown reachKey '${r.scope.reachKey}'`);
          await tx.insert(regulationTarget).values({ regulationId: reg.id, targetType: "reach", targetId: reachId, mode: "include" });
        } else {
          const territoryAuthorityId = authorityIdByKey.get(r.scope.authorityKey);
          if (territoryAuthorityId === undefined) throw new Error(`${ds.water.name}/${r.ruleType}: unknown authorityKey '${r.scope.authorityKey}' in scope`);
          await tx.insert(regulationTarget).values({ regulationId: reg.id, targetType: "authority_territory", targetId: territoryAuthorityId, mode: "include" });
        }

        // regulation_source: primary + corroborating
        const primarySourceId = sourceIdByKey.get(r.sourceKeys.primary);
        if (primarySourceId === undefined) throw new Error(`${ds.water.name}/${r.ruleType}: unknown primary sourceKey '${r.sourceKeys.primary}'`);
        await tx.insert(regulationSource).values({ regulationId: reg.id, sourceId: primarySourceId, role: "primary" });
        for (const ck of r.sourceKeys.corroborating) {
          const corroboratingSourceId = sourceIdByKey.get(ck);
          if (corroboratingSourceId === undefined) throw new Error(`${ds.water.name}/${r.ruleType}: unknown corroborating sourceKey '${ck}'`);
          await tx.insert(regulationSource).values({ regulationId: reg.id, sourceId: corroboratingSourceId, role: "corroborating" });
        }

        // post-insert species-scope check (belt-and-suspenders on top of the schema refine)
        const scopeCheck = checkSpeciesScope({ speciesScope: r.speciesScope }, insertedSpeciesRows);
        if (!scopeCheck.ok) throw new Error(`${ds.water.name}/${r.ruleType}: ${scopeCheck.reason}`);
      }

      // --- reciprocity (water-scoped) ---
      for (const rec of ds.reciprocity) {
        const honoringAuthorityId = authorityIdByKey.get(rec.honoringAuthorityKey);
        if (honoringAuthorityId === undefined) throw new Error(`${ds.water.name}: reciprocity references unknown honoringAuthorityKey '${rec.honoringAuthorityKey}'`);
        const honoredAuthorityId = rec.honoredAuthorityKey ? (authorityIdByKey.get(rec.honoredAuthorityKey) ?? null) : null;
        const sourceId = sourceIdByKey.get(rec.sourceKey);
        if (sourceId === undefined) throw new Error(`${ds.water.name}: reciprocity references unknown sourceKey '${rec.sourceKey}'`);
        await tx.insert(licenseReciprocity).values({
          waterBodyId: wb.id, honoringAuthorityId, honoredAuthorityId, honored: rec.honored,
          replacesStateLicense: rec.replacesStateLicense, condition: rec.condition, sourceId,
        });
      }
    }

    return { waters: waterCount, regulations: regulationCount };
  });
}
