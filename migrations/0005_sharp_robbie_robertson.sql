CREATE TYPE "public"."stocking_frequency" AS ENUM('weekly', 'biweekly', 'monthly', 'seasonal', 'annual', 'as_available');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "species_stocking_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"water_body_id" integer NOT NULL,
	"species_id" integer NOT NULL,
	"quantity" integer,
	"size_note" text,
	"stocked_on" date NOT NULL,
	"source_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "species_stocking_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"water_body_id" integer NOT NULL,
	"species_id" integer NOT NULL,
	"frequency" "stocking_frequency" NOT NULL,
	"season_start_month" integer,
	"season_end_month" integer,
	"note" text,
	"source_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "species_stocking_event" ADD CONSTRAINT "species_stocking_event_water_body_id_water_body_id_fk" FOREIGN KEY ("water_body_id") REFERENCES "public"."water_body"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "species_stocking_event" ADD CONSTRAINT "species_stocking_event_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "species_stocking_event" ADD CONSTRAINT "species_stocking_event_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "species_stocking_schedule" ADD CONSTRAINT "species_stocking_schedule_water_body_id_water_body_id_fk" FOREIGN KEY ("water_body_id") REFERENCES "public"."water_body"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "species_stocking_schedule" ADD CONSTRAINT "species_stocking_schedule_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "species_stocking_schedule" ADD CONSTRAINT "species_stocking_schedule_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
