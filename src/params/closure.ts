import { z } from "zod";

export const closureParams = z.object({
  closure_kind: z.enum(["seasonal", "spatial", "emergency", "year_round", "flow_triggered", "quota_triggered"]),
  boundary_definition: z.enum(["geom", "signs_buoys", "radius", "described"]),
  trigger: z.object({
    kind: z.enum(["flow", "quota"]),
    gauge_station: z.string().optional(),
    threshold_cfs: z.number().optional(),
    comparison: z.enum(["below", "above"]).optional(),
    quota_count: z.number().int().optional(),
    quota_area: z.string().optional(),
    status_source_url: z.string().optional(),
    hotline: z.string().optional(),
  }).strict().optional(),
  note: z.string().optional(),
}).strict();

export type ClosureParams = z.infer<typeof closureParams>;
