import { z } from "zod";

export const handlingParams = z.object({
  must_release_unharmed: z.boolean().optional(),
  keep_in_water: z.boolean().optional(),
  filleting_prohibited: z.boolean().optional(),
  live_transport_prohibited: z.boolean().optional(),
  stringer_max: z.number().int().nonnegative().optional(),
  stringers_per_person: z.number().int().nonnegative().optional(),
  counts_toward_bag_when_retained: z.boolean().optional(),
  condition: z.string().optional(),
  note: z.string().optional(),
}).strict();

export type HandlingParams = z.infer<typeof handlingParams>;
