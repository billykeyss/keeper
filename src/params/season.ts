import { z } from "zod";
import { dateSpec } from "./shared";

export const seasonParams = z.object({
  periods: z.array(z.object({
    label: z.string(),
    status: z.enum(["open", "closed", "open_catch_release"]),
    start: dateSpec,
    end: dateSpec,
  }).strict()).min(1),
  note: z.string().optional(),
}).strict();

export type SeasonParams = z.infer<typeof seasonParams>;
