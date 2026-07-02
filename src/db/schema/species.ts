import { pgTable, serial, integer, text, date } from "drizzle-orm/pg-core";
import { speciesCategoryEnum, nativeStatusEnum, presenceEnum, stockingFrequencyEnum } from "../enums";
import { authority, waterBody } from "./geography";
import { source } from "./source";
import { stamps } from "../stamps";

export const species = pgTable("species", {
  id: serial("id").primaryKey(),
  commonName: text("common_name").notNull(),
  scientificName: text("scientific_name"),
  category: speciesCategoryEnum("category").notNull(),
  nativeStatus: nativeStatusEnum("native_status").notNull(),
  parentSpeciesIds: integer("parent_species_ids").array(),
  ...stamps,
});

export const speciesAlias = pgTable("species_alias", {
  id: serial("id").primaryKey(),
  speciesId: integer("species_id").notNull().references(() => species.id),
  name: text("name").notNull(),
  ...stamps,
});

export const speciesGroup = pgTable("species_group", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: speciesCategoryEnum("category"),
  authorityId: integer("authority_id").references(() => authority.id),
  description: text("description"),
  ...stamps,
});

export const speciesGroupMember = pgTable("species_group_member", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => speciesGroup.id),
  speciesId: integer("species_id").notNull().references(() => species.id),
  ...stamps,
});

export const waterBodySpecies = pgTable("water_body_species", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").notNull().references(() => waterBody.id),
  speciesId: integer("species_id").notNull().references(() => species.id),
  presence: presenceEnum("presence").notNull(),
  sourceId: integer("source_id").references(() => source.id),
  ...stamps,
});

export const speciesStockingEvent = pgTable("species_stocking_event", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").notNull().references(() => waterBody.id),
  speciesId: integer("species_id").notNull().references(() => species.id),
  quantity: integer("quantity"),
  sizeNote: text("size_note"),
  stockedOn: date("stocked_on").notNull(),
  sourceId: integer("source_id").notNull().references(() => source.id),
  ...stamps,
});

export const speciesStockingSchedule = pgTable("species_stocking_schedule", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").notNull().references(() => waterBody.id),
  speciesId: integer("species_id").notNull().references(() => species.id),
  frequency: stockingFrequencyEnum("frequency").notNull(),
  seasonStartMonth: integer("season_start_month"),
  seasonEndMonth: integer("season_end_month"),
  note: text("note"),
  sourceId: integer("source_id").notNull().references(() => source.id),
  ...stamps,
});
