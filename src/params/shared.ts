import { z } from "zod";

export const dateSpec = z.object({
  type: z.enum(["fixed", "relative", "astronomical", "year_round"]),
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
  ordinal: z.enum(["first", "second", "third", "fourth", "last", "nth"]).optional(),
  weekday: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]).optional(),
  relation: z.enum(["on", "preceding", "following"]).optional(),
  offset_days: z.number().int().optional(),
  anchor_holiday: z.string().optional(),
  anchor: z.enum(["sunrise", "sunset"]).optional(),
  offset_minutes: z.number().int().optional(),
  verbatim: z.string(),
}).strict();

export const timeSpec = z.object({
  anchor: z.enum(["sunrise", "sunset", "clock"]),
  offset_minutes: z.number().int().optional(),
  clock_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  verbatim: z.string(),
}).strict();

export type DateSpec = z.infer<typeof dateSpec>;
export type TimeSpec = z.infer<typeof timeSpec>;
