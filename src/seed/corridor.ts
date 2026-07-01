import { db } from "../db/client";
import {
  authority, source, species, speciesGroup, regulationGroup, regulation, seasonPeriod,
  regulationSpecies, regulationSource, regulationTarget,
  waterBody, waterBodyRelation, reach, licenseReciprocity,
} from "../db/schema";
import { authorityTypeEnum } from "../db/enums";
import { validateParameters } from "../params";
import { dateSpec } from "../params/shared";

/**
 * Sentinel stamped on `reviewer` for every regulation these seeds insert. The acceptance
 * sweep filters on it so it validates exactly the corridor seed rows and never the
 * unrelated `regulation` rows left behind by other test files (e.g. versioning/asOf),
 * which share this database and are intentionally not species-scoped.
 */
export const SEED_MARKER = "corridor-seed";

// Internal helper — deliberately NOT exported so the acceptance sweep (which only calls
// exports whose name starts with "seed") never invokes it with no arguments.
async function createAuthority(name: string, state: string | null, type: typeof authorityTypeEnum.enumValues[number]) {
  const [row] = await db.insert(authority).values({ name, state, type }).returning();
  return row;
}

// Validate a parameters blob against its per-rule_type Zod schema; throw before insert on failure.
function assertValid(ruleType: string, parameters: unknown): unknown {
  const v = validateParameters(ruleType, parameters);
  if (!v.success) throw new Error(`seed param invalid for ${ruleType}: ${v.error}`);
  return parameters;
}

// Validate a season_period start/end blob against the shared `date_spec` Zod schema; throw
// before insert on failure so a malformed window can never reach the resolver.
function assertValidDateSpec(spec: unknown): unknown {
  const r = dateSpec.safeParse(spec);
  if (!r.success) throw new Error(`seed date_spec invalid: ${r.error.message}`);
  return spec;
}

/**
 * Canonical case 7 — Little Truckee River (Stampede → Boca): one `regulation_group`
 * decomposed into three atomic typed rows sharing one provision:
 *   season(all year, open) + bag(0 trout, catch_and_release) + gear_method(artificial + barbless).
 * Every `parameters` blob is validated by its Zod schema before insert; each row is
 * species-scoped ("listed") to the CDFW `trout` group via a `role:"target"` species row.
 */
export async function seedLittleTruckee() {
  const cdfw = await createAuthority("CDFW", "CA", "state_agency");
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
    reviewer: SEED_MARKER,
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
    assertValid(r.ruleType, r.parameters);
    const [reg] = await db.insert(regulation).values({ ...common, ...r, speciesScope: "listed" }).returning();
    await db.insert(regulationSpecies).values({ regulationId: reg.id, speciesGroupId: troutGroup.id, role: "target", mode: "include" });
    await db.insert(regulationTarget).values({ regulationId: reg.id, targetType: "water_body", targetId: wb.id, mode: "include" });
    await db.insert(regulationSource).values({ regulationId: reg.id, sourceId: src.id, role: "primary", sectionRef: "7.50(b)(80)" });
  }
  return { groupId: grp.id };
}

/**
 * Canonical case 1 — Topaz Lake compound bag: "25 warmwater game fish/day, of which ≤5
 * black bass." Encoded as one `bag` with a `carve_out` sub-limit; species-scoped to the
 * NV-authored `warmwater game fish` group.
 */
