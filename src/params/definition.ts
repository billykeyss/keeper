import { z } from "zod";
import { RULE_TYPES } from "./shared";

export const definitionParams = z.object({
  term: z.string(),
  applies_to_rule_types: z.array(z.enum(RULE_TYPES)),
  possession_multiplier: z.number().positive().optional(),
  counting_rules: z.object({ includes: z.array(z.string()), excludes: z.array(z.string()) }).strict().optional(),
  statewide_aggregate: z.boolean().optional(),
  text: z.string(),
  note: z.string().optional(),
}).strict();

export type DefinitionParams = z.infer<typeof definitionParams>;
