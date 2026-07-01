import { z } from "zod";

export const specialParams = z.object({
  description: z.string(),
  raw: z.record(z.unknown()),
}).strict();

export type SpecialParams = z.infer<typeof specialParams>;