export async function seedTopazCompoundBag() {
  const ndow = await createAuthority("NDOW", "NV", "state_agency");
  const [wb] = await db.insert(waterBody).values({
    name: "Topaz Lake", waterType: "reservoir", states: ["CA", "NV"], counties: ["Douglas", "Mono"],
  }).returning();
  const [warmwater] = await db.insert(speciesGroup).values({
    name: "warmwater game fish", authorityId: ndow.id,
    description: "NV-scoped regulatory aggregate of warmwater game fish",
  }).returning();
  const [src] = await db.insert(source).values({
    authorityId: ndow.id, documentType: "webpage", instrumentType: "admin_code",
    authorityLevel: "primary_regulatory", url: "https://www.leg.state.nv.us/nac/nac-503.html",
    title: "NAC 503 — Topaz Lake", sectionRef: "NAC 503",
    quotedText: "25 warmwater game fish per day, of which not more than 5 may be black bass.",
  }).returning();

  const parameters = assertValid("bag", {
    daily: 25, possession: 25, unit: "fish", aggregation: "combined_group", relationship: "independent",
    sub_limits: [{ target: { species_group: "black_bass" }, mode: "carve_out", max_daily: 5, max_possession: 10 }],
  });
  const [bag] = await db.insert(regulation).values({
    ruleType: "bag", parameters, authorityId: ndow.id, jurisdictionState: "NV",
    humanSummary: "25 warmwater game fish/day; ≤5 black bass",
    verbatimText: "25 warmwater game fish per day, of which not more than 5 may be black bass.",
    citation: "NAC 503", speciesScope: "listed", status: "verified", confidence: "high", reviewer: SEED_MARKER,
  }).returning();
  await db.insert(regulationSpecies).values({ regulationId: bag.id, speciesGroupId: warmwater.id, role: "target", mode: "include" });
  await db.insert(regulationTarget).values({ regulationId: bag.id, targetType: "water_body", targetId: wb.id, mode: "include" });
  await db.insert(regulationSource).values({ regulationId: bag.id, sourceId: src.id, role: "primary", sectionRef: "NAC 503" });
  return { bag };
}

/**
 * Canonical case 3 — Pyramid Lake Lahontan cutthroat slot: keep 17–20" and 24"+, protected
 * slot 20–24" (fork length), ≤1 fish over 24". Species-scoped to the Lahontan cutthroat species.
 */
export async function seedPyramidSlot() {
  const tribe = await createAuthority("Pyramid Lake Paiute Tribe", null, "tribal");
  const [wb] = await db.insert(waterBody).values({
    name: "Pyramid Lake", waterType: "lake", states: ["NV"], counties: ["Washoe"],
  }).returning();
  const [lct] = await db.insert(species).values({
    commonName: "Lahontan cutthroat trout", scientificName: "Oncorhynchus clarkii henshawi",
    category: "trout", nativeStatus: "native",
  }).returning();
  const [src] = await db.insert(source).values({
    authorityId: tribe.id, documentType: "pdf", instrumentType: "tribal_ordinance",
    authorityLevel: "primary_regulatory", title: "Pyramid Lake Fishing Regulations", sectionRef: "PLPT Fishing Reg §3",
    quotedText: "Anglers may keep fish 17 to 20 inches and one fish 24 inches or larger; fish 20 to 24 inches must be released.",
  }).returning();

  const parameters = assertValid("size_limit", {
    min_length_in: 17, protected_slot: { min_in: 20, max_in: 24 },
    measurement: "fork_length", unit: "inch", over_slot_retention: { max_daily: 1, min_in: 24 },
    note: "Keep 17–20 in and 24 in+, at most one over 24 in; 20–24 in is a protected slot.",
  });
  const [size] = await db.insert(regulation).values({
    ruleType: "size_limit", parameters, authorityId: tribe.id, jurisdictionState: "NV",
    humanSummary: "Keep 17–20 in and 24 in+; protected slot 20–24 in (fork length); ≤1 over 24 in",
    verbatimText: "Anglers may keep fish 17 to 20 inches and one fish 24 inches or larger; fish 20 to 24 inches must be released.",
    citation: "PLPT Fishing Reg §3", speciesScope: "listed", status: "verified", confidence: "high", reviewer: SEED_MARKER,
  }).returning();
  await db.insert(regulationSpecies).values({ regulationId: size.id, speciesId: lct.id, role: "target", mode: "include" });
  await db.insert(regulationTarget).values({ regulationId: size.id, targetType: "water_body", targetId: wb.id, mode: "include" });
  await db.insert(regulationSource).values({ regulationId: size.id, sourceId: src.id, role: "primary", sectionRef: "PLPT Fishing Reg §3" });
  return { size };
}

