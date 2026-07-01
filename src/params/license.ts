import { z } from "zod";
import { dateSpec } from "./shared";

export const licenseParams = z.object({
  required: z.boolean(),
  min_age: z.number().int().nonnegative().optional(),
  under_min_age: z.literal("no_license_required").optional(),
  issuing_authority_id: z.number().int().optional(),
  replaces_state_license: z.boolean().optional(),
  required_product_note: z.string().optional(),
  reciprocity: z.object({
    applies: z.boolean(),
    honored_authority_ids: z.array(z.number().int()),
    note: z.string(),
  }).strict().optional(),
  exemption: z.object({ event: z.string(), date: dateSpec, other_regs_apply: z.boolean() }).strict().optional(),
  note: z.string().optional(),
}).strict();

export type LicenseParams = z.infer<typeof licenseParams>;
