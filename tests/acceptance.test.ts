import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../src/db/client";
import { regulation, regulationSpecies, regulationSource, regulationTarget, source } from "../src/db/schema";
import { validateParameters } from "../src/params";
import { checkSpeciesScope } from "../src/validation/allSpecies";
import { checkLegalInstrument } from "../src/validation/legalInstrument";
import { findOverlaps, ActiveRule } from "../src/validation/integrity";
import * as seed from "../src/seed/corridor";
import { SEED_MARKER } from "../src/seed/corridor";

afterAll(async () => { await closeDb(); });

describe("acceptance", () => {
  it("every seeded regulation validates against its Zod schema and satisfies the species-scope sentinel", async () => {
    // Only invoke the canonical seed functions — exports whose name starts with "seed" —
    // so internal helpers (e.g. ensureAuthority) and non-function exports (SEED_MARKER) are never called.
    for (const [name, fn] of Object.entries(seed)) {
      if (name.startsWith("seed") && typeof fn === "function") await (fn as () => Promise<unknown>)();
    }

    // Scope the sweep to the corridor seed rows (marked on `reviewer`); other test files leave
    // unrelated regulation rows in this shared database that are intentionally not species-scoped.
    const regs = await db.select().from(regulation).where(eq(regulation.reviewer, SEED_MARKER));
    expect(regs.length).toBeGreaterThan(0);

    const activeRules: ActiveRule[] = [];

    for (const r of regs) {
      // (a) parameters round-trip through the per-rule_type Zod schema.
      const v = validateParameters(r.ruleType, r.parameters);
      expect(v.success, `bad parameters for regulation ${r.id} (${r.ruleType})`).toBe(true);

      // (b) explicit all-species sentinel: a "listed" rule must carry ≥1 role=target species row.
      const sp = await db.select().from(regulationSpecies).where(eq(regulationSpecies.regulationId, r.id));
      const scope = checkSpeciesScope({ speciesScope: r.speciesScope }, sp);
      expect(scope.ok, `species-scope violation for regulation ${r.id} (${r.ruleType}): ${scope.reason}`).toBe(true);

      // (c) Legal-instrument check for published+binding rows.
      // No current seed row is published — this loop is intentionally vacuous but guards future
      // promotions: if any row is promoted to published+isBinding, it must carry a primary
      // primary_regulatory legal instrument source and non-empty verbatim text.
      if (r.status === "published" && r.isBinding) {
        const srcRows = await db
          .select({
            role: regulationSource.role,
            source: {
              authorityLevel: source.authorityLevel,
              instrumentType: source.instrumentType,
            },
          })
          .from(regulationSource)
          .innerJoin(source, eq(regulationSource.sourceId, source.id))
          .where(eq(regulationSource.regulationId, r.id));
        const li = checkLegalInstrument(r, srcRows);
        expect(li.ok, `legal-instrument violation for regulation ${r.id} (${r.ruleType}): ${li.reason}`).toBe(true);
      }

      // (d) Build an ActiveRule for the temporal-overlap sweep; reuse `sp` from check (b) and
      // fetch target rows. scopeKey = sorted "targetType:targetId" segments joined by ",";
      // speciesKey = sorted speciesId (or "g<groupId>" for group rows) joined by ",".
      const tgt = await db.select().from(regulationTarget).where(eq(regulationTarget.regulationId, r.id));
      const scopeKey = tgt
        .map((t) => `${t.targetType}:${t.targetId ?? ""}`)
        .sort()
        .join(",");
      const speciesKey = sp
        .map((s) => (s.speciesId != null ? String(s.speciesId) : `g${s.speciesGroupId}`))
        .sort()
        .join(",");
      activeRules.push({
        id: r.id,
        ruleType: r.ruleType,
        status: r.status,
        validFrom: r.validFrom,
        validTo: r.validTo,
        scopeKey,
        speciesKey,
      });
    }

    // (d) Assert no temporal overlaps among published rows with the same ruleType+scopeKey+speciesKey.
    // All current seed rows are status=verified so findOverlaps returns [] immediately; this guards
    // future promotion by catching overlapping validity windows before they reach production.
    expect(
      findOverlaps(activeRules),
      "temporal overlaps detected among seeded regulations",
    ).toHaveLength(0);
  });
});
