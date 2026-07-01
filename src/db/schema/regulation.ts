import { pgTable, serial, integer, text, boolean, jsonb, date, timestamp } from "drizzle-orm/pg-core";
import {
  ruleTypeEnum, rulePolarityEnum, basisEnum, speciesScopeEnum, anglerClassEnum,
  confidenceEnum, statusEnum, speciesRoleEnum, speciesModeEnum, targetTypeEnum,
  targetModeEnum, sourceRoleEnum, periodStatusEnum, documentTypeEnum,
  instrumentTypeEnum, authorityLevelEnum, fetchStatusEnum,
} from "../enums";
import { authority, waterBody, zone } from "./geography";

const stamps = { createdAt: timestamp("created_at").defaultNow().notNull(), updatedAt: timestamp("updated_at").defaultNow().notNull() };

export const source = pgTable("source", {
  id: serial("id").primaryKey(),
  authorityId: integer("authority_id").references(() => authority.id),
  documentType: documentTypeEnum("document_type").notNull(),
  instrumentType: instrumentTypeEnum("instrument_type"),
  authorityLevel: authorityLevelEnum("authority_level").notNull(),
  isOfficial: boolean("is_official").notNull().default(true),
  mirrorOfId: integer("mirror_of_id"),
  fetchStatus: fetchStatusEnum("fetch_status"),
  url: text("url"),
  title: text("title"),
  publishedDate: date("published_date"),
  retrievedDate: date("retrieved_date"),
  sectionRef: text("section_ref"),
  quotedText: text("quoted_text"),
  disputed: boolean("disputed").notNull().default(false),
  refutationNote: text("refutation_note"),
  ...stamps,
});

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
  supersedesId: integer("supersedes_id"),
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
  supersedesId: integer("supersedes_id"),
  ...stamps,
});

export const regulationSpecies = pgTable("regulation_species", {
  id: serial("id").primaryKey(),
  regulationId: integer("regulation_id").notNull().references(() => regulation.id),
  speciesId: integer("species_id"),
  speciesGroupId: integer("species_group_id"),
  role: speciesRoleEnum("role").notNull().default("target"),
  mode: speciesModeEnum("mode").notNull().default("include"),
  ...stamps,
});

export const regulationTarget = pgTable("regulation_target", {
  id: serial("id").primaryKey(),
  regulationId: integer("regulation_id").notNull().references(() => regulation.id),
  targetType: targetTypeEnum("target_type").notNull(),
  targetId: integer("target_id"),
  mode: targetModeEnum("mode").notNull().default("include"),
  ...stamps,
});

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
