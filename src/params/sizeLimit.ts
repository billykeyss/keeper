import { z } from "zod";

export const sizeLimitParams = z.object({
  min_length_in: z.number().nonnegative().nullable().optional(),
  max_length_in: z.number().nonnegative().nullable().optional(),
  protected_slot: z.object({ min_in: z.number().nonnegative(), max_in: z.number().nonnegative() }).nullable().optional(),
  measurement: z.enum(["total_length", "fork_length", "girth"]),
  unit: z.enum(["inch", "cm"]),
  over_slot_retention: z.object({ max_daily: z.number().int().nonnegative(), min_in: z.number().nonnegative().optional() }).optional(),
  note: z.string().optional(),
}).strict();

export type SizeLimitParams = z.infer<typeof sizeLimitParams>;