/**
 * Canonical case 4 — Truckee River Reach A closure: closed all year for 1,000 ft below the
 * Lake Tahoe outlet dam. The reach uses an anchor+offset terminus (geometry null); the
 * `closure` targets the reach; the Truckee-is-outlet-of-Tahoe fact lives in `water_body_relation`.
 * Not species-scoped → species_scope "all", no target species row.
 */
export async function seedTruckeeReachClosure() {
  const cdfw = await createAuthority("CDFW", "CA", "state_agency");
  const [tahoe] = await db.insert(waterBody).values({
    name: "Lake Tahoe", waterType: "lake", states: ["CA", "NV"], counties: ["El Dorado", "Placer", "Washoe", "Douglas"],
  }).returning();
  const [truckee] = await db.insert(waterBody).values({
    name: "Truckee River", waterType: "river", states: ["CA"], counties: ["Placer", "Nevada"],
  }).returning();
  await db.insert(waterBodyRelation).values({ fromWaterBodyId: truckee.id, toWaterBodyId: tahoe.id, relation: "outlet" });

  const [reachRow] = await db.insert(reach).values({
    waterBodyId: truckee.id, name: "Truckee River Reach A",
    fromDesc: "Lake Tahoe outlet dam", toDesc: "1,000 ft below the Lake Tahoe outlet dam",
    fromAnchorFeature: "Lake Tahoe outlet dam", fromOffsetFt: 0, fromDirection: "downstream",
    toAnchorFeature: "Lake Tahoe outlet dam", toOffsetFt: 1000, toDirection: "downstream",
    county: "Placer",
  }).returning();
  const [src] = await db.insert(source).values({
    authorityId: cdfw.id, documentType: "webpage", instrumentType: "commission_reg",
    authorityLevel: "primary_regulatory", url: "https://govt.westlaw.com/calregs",
    title: "CCR T14 §7.50(b) — Truckee River", sectionRef: "7.50(b)",
    quotedText: "Closed all year from the Lake Tahoe dam downstream to 1,000 feet below the dam.",
  }).returning();

  const parameters = assertValid("closure", {
    closure_kind: "year_round", boundary_definition: "described",
    note: "No fishing within 1,000 ft below the Lake Tahoe outlet dam.",
  });
  const [closureReg] = await db.insert(regulation).values({
    ruleType: "closure", parameters, authorityId: cdfw.id, jurisdictionState: "CA",
    humanSummary: "Closed all year: 1,000 ft below the Lake Tahoe outlet dam",
    verbatimText: "Closed all year from the Lake Tahoe dam downstream to 1,000 feet below the dam.",
    citation: "7.50(b)", speciesScope: "all", status: "verified", confidence: "high", reviewer: SEED_MARKER,
  }).returning();
  const [target] = await db.insert(regulationTarget).values({
    regulationId: closureReg.id, targetType: "reach", targetId: reachRow.id, mode: "include",
  }).returning();
  await db.insert(regulationSource).values({ regulationId: closureReg.id, sourceId: src.id, role: "primary", sectionRef: "7.50(b)" });
  return { reach: reachRow, target };
}

/**
 * Canonical case 5 — Interstate license reciprocity: Lake Tahoe honors a CA or NV license
 * (NV side needs a trout stamp) → `honored=true`; Donner Lake explicitly does not → `honored=false`.
 * Two `license_reciprocity` rows (no `regulation` rows).
 */
