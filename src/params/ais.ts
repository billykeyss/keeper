import { z } from "zod";

export const aisParams = z.object({
  inspection_required: z.boolean(),
  decontamination_required: z.boolean(),
  quarantine_days: z.number().int().nonnegative().optional(),
  seal_or_sticker_required: z.boolean().optional(),
  sticker_note: z.string().optional(),
  drain_plug_out_required: z.boolean().optional(),
  felt_soles_prohibited: z.boolean().optional(),
  applies_to: z.enum(["motorized", "all_watercraft"]),
  program_authority_id: z.number().int().optional(),
  status_source_url: z.string().optional(),
  note: z.string().optional(),
}).strict();

export type AisParams = z.infer<typeof aisParams>;
