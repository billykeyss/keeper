import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../src/db/client";
import { regulation, regulationSpecies } from "../src/db/schema";
import { validateParameters } from "../src/params";
import { checkSpeciesScope } from "../src/validation/allSpecies";
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

    for (const r of regs) {
      // (a) parameters round-trip through the per-rule_type Zod schema.
      const v = validateParameters(r.ruleType, r.parameters);
      expect(v.success, `bad parameters for regulation ${r.id} (${r.ruleType})`).toBe(true);

      // (b) explicit all-species sentinel: a "listed" rule must carry ≥1 role=target species row.
      const sp = await db.select().from(regulationSpecies).where(eq(regulationSpecies.regulationId, r.id));
      const scope = checkSpeciesScope({ speciesScope: r.speciesScope }, sp);
      expect(scope.ok, `species-scope violation for regulation ${r.id} (${r.ruleType}): ${scope.reason}`).toBe(true);
    }
  });
});