export async function seedReciprocity() {
  const cdfw = await createAuthority("CDFW", "CA", "state_agency");
  const ndow = await createAuthority("NDOW", "NV", "state_agency");
  const [tahoeWb] = await db.insert(waterBody).values({
    name: "Lake Tahoe", waterType: "lake", states: ["CA", "NV"], counties: ["El Dorado", "Placer", "Washoe", "Douglas"],
  }).returning();
  const [donnerWb] = await db.insert(waterBody).values({
    name: "Donner Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"],
  }).returning();
  const [src] = await db.insert(source).values({
    authorityId: cdfw.id, documentType: "webpage", instrumentType: "statute",
    authorityLevel: "primary_regulatory", url: "https://wildlife.ca.gov",
    title: "Interstate license reciprocity — Lake Tahoe", sectionRef: "F&G Code §7360",
    quotedText: "A valid California or Nevada sport fishing license is honored on Lake Tahoe; the Nevada portion requires a trout stamp.",
  }).returning();

  const [tahoe] = await db.insert(licenseReciprocity).values({
    waterBodyId: tahoeWb.id, honoringAuthorityId: cdfw.id, honoredAuthorityId: ndow.id,
    honoredState: "NV", honored: true, condition: { nv_trout_stamp_required: true }, sourceId: src.id,
  }).returning();
  const [donner] = await db.insert(licenseReciprocity).values({
    waterBodyId: donnerWb.id, honoringAuthorityId: cdfw.id, honoredAuthorityId: ndow.id,
    honoredState: "NV", honored: false, sourceId: src.id,
  }).returning();
  return { tahoe, donner };
}

/**
 * Canonical case 6 — Pyramid Lake tribal permit: a tribal fishing permit replaces the state
 * license for non-tribal anglers age 12+. Scope is reservation-wide via
 * `target_type=authority_territory` (enumerated). Not species-scoped → species_scope "all".
 */
export async function seedPyramidTribalPermit() {
  const tribe = await createAuthority("Pyramid Lake Paiute Tribe", null, "tribal");
  const [src] = await db.insert(source).values({
    authorityId: tribe.id, documentType: "pdf", instrumentType: "tribal_ordinance",
    authorityLevel: "primary_regulatory", title: "Pyramid Lake Fishing Permit Ordinance", sectionRef: "PLPT Permit Ord §1",
    quotedText: "A tribal fishing permit is required and replaces the State of Nevada fishing license for non-tribal anglers 12 years of age and older.",
  }).returning();

  const parameters = assertValid("license", {
    required: true, min_age: 12, replaces_state_license: true, issuing_authority_id: tribe.id,
    required_product_note: "Pyramid Lake tribal fishing permit (daily or season).",
  });
  const [license] = await db.insert(regulation).values({
    ruleType: "license", parameters, authorityId: tribe.id, requiredPermitAuthorityId: tribe.id, jurisdictionState: "NV",
    appliesToClass: "non_tribal", appliesMinAge: 12,
    humanSummary: "Tribal permit required (replaces the NV license) for non-tribal anglers 12+",
    verbatimText: "A tribal fishing permit is required and replaces the State of Nevada fishing license for non-tribal anglers 12 years of age and older.",
    citation: "PLPT Permit Ord §1", speciesScope: "all", status: "verified", confidence: "high", reviewer: SEED_MARKER,
  }).returning();
  const [target] = await db.insert(regulationTarget).values({
    regulationId: license.id, targetType: "authority_territory", targetId: tribe.id, mode: "include",
  }).returning();
  await db.insert(regulationSource).values({ regulationId: license.id, sourceId: src.id, role: "primary", sectionRef: "PLPT Permit Ord §1" });
  return { license, target };
}

/**
 * Canonical case 9 — Lake Tahoe AIS gate: motorized watercraft require inspection,
 * decontamination, an inspection seal, and drain-plug-out. Not species-scoped → species_scope "all".
 */
