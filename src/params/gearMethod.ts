import { z } from "zod";

export const gearMethodParams = z.object({
  bait_allowed: z.boolean(),
  artificial_only: z.boolean(),
  flies_only: z.boolean(),
  lures_allowed: z.boolean(),
  barbless_required: z.boolean(),
  single_hook_required: z.boolean(),
  max_hooks: z.number().int().positive().optional(),
  max_hook_gap_in: z.number().positive().optional(),
  max_droppers: z.number().int().nonnegative().optional(),
  max_leader_len_in: z.number().positive().optional(),
  max_rods: z.number().int().positive().optional(),
  max_lines: z.number().int().positive().optional(),
  chumming_allowed: z.boolean().optional(),
  snagging_allowed: z.boolean().optional(),
  downriggers_allowed: z.boolean().optional(),
  prohibited_methods: z.array(z.string()).optional(),
  requires_permit_note: z.string().optional(),
  evidentiary_note: z.string().optional(),
  note: z.string().optional(),
}).strict();

export type GearMethodParams = z.infer<typeof gearMethodParams>;
