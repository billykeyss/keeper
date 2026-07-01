CREATE TYPE "public"."angler_class" AS ENUM('any', 'tribal_member', 'non_tribal', 'spouse_of_member', 'minor', 'senior', 'disabled', 'resident', 'nonresident', 'active_military', 'youth');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('insert', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."authority_level" AS ENUM('primary_regulatory', 'agency_mirror', 'third_party');--> statement-breakpoint
CREATE TYPE "public"."authority_type" AS ENUM('state_agency', 'tribal', 'federal', 'land_trust', 'ngo', 'private_landowner');--> statement-breakpoint
CREATE TYPE "public"."basis" AS ENUM('explicit', 'statewide_default', 'inherited');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."dist_unit" AS ENUM('ft', 'yd', 'm');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('webpage', 'pdf', 'booklet', 'gis', 'api');--> statement-breakpoint
CREATE TYPE "public"."fetch_status" AS ENUM('ok', 'failed_binary', 'failed_404', 'manual');--> statement-breakpoint
CREATE TYPE "public"."flow_dir" AS ENUM('upstream', 'downstream');--> statement-breakpoint
CREATE TYPE "public"."hydro_relation" AS ENUM('outlet', 'tributary_of');--> statement-breakpoint
CREATE TYPE "public"."instrument_type" AS ENUM('commission_reg', 'admin_code', 'statute', 'booklet', 'guide', 'webpage', 'gis', 'tribal_ordinance', 'emergency_order', 'directors_order', 'hotline');--> statement-breakpoint
CREATE TYPE "public"."license_year_basis" AS ENUM('fixed_calendar', 'rolling_12mo', 'regulation_year');--> statement-breakpoint
CREATE TYPE "public"."mgmt_category" AS ENUM('community_fishing_pond', 'trophy_water', 'general');--> statement-breakpoint
CREATE TYPE "public"."native_status" AS ENUM('native', 'introduced', 'stocked', 'stocked_hybrid');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open', 'closed', 'open_catch_release');--> statement-breakpoint
CREATE TYPE "public"."presence" AS ENUM('native', 'stocked', 'introduced', 'historical');--> statement-breakpoint
CREATE TYPE "public"."reset_basis" AS ENUM('calendar_year', 'license_year', 'regulation_year', 'season');--> statement-breakpoint
CREATE TYPE "public"."rule_polarity" AS ENUM('applies', 'asserts_none', 'excludes');--> statement-breakpoint
CREATE TYPE "public"."rule_type" AS ENUM('season', 'bag', 'size_limit', 'gear_method', 'fishing_hours', 'closure', 'handling', 'vessel', 'ais', 'documentation', 'license', 'definition', 'special');--> statement-breakpoint
CREATE TYPE "public"."source_role" AS ENUM('primary', 'corroborating', 'spatial', 'text', 'verification', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."species_category" AS ENUM('trout', 'char', 'salmon', 'bass', 'warmwater', 'panfish', 'catfish', 'sucker', 'minnow', 'sculpin', 'hybrid', 'other');--> statement-breakpoint
CREATE TYPE "public"."species_mode" AS ENUM('include', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."species_role" AS ENUM('target', 'bait', 'prohibited');--> statement-breakpoint
CREATE TYPE "public"."species_scope" AS ENUM('all', 'listed');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('draft', 'needs_review', 'verified', 'published', 'proposed', 'superseded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."sublimit_mode" AS ENUM('additive', 'carve_out');--> statement-breakpoint
CREATE TYPE "public"."target_mode" AS ENUM('include', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."target_type" AS ENUM('water_body', 'reach', 'zone', 'statewide', 'authority_territory');--> statement-breakpoint
CREATE TYPE "public"."water_type" AS ENUM('lake', 'reservoir', 'river', 'stream', 'creek', 'pond', 'marina', 'impoundment');--> statement-breakpoint
CREATE TYPE "public"."wba_role" AS ENUM('take_rules', 'access', 'land_management', 'permit_issuer', 'none');--> statement-breakpoint
CREATE TYPE "public"."zone_kind" AS ENUM('district', 'region', 'county', 'tributary_group', 'closed_area', 'swim_area', 'jurisdiction', 'named_area', 'buffer');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authority" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"state" text,
	"type" "authority_type" NOT NULL,
	"territory" geometry(MultiPolygon,4326),
	"regulation_year_start" text,
	"license_year_basis" "license_year_basis",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reach" (
	"id" serial PRIMARY KEY NOT NULL,
	"water_body_id" integer NOT NULL,
	"name" text,
	"from_desc" text,
	"to_desc" text,
	"from_anchor_feature" text,
	"from_offset_ft" integer,
	"from_direction" "flow_dir",
	"to_anchor_feature" text,
	"to_offset_ft" integer,
	"to_direction" "flow_dir",
	"geom" geometry(MultiLineString,4326),
	"county" text,
	"authority_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "water_body" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"water_type" "water_type" NOT NULL,
	"gnis_id" text,
	"states" text[] DEFAULT '{}' NOT NULL,
	"counties" text[] DEFAULT '{}' NOT NULL,
	"geom" geometry(Geometry,4326),
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"regulatory_label" text,
	"governing_zone_id" integer,
	"management_category" "mgmt_category",
	"verify_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "water_body_authority" (
	"id" serial PRIMARY KEY NOT NULL,
	"water_body_id" integer NOT NULL,
	"authority_id" integer NOT NULL,
	"role" "wba_role" NOT NULL,
	"jurisdiction_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "water_body_relation" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_water_body_id" integer NOT NULL,
	"to_water_body_id" integer NOT NULL,
	"relation" "hydro_relation" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zone" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text,
	"kind" "zone_kind" NOT NULL,
	"geom" geometry(Geometry,4326),
	"water_body_id" integer,
	"authority_id" integer,
	"anchor_feature_ref" text,
	"anchor_water_body_id" integer,
	"buffer_distance" integer,
	"buffer_unit" "dist_unit",
	"marker_defined" boolean DEFAULT false NOT NULL,
	"counties" text[],
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "species" (
	"id" serial PRIMARY KEY NOT NULL,
	"common_name" text NOT NULL,
	"scientific_name" text,
	"category" "species_category" NOT NULL,
	"native_status" "native_status" NOT NULL,
	"parent_species_ids" integer[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "species_alias" (
	"id" serial PRIMARY KEY NOT NULL,
	"species_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "species_group" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" "species_category",
	"authority_id" integer,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "species_group_member" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"species_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "water_body_species" (
	"id" serial PRIMARY KEY NOT NULL,
	"water_body_id" integer NOT NULL,
	"species_id" integer NOT NULL,
	"presence" "presence" NOT NULL,
	"source_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "license_reciprocity" (
	"id" serial PRIMARY KEY NOT NULL,
	"water_body_id" integer,
	"zone_id" integer,
	"honoring_authority_id" integer NOT NULL,
	"honored_authority_id" integer,
	"honored_state" text,
	"honored" boolean NOT NULL,
	"replaces_state_license" boolean DEFAULT false NOT NULL,
	"condition" jsonb,
	"source_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regulation" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_type" "rule_type" NOT NULL,
	"parameters" jsonb NOT NULL,
	"regulation_group_id" integer,
	"season_period_id" integer,
	"authority_id" integer NOT NULL,
	"origin_authority_id" integer,
	"required_permit_authority_id" integer,
	"rule_polarity" "rule_polarity" DEFAULT 'applies' NOT NULL,
	"basis" "basis" DEFAULT 'explicit' NOT NULL,
	"precedence" integer DEFAULT 0 NOT NULL,
	"species_scope" "species_scope" DEFAULT 'listed' NOT NULL,
	"applies_to_class" "angler_class" DEFAULT 'any' NOT NULL,
	"applies_min_age" integer,
	"applies_max_age" integer,
	"jurisdiction_state" text,
	"scope_condition" text,
	"is_binding" boolean DEFAULT true NOT NULL,
	"confidence" "confidence" DEFAULT 'high' NOT NULL,
	"citation" text,
	"human_summary" text NOT NULL,
	"verbatim_text" text,
	"is_paraphrase" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'draft' NOT NULL,
	"reviewer" text,
	"reviewed_at" timestamp,
	"last_verified_at" date,
	"valid_from" date,
	"valid_to" date,
	"supersedes_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regulation_group" (
	"id" serial PRIMARY KEY NOT NULL,
	"authority_id" integer NOT NULL,
	"citation" text,
	"verbatim_text" text,
	"human_summary" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regulation_source" (
	"id" serial PRIMARY KEY NOT NULL,
	"regulation_id" integer NOT NULL,
	"source_id" integer NOT NULL,
	"role" "source_role" NOT NULL,
	"section_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regulation_species" (
	"id" serial PRIMARY KEY NOT NULL,
	"regulation_id" integer NOT NULL,
	"species_id" integer,
	"species_group_id" integer,
	"role" "species_role" DEFAULT 'target' NOT NULL,
	"mode" "species_mode" DEFAULT 'include' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regulation_target" (
	"id" serial PRIMARY KEY NOT NULL,
	"regulation_id" integer NOT NULL,
	"target_type" "target_type" NOT NULL,
	"target_id" integer,
	"mode" "target_mode" DEFAULT 'include' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "season_period" (
	"id" serial PRIMARY KEY NOT NULL,
	"regulation_group_id" integer,
	"label" text NOT NULL,
	"status" "period_status" NOT NULL,
	"start_spec" jsonb NOT NULL,
	"end_spec" jsonb NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"supersedes_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source" (
	"id" serial PRIMARY KEY NOT NULL,
	"authority_id" integer,
	"document_type" "document_type" NOT NULL,
	"instrument_type" "instrument_type",
	"authority_level" "authority_level" NOT NULL,
	"is_official" boolean DEFAULT true NOT NULL,
	"mirror_of_id" integer,
	"fetch_status" "fetch_status",
	"url" text,
	"title" text,
	"published_date" date,
	"retrieved_date" date,
	"section_ref" text,
	"quoted_text" text,
	"disputed" boolean DEFAULT false NOT NULL,
	"refutation_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"row_id" integer NOT NULL,
	"action" "audit_action" NOT NULL,
	"actor" text,
	"at" timestamp DEFAULT now() NOT NULL,
	"diff" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach" ADD CONSTRAINT "reach_water_body_id_water_body_id_fk" FOREIGN KEY ("water_body_id") REFERENCES "public"."water_body"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reach" ADD CONSTRAINT "reach_authority_id_authority_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."authority"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "water_body_authority" ADD CONSTRAINT "water_body_authority_water_body_id_water_body_id_fk" FOREIGN KEY ("water_body_id") REFERENCES "public"."water_body"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "water_body_authority" ADD CONSTRAINT "water_body_authority_authority_id_authority_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."authority"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "water_body_relation" ADD CONSTRAINT "water_body_relation_from_water_body_id_water_body_id_fk" FOREIGN KEY ("from_water_body_id") REFERENCES "public"."water_body"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "water_body_relation" ADD CONSTRAINT "water_body_relation_to_water_body_id_water_body_id_fk" FOREIGN KEY ("to_water_body_id") REFERENCES "public"."water_body"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zone" ADD CONSTRAINT "zone_water_body_id_water_body_id_fk" FOREIGN KEY ("water_body_id") REFERENCES "public"."water_body"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zone" ADD CONSTRAINT "zone_authority_id_authority_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."authority"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zone" ADD CONSTRAINT "zone_anchor_water_body_id_water_body_id_fk" FOREIGN KEY ("anchor_water_body_id") REFERENCES "public"."water_body"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "species_alias" ADD CONSTRAINT "species_alias_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "species_group_member" ADD CONSTRAINT "species_group_member_group_id_species_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."species_group"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "species_group_member" ADD CONSTRAINT "species_group_member_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "water_body_species" ADD CONSTRAINT "water_body_species_water_body_id_water_body_id_fk" FOREIGN KEY ("water_body_id") REFERENCES "public"."water_body"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "water_body_species" ADD CONSTRAINT "water_body_species_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "water_body_species" ADD CONSTRAINT "water_body_species_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "license_reciprocity" ADD CONSTRAINT "license_reciprocity_water_body_id_water_body_id_fk" FOREIGN KEY ("water_body_id") REFERENCES "public"."water_body"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "license_reciprocity" ADD CONSTRAINT "license_reciprocity_zone_id_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zone"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "license_reciprocity" ADD CONSTRAINT "license_reciprocity_honoring_authority_id_authority_id_fk" FOREIGN KEY ("honoring_authority_id") REFERENCES "public"."authority"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "license_reciprocity" ADD CONSTRAINT "license_reciprocity_honored_authority_id_authority_id_fk" FOREIGN KEY ("honored_authority_id") REFERENCES "public"."authority"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "license_reciprocity" ADD CONSTRAINT "license_reciprocity_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation" ADD CONSTRAINT "regulation_regulation_group_id_regulation_group_id_fk" FOREIGN KEY ("regulation_group_id") REFERENCES "public"."regulation_group"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation" ADD CONSTRAINT "regulation_season_period_id_season_period_id_fk" FOREIGN KEY ("season_period_id") REFERENCES "public"."season_period"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation" ADD CONSTRAINT "regulation_authority_id_authority_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."authority"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation" ADD CONSTRAINT "regulation_origin_authority_id_authority_id_fk" FOREIGN KEY ("origin_authority_id") REFERENCES "public"."authority"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation" ADD CONSTRAINT "regulation_required_permit_authority_id_authority_id_fk" FOREIGN KEY ("required_permit_authority_id") REFERENCES "public"."authority"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation_group" ADD CONSTRAINT "regulation_group_authority_id_authority_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."authority"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation_source" ADD CONSTRAINT "regulation_source_regulation_id_regulation_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."regulation"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation_source" ADD CONSTRAINT "regulation_source_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation_species" ADD CONSTRAINT "regulation_species_regulation_id_regulation_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."regulation"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation_target" ADD CONSTRAINT "regulation_target_regulation_id_regulation_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."regulation"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "season_period" ADD CONSTRAINT "season_period_regulation_group_id_regulation_group_id_fk" FOREIGN KEY ("regulation_group_id") REFERENCES "public"."regulation_group"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source" ADD CONSTRAINT "source_authority_id_authority_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."authority"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