export async function seedTahoeAis() {
  // Bi-state Tahoe Regional Planning Agency exercises regulatory authority over the basin.
  // No perfect authority_type enum fit for a bi-state compact agency; "state_agency" is the closest.
  const trpa = await createAuthority("Tahoe Regional Planning Agency", null, "state_agency");
  const [wb] = await db.insert(waterBody).values({
    name: "Lake Tahoe", waterType: "lake", states: ["CA", "NV"], counties: ["El Dorado", "Placer", "Washoe", "Douglas"],
  }).returning();
  const [src] = await db.insert(source).values({
    authorityId: trpa.id, documentType: "webpage", instrumentType: "admin_code",
    authorityLevel: "primary_regulatory", url: "https://tahoeboatinspections.com",
    title: "Lake Tahoe Region Aquatic Invasive Species Program", sectionRef: "TRPA Code Ch. 63",
    quotedText: "All motorized watercraft must be inspected and decontaminated, carry a Tahoe inspection seal, and drain all water before launching.",
  }).returning();

  const parameters = assertValid("ais", {
    inspection_required: true, decontamination_required: true, seal_or_sticker_required: true,
    drain_plug_out_required: true, applies_to: "motorized",
    sticker_note: "Tahoe inspection seal must remain intact between launches.",
    status_source_url: "https://tahoeboatinspections.com",
  });
  const [ais] = await db.insert(regulation).values({
    ruleType: "ais", parameters, authorityId: trpa.id,
    humanSummary: "Motorized watercraft: mandatory inspection, decontamination, seal, and drain-plug-out",
    verbatimText: "All motorized watercraft must be inspected and decontaminated, carry a Tahoe inspection seal, and drain all water before launching.",
    citation: "TRPA Code Ch. 63", speciesScope: "all", status: "verified", confidence: "high", reviewer: SEED_MARKER,
  }).returning();
  await db.insert(regulationTarget).values({ regulationId: ais.id, targetType: "water_body", targetId: wb.id, mode: "include" });
  await db.insert(regulationSource).values({ regulationId: ais.id, sourceId: src.id, role: "primary", sectionRef: "TRPA Code Ch. 63" });
  return { ais };
}

/**
 * Canonical case 8 — Verified absence: NV Truckee River trout have NO size limit. Recorded as a
 * `size_limit` with `rule_polarity=asserts_none`, all-null lengths, `is_paraphrase=true`. A
 * secondary "14-inch minimum" claim is stored as a `disputed` source with a refutation note.
 * Species-scoped (still about trout) → species_scope "listed" with a target species-group row.
 */
export async function seedNvTruckeeNoSizeLimit() {
  const ndow = await createAuthority("NDOW", "NV", "state_agency");
  const [wb] = await db.insert(waterBody).values({
    name: "Truckee River", waterType: "river", states: ["NV"], counties: ["Washoe"],
  }).returning();
  const [troutGroup] = await db.insert(speciesGroup).values({
    name: "trout", authorityId: ndow.id, description: "NV-scoped trout aggregate",
  }).returning();
  // Primary legal instrument confirming there is NO minimum size for trout on the NV Truckee.
  const [primarySrc] = await db.insert(source).values({
    authorityId: ndow.id, documentType: "webpage", instrumentType: "admin_code",
    authorityLevel: "primary_regulatory", url: "https://www.leg.state.nv.us/nac/nac-503.html",
    title: "NAC 503 — Truckee River (Washoe Co.)", sectionRef: "NAC 503",
    quotedText: "Trout: no minimum size limit.",
  }).returning();
  // Refuted secondary claim of a 14-inch minimum — recorded as a disputed source with a
  // refutation note (kept as provenance of the rejected claim, not cited as support).
  const [disputedSrc] = await db.insert(source).values({
    authorityId: ndow.id, documentType: "booklet", instrumentType: "guide",
    authorityLevel: "third_party", isOfficial: false,
    title: "Third-party fishing guide (Truckee River)", sectionRef: "p. 12",
    quotedText: "Truckee River trout must be at least 14 inches.",
    disputed: true,
    refutationNote: "No 14-inch minimum exists in NAC 503; the figure was a third-party guide error. Verified absence recorded as asserts_none.",
  }).returning();

  const parameters = assertValid("size_limit", {
    min_length_in: null, max_length_in: null, protected_slot: null,
    measurement: "total_length", unit: "inch", note: "No minimum or maximum size limit for trout.",
  });
  const [size] = await db.insert(regulation).values({
    ruleType: "size_limit", parameters, authorityId: ndow.id, jurisdictionState: "NV",
    rulePolarity: "asserts_none", isParaphrase: true, verbatimText: null,
    humanSummary: "No size limit for trout (verified absence)",
    citation: "NAC 503", speciesScope: "listed", status: "verified", confidence: "high", reviewer: SEED_MARKER,
  }).returning();
  await db.insert(regulationSpecies).values({ regulationId: size.id, speciesGroupId: troutGroup.id, role: "target", mode: "include" });
  await db.insert(regulationTarget).values({ regulationId: size.id, targetType: "water_body", targetId: wb.id, mode: "include" });
  await db.insert(regulationSource).values({ regulationId: size.id, sourceId: primarySrc.id, role: "primary", sectionRef: "NAC 503" });
  return { size, source: disputedSrc };
}

