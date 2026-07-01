import { z } from "zod";
import { timeSpec } from "./shared";

export const fishingHoursParams = z.object({
  basis: z.enum(["any_hour", "sunrise_sunset", "park_hours", "custom"]),
  allowed_from: timeSpec.optional(),
  allowed_to: timeSpec.optional(),
  note: z.string().optional(),
}).strict();

export type FishingHoursParams = z.infer<typeof fishingHoursParams>;
