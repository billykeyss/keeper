import { z } from "zod";

const subLimit = z.object({
  target: z.union([z.object({ species: z.string() }).strict(), z.object({ species_group: z.string() }).strict()]),
  mode: z.enum(["additive", "carve_out"]),
  max_daily: z.number().int().nonnegative().optional(),
  max_possession: z.number().int().nonnegative().optional(),
  min_length_in: z.number().nonnegative().optional(),
  max_length_in: z.number().nonnegative().optional(),
  note: z.string().optional(),
}).strict();

export const bagParams = z.object({
  daily: z.number().int().nonnegative().nullable().optional(),
  possession: z.number().int().nonnegative().nullable().optional(),
  annual: z.number().int().nonnegative().nullable().optional(),
  reset_basis: z.enum(["calendar_year", "license_year", "regulation_year", "season"]).optional(),
  possession_multiplier: z.number().positive().optional(),
  unit: z.string().default("fish"),
  aggregation: z.enum(["combined_group", "per_species", "combined_all"]),
  relationship: z.enum(["independent", "cumulative", "shared_aggregate"]).optional(),
  catch_and_release: z.boolean().optional(),
  counts_toward_statewide_aggregate: z.boolean().optional(),
  sub_limits: z.array(subLimit).optional(),
  allowed_combinations: z.array(z.string()).optional(),
  possession_condition: z.string().optional(),
  counting_rule: z.string().optional(),
}).strict();

export type BagParams = z.infer<typeof bagParams>;
