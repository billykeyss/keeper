import { db } from "../db/client";
import {
  authority, source, speciesGroup, regulationGroup, regulation,
  regulationSpecies, regulationSource, regulationTarget, waterBody,
} from "../db/schema";
import { validateParameters } from "../params";

// Internal helper — NOT exported so the acceptance sweep (which only calls exports
// whose name starts with "seed") never invokes it with no arguments.
async function ensureAuthority(name: string, state: string | null, type: any) {
  const [row] = await db.insert(authority).values({ name, state, type }).returning();
  return row;
}

/**
 * Canonical case 7 — Little Truckee River (Stampede → Boca): one `regulation_group`
 * decomposed into three atomic typed rows sharing one provision:
 *   season(all year, open) + bag(0 trout, catch_and_release) + gear_method(artificial + barbless).
 * Every `parameters` blob is validated by its Zod schema before insert; each row is
 * species-scoped ("listed") to the CDFW `trout` group via a `role:"target"` species row.
 */
export async function seedLittleTruckee() {
  const cdfw = await ensureAuthority("CDFW", "CA", "state_agency");
  const [wb] = await db.insert(waterBody).values({
    name: "Little Truckee River", waterType: "river", states: ["CA"], counties: ["Sierra"],
  }).returning();
  const [troutGroup] = await db.insert(speciesGroup).values({
    name: "trout", category: "trout", authorityId: cdfw.id,
  }).returning();
  const [src] = await db.insert(source).values({
    authorityId: cdfw.id, documentType: "webpage", instrumentType: "commission_reg",
    authorityLevel: "primary_regulatory",
    url: "https://govt.westlaw.com/calregs", title: "CCR T14 §7.50(b)(80)", sectionRef: "7.50(b)(80)",
    quotedText: "All year. Only artificial lures with barbless hooks may be used. 0 trout.",
  }).returning();
  const [grp] = await db.insert(regulationGroup).values({
    authorityId: cdfw.id, citation: "7.50(b)(80)",
    verbatimText: "All year. Only artificial lures with barbless hooks may be used. 0 trout.",
    humanSummary: "Year-round catch-and-release trout; artificial lures with barbless hooks",
  }).returning();

  const common = {
    authorityId: cdfw.id, regulationGroupId: grp.id, jurisdictionState: "CA",
    status: "verified" as const, confidence: "high" as const, citation: "7.50(b)(80)",
  };
  const rows = [
    {
      ruleType: "season" as const,
      humanSummary: "Open all year",
      verbatimText: "All year.",
      parameters: {
        periods: [{
          label: "all_year", status: "open",
          start: { type: "year_round", verbatim: "All year" },
          end: { type: "year_round", verbatim: "All year" },
        }],
      },
    },
    {
      ruleType: "bag" as const,
      humanSummary: "0 trout (catch-and-release)",
      verbatimText: "0 trout.",
      parameters: { daily: 0, possession: 0, unit: "fish", aggregation: "combined_group", catch_and_release: true },
    },
    {
      ruleType: "gear_method" as const,
      humanSummary: "Artificial lures with barbless hooks; no bait",
      verbatimText: "Only artificial lures with barbless hooks may be used.",
      parameters: {
        bait_allowed: false, artificial_only: true, flies_only: false,
        lures_allowed: true, barbless_required: true, single_hook_required: false,
      },
    },
  ];
  for (const r of rows) {
    const v = validateParameters(r.ruleType, r.parameters);
    if (!v.success) throw new Error(`seed param invalid for ${r.ruleType}: ${v.error}`);
    const [reg] = await db.insert(regulation).values({ ...common, ...r, speciesScope: "listed" }).returning();
    await db.insert(regulationSpecies).values({ regulationId: reg.id, speciesGroupId: troutGroup.id, role: "target", mode: "include" });
    await db.insert(regulationTarget).values({ regulationId: reg.id, targetType: "water_body", targetId: wb.id, mode: "include" });
    await db.insert(regulationSource).values({ regulationId: reg.id, sourceId: src.id, role: "primary", sectionRef: "7.50(b)(80)" });
  }
  return { groupId: grp.id };
}
