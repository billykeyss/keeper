import { z } from "zod";

export const vesselParams = z.object({
  gas_motor_allowed: z.boolean(),
  electric_motor_allowed: z.boolean(),
  non_motorized_allowed: z.boolean(),
  float_tube_allowed: z.boolean().optional(),
  paddleboard_allowed: z.boolean().optional(),
  outside_boats_allowed: z.boolean().optional(),
  hp_limit: z.number().nonnegative().optional(),
  no_wake: z.boolean().optional(),
  reason: z.string().optional(),
  note: z.string().optional(),
}).strict();

export type VesselParams = z.infer<typeof vesselParams>;
