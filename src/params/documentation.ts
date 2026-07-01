import { z } from "zod";

export const documentationParams = z.object({
  report_card_required: z.boolean().optional(),
  card_name: z.string().optional(),
  tag_required: z.boolean().optional(),
  tag_affix_timing: z.enum(["immediately", "before_transport"]).optional(),
  record_before_moving: z.boolean().optional(),
  return_required: z.boolean().optional(),
  note: z.string().optional(),
}).strict();

export type DocumentationParams = z.infer<typeof documentationParams>;
