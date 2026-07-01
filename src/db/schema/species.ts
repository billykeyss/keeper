import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";
import { speciesCategoryEnum, nativeStatusEnum, presenceEnum } from "../enums";
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
