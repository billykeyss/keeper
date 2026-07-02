import { pgTable, serial, integer, text, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { geometry } from "../geometry";
import {
  authorityTypeEnum, licenseYearBasisEnum, waterTypeEnum, mgmtCategoryEnum,
  hydroRelationEnum, wbaRoleEnum, flowDirEnum, zoneKindEnum, distUnitEnum,
} from "../enums";
import { stamps } from "../stamps";

export const authority = pgTable("authority", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  state: text("state"),
  type: authorityTypeEnum("type").notNull(),
  territory: geometry("territory", { type: "MultiPolygon", srid: 4326 }),
  regulationYearStart: text("regulation_year_start"),
  licenseYearBasis: licenseYearBasisEnum("license_year_basis"),
  ...stamps,
});

export const waterBody = pgTable("water_body", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  waterType: waterTypeEnum("water_type").notNull(),
  gnisId: text("gnis_id"),
  states: text("states").array().notNull().default([]),
  counties: text("counties").array().notNull().default([]),
  geom: geometry("geom", { type: "Geometry", srid: 4326 }),
  aliases: text("aliases").array().notNull().default([]),
  regulatoryLabel: text("regulatory_label"),
  governingZoneId: integer("governing_zone_id"), // no FK: cycle with zone.waterBodyId; enforced in application layer
  managementCategory: mgmtCategoryEnum("management_category"),
  verifyCurrent: boolean("verify_current").notNull().default(false),
  ...stamps,
});

export const waterBodyRelation = pgTable("water_body_relation", {
  id: serial("id").primaryKey(),
  fromWaterBodyId: integer("from_water_body_id").notNull().references(() => waterBody.id),
  toWaterBodyId: integer("to_water_body_id").notNull().references(() => waterBody.id),
  relation: hydroRelationEnum("relation").notNull(),
  ...stamps,
});

export const waterBodyAuthority = pgTable("water_body_authority", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").notNull().references(() => waterBody.id),
  authorityId: integer("authority_id").notNull().references(() => authority.id),
  role: wbaRoleEnum("role").notNull(),
  jurisdictionNote: text("jurisdiction_note"),
  ...stamps,
});

export const reach = pgTable("reach", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").notNull().references(() => waterBody.id),
  name: text("name"),
  fromDesc: text("from_desc"),
  toDesc: text("to_desc"),
  fromAnchorFeature: text("from_anchor_feature"),
  fromOffsetFt: integer("from_offset_ft"),
  fromDirection: flowDirEnum("from_direction"),
  toAnchorFeature: text("to_anchor_feature"),
  toOffsetFt: integer("to_offset_ft"),
  toDirection: flowDirEnum("to_direction"),
  geom: geometry("geom", { type: "MultiLineString", srid: 4326 }),
  // A single representative point for the reach (v1 — not the full line path), so the map can
  // plot a marker per reach instead of only the parent water's centroid.
  lon: doublePrecision("lon"),
  lat: doublePrecision("lat"),
  county: text("county"),
  authorityId: integer("authority_id").references(() => authority.id),
  ...stamps,
});

export const zone = pgTable("zone", {
  id: serial("id").primaryKey(),
  name: text("name"),
  kind: zoneKindEnum("kind").notNull(),
  geom: geometry("geom", { type: "Geometry", srid: 4326 }),
  waterBodyId: integer("water_body_id").references(() => waterBody.id),
  authorityId: integer("authority_id").references(() => authority.id),
  anchorFeatureRef: text("anchor_feature_ref"),
  anchorWaterBodyId: integer("anchor_water_body_id").references(() => waterBody.id),
  bufferDistance: integer("buffer_distance"),
  bufferUnit: distUnitEnum("buffer_unit"),
  markerDefined: boolean("marker_defined").notNull().default(false),
  counties: text("counties").array(),
  description: text("description"),
  ...stamps,
});
