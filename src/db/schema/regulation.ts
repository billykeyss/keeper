import { pgTable, serial, integer, text, boolean, jsonb, date, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  ruleTypeEnum, rulePolarityEnum, basisEnum, speciesScopeEnum, anglerClassEnum,
  confidenceEnum, statusEnum, speciesRoleEnum, speciesModeEnum, targetTypeEnum,
  targetModeEnum, sourceRoleEnum, periodStatusEnum,
} from "../enums";
import { authority, waterBody, zone } from "./geography";
import { source } from "./source";
import { species, speciesGroup } from "./species";
import { stamps } from "../stamps";

export const regulationGroup = pgTable("regulation_group", {
  id: serial("id").primaryKey(),
  authorityId: integer("authority_id").notNull().references(() => authority.id),
  citation: text("citation"),
  verbatimText: text("verbatim_text"),
  humanSummary: text("human_summary"),
  note: text("note"),
  ...stamps,
});

export const seasonPeriod = pgTable("season_period", {
  id: serial("id").primaryKey(),
  regulationGroupId: integer("regulation_group_id").references(() => regulationGroup.id),
  label: text("label").notNull(),
  status: periodStatusEnum("status").notNull(),
  startSpec: jsonb("start_spec").notNull(),
  endSpec: jsonb("end_spec").notNull(),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  supersedesId: integer("supersedes_id"), // self-ref, intentionally not an FK (v2 may be inserted before v1); enforced in application layer
  ...stamps,
});

export const regulation = pgTable("regulation", {
  id: serial("id").primaryKey(),
  ruleType: ruleTypeEnum("rule_type").notNull(),
  parameters: jsonb("parameters").notNull(),
  regulationGroupId: integer("regulation_group_id").references(() => regulationGroup.id),
  seasonPeriodId: integer("season_period_id").references(() => seasonPeriod.id),
  authorityId: integer("authority_id").notNull().references(() => authority.id),
  originAuthorityId: integer("origin_authority_id").references(() => authority.id),
  requiredPermitAuthorityId: integer("required_permit_authority_id").references(() => authority.id),
  rulePolarity: rulePolarityEnum("rule_polarity").notNull().default("applies"),
  basis: basisEnum("basis").notNull().default("explicit"),
  precedence: integer("precedence").notNull().default(0),
  speciesScope: speciesScopeEnum("species_scope").notNull().default("listed"),
  appliesToClass: anglerClassEnum("applies_to_class").notNull().default("any"),
  appliesMinAge: integer("applies_min_age"),
  appliesMaxAge: integer("applies_max_age"),
  jurisdictionState: text("jurisdiction_state"),
  scopeCondition: text("scope_condition"),
  isBinding: boolean("is_binding").notNull().default(true),
  confidence: confidenceEnum("confidence").notNull().default("high"),
  citation: text("citation"),
  humanSummary: text("human_summary").notNull(),
  verbatimText: text("verbatim_text"),
  isParaphrase: boolean("is_paraphrase").notNull().default(false),
  status: statusEnum("status").notNull().default("draft"),
  reviewer: text("reviewer"),
  reviewedAt: timestamp("reviewed_at"),
  lastVerifiedAt: date("last_verified_at"),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  supersedesId: integer("supersedes_id"), // self-ref, intentionally not an FK (v2 may be inserted before v1); enforced in application layer
  ...stamps,
});

export const regulationSpecies = pgTable("regulation_species", {
  id: serial("id").primaryKey(),
  regulationId: integer("regulation_id").notNull().references(() => regulation.id),
  speciesId: integer("species_id").references(() => species.id),
  speciesGroupId: integer("species_group_id").references(() => speciesGroup.id),
  role: speciesRoleEnum("role").notNull().default("target"),
  mode: speciesModeEnum("mode").notNull().default("include"),
  ...stamps,
}, () => [
  check("reg_species_target_present", sql`species_id IS NOT NULL OR species_group_id IS NOT NULL`),
]);

export const regulationTarget = pgTable("regulation_target", {
  id: serial("id").primaryKey(),
  regulationId: integer("regulation_id").notNull().references(() => regulation.id),
  targetType: targetTypeEnum("target_type").notNull(),
  targetId: integer("target_id"),
  mode: targetModeEnum("mode").notNull().default("include"),
  ...stamps,
}, () => [
  check("reg_target_id_present", sql`target_type IN ('statewide','authority_territory') OR target_id IS NOT NULL`),
]);

export const regulationSource = pgTable("regulation_source", {
  id: serial("id").primaryKey(),
  regulationId: integer("regulation_id").notNull().references(() => regulation.id),
  sourceId: integer("source_id").notNull().references(() => source.id),
  role: sourceRoleEnum("role").notNull(),
  sectionRef: text("section_ref"),
  ...stamps,
});

export const licenseReciprocity = pgTable("license_reciprocity", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").references(() => waterBody.id),
  zoneId: integer("zone_id").references(() => zone.id),
  honoringAuthorityId: integer("honoring_authority_id").notNull().references(() => authority.id),
  honoredAuthorityId: integer("honored_authority_id").references(() => authority.id),
  honoredState: text("honored_state"),
  honored: boolean("honored").notNull(),
  replacesStateLicense: boolean("replaces_state_license").notNull().default(false),
  condition: jsonb("condition"),
  sourceId: integer("source_id").references(() => source.id),
  ...stamps,
});
