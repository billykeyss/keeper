DO $$ BEGIN
 ALTER TABLE "species_group" ADD CONSTRAINT "species_group_authority_id_authority_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."authority"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation_species" ADD CONSTRAINT "regulation_species_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulation_species" ADD CONSTRAINT "regulation_species_species_group_id_species_group_id_fk" FOREIGN KEY ("species_group_id") REFERENCES "public"."species_group"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "regulation_species" ADD CONSTRAINT "reg_species_target_present" CHECK (species_id IS NOT NULL OR species_group_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE "regulation_target" ADD CONSTRAINT "reg_target_id_present" CHECK (target_type IN ('statewide','authority_territory') OR target_id IS NOT NULL);