/**
 * Canonical case 2 — Truckee River Reach C two-period trout season (CDFW §7.50(b)(154)(C)).
 * The showcase for the `season_period` design: one `regulation_group` owns two dated windows that
 * are the single source of truth for the season boundaries, and the `bag` rows bind to them by
 * `season_period_id` instead of re-embedding dates.
 *   - take_season (status `open`): relative last Saturday in April → fixed Nov 15.
 *   - winter_cr  (status `open_catch_release`): fixed Nov 16 → the Friday *preceding* the last
 *     Saturday in April (relative last Sat Apr, offset −1 day).
 * Every start/end `date_spec` is validated against the shared `dateSpec` Zod schema before insert
 * (so it round-trips through `resolveDateSpec`). Two season-conditional `bag` rows bind the windows:
 * 2 trout in the take window, 0 trout (catch_and_release) in the winter window — no date duplication.
 * Both bags are species-scoped ("listed") to the CDFW `trout` group via a `role:"target"` row.
 */
export async function seedTruckeeReachC() {
  const cdfw = await createAuthority("CDFW", "CA", "state_agency");
  const [wb] = await db.insert(waterBody).values({
    name: "Truckee River", waterType: "river", states: ["CA"], counties: ["Nevada", "Placer"],
  }).returning();

  // Reach C row — geographic anchor per CDFW §7.50(b)(154)(C): Glenshire Drive bridge
  // downstream to the Nevada state line (near Farad). Geometry intentionally null.
  const [reachC] = await db.insert(reach).values({
    waterBodyId: wb.id,
    name: "Truckee River Reach C",
    fromDesc: "Glenshire Drive bridge, Truckee (downstream end of Reach B)",
    toDesc: "Nevada state line (near Farad gauging station)",
    county: "Nevada",
  }).returning();

  const [troutGroup] = await db.insert(speciesGroup).values({
    name: "trout", category: "trout", authorityId: cdfw.id,
  }).returning();
  const [src] = await db.insert(source).values({
    authorityId: cdfw.id, documentType: "webpage", instrumentType: "commission_reg",
    authorityLevel: "primary_regulatory", url: "https://govt.westlaw.com/calregs",
    title: "CCR T14 §7.50(b)(154)(C) — Truckee River Reach C", sectionRef: "7.50(b)(154)(C)",
    quotedText: "From the last Saturday in April through November 15, 2 trout. From November 16 through the Friday preceding the last Saturday in April, 0 trout (catch-and-release).",
  }).returning();
  const [grp] = await db.insert(regulationGroup).values({
    authorityId: cdfw.id, citation: "7.50(b)(154)(C)",
    verbatimText: "From the last Saturday in April through November 15, 2 trout. From November 16 through the Friday preceding the last Saturday in April, 0 trout (catch-and-release).",
    humanSummary: "Two-period trout season: 2 trout (last Sat Apr–Nov 15); 0 trout catch-and-release (Nov 16–Fri before last Sat Apr)",
  }).returning();

  // --- season_period windows: single source of truth for the boundary dates. Each start/end
  // date_spec is validated against the shared `dateSpec` Zod schema before insert. ---
  const takeStartSpec = assertValidDateSpec({ type: "relative", ordinal: "last", weekday: "sat", month: 4, verbatim: "last Saturday in April" });
  const takeEndSpec = assertValidDateSpec({ type: "fixed", month: 11, day: 15, verbatim: "November 15" });
  const winterStartSpec = assertValidDateSpec({ type: "fixed", month: 11, day: 16, verbatim: "November 16" });
  const winterEndSpec = assertValidDateSpec({ type: "relative", ordinal: "last", weekday: "sat", month: 4, relation: "preceding", offset_days: -1, verbatim: "Friday preceding the last Saturday in April" });

  const [takePeriod] = await db.insert(seasonPeriod).values({
    regulationGroupId: grp.id, label: "take_season", status: "open",
    startSpec: takeStartSpec, endSpec: takeEndSpec,
  }).returning();
  const [winterPeriod] = await db.insert(seasonPeriod).values({
    regulationGroupId: grp.id, label: "winter_cr", status: "open_catch_release",
    startSpec: winterStartSpec, endSpec: winterEndSpec,
  }).returning();

  // --- season-conditional bag bindings: reference each window by id (no date duplication). ---
  const common = {
    ruleType: "bag" as const, authorityId: cdfw.id, regulationGroupId: grp.id, jurisdictionState: "CA",
    citation: "7.50(b)(154)(C)", speciesScope: "listed" as const,
    status: "verified" as const, confidence: "high" as const, reviewer: SEED_MARKER,
  };

  const takeBagParams = assertValid("bag", { daily: 2, unit: "fish", aggregation: "combined_group" });
  const [takeBag] = await db.insert(regulation).values({
    ...common, seasonPeriodId: takePeriod.id, parameters: takeBagParams,
    humanSummary: "2 trout during the take season (last Sat Apr–Nov 15)",
    verbatimText: "From the last Saturday in April through November 15, 2 trout.",
  }).returning();
  await db.insert(regulationSpecies).values({ regulationId: takeBag.id, speciesGroupId: troutGroup.id, role: "target", mode: "include" });
  const [takeBagTarget] = await db.insert(regulationTarget).values({ regulationId: takeBag.id, targetType: "reach", targetId: reachC.id, mode: "include" }).returning();
  await db.insert(regulationSource).values({ regulationId: takeBag.id, sourceId: src.id, role: "primary", sectionRef: "7.50(b)(154)(C)" });

  const winterBagParams = assertValid("bag", { daily: 0, unit: "fish", aggregation: "combined_group", catch_and_release: true });
  const [winterBag] = await db.insert(regulation).values({
    ...common, seasonPeriodId: winterPeriod.id, parameters: winterBagParams,
    humanSummary: "0 trout, catch-and-release during the winter window (Nov 16–Fri before last Sat Apr)",
    verbatimText: "From November 16 through the Friday preceding the last Saturday in April, 0 trout (catch-and-release).",
  }).returning();
  await db.insert(regulationSpecies).values({ regulationId: winterBag.id, speciesGroupId: troutGroup.id, role: "target", mode: "include" });
  const [winterBagTarget] = await db.insert(regulationTarget).values({ regulationId: winterBag.id, targetType: "reach", targetId: reachC.id, mode: "include" }).returning();
  await db.insert(regulationSource).values({ regulationId: winterBag.id, sourceId: src.id, role: "primary", sectionRef: "7.50(b)(154)(C)" });

  return { takePeriod, winterPeriod, takeBag, winterBag, reachC, takeBagTarget, winterBagTarget };
}
