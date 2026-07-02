import { z } from "zod";
import { dateSpec, RULE_TYPES } from "../params/shared";

const key = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const waterInfo = z.object({
  name: z.string(), waterType: z.enum(["lake","reservoir","river","stream","creek","pond","marina","impoundment"]),
  states: z.array(z.enum(["CA","NV","OR"])).min(1), counties: z.array(z.string()), aliases: z.array(z.string()),
  gnisId: z.string().nullable(), lon: z.number().min(-125).max(-114), lat: z.number().min(32).max(46.5),
  verifyCurrent: z.boolean(),
}).strict();

const authorityRow = z.object({
  key, name: z.string(), state: z.enum(["CA","NV","OR"]).nullable(),
  type: z.enum(["state_agency","tribal","federal","land_trust","ngo","private_landowner"]),
  roles: z.array(z.enum(["take_rules","access","land_management","permit_issuer","none"])),
}).strict();

const reachRow = z.object({
  key, name: z.string(), fromDesc: z.string(), toDesc: z.string(), lon: z.number(), lat: z.number(),
  // Optional real path geometry (e.g. traced from OpenStreetMap and clipped to this reach's
  // described boundaries) — [lon, lat] pairs in path order. Falls back to the lon/lat point
  // above when absent.
  line: z.array(z.tuple([z.number(), z.number()])).min(2).nullable().optional(),
}).strict();

const speciesRow = z.object({
  commonName: z.string(), scientificName: z.string().nullable(),
  category: z.enum(["trout","char","salmon","bass","warmwater","panfish","catfish","sucker","minnow","sculpin","hybrid","other"]),
  nativeStatus: z.enum(["native","introduced","stocked","stocked_hybrid"]),
  presence: z.enum(["native","stocked","introduced","historical"]),
}).strict();

const speciesGroupRow = z.object({ key, name: z.string(), category: z.enum(["trout","char","salmon","bass","warmwater","panfish","catfish","sucker","minnow","sculpin","hybrid","other"]).nullable(), authorityKey: key.nullable() }).strict();

const sourceRow = z.object({
  key, url: z.string().url(), title: z.string(), documentType: z.enum(["webpage","pdf","booklet","gis","api"]),
  instrumentType: z.enum(["commission_reg","admin_code","statute","booklet","guide","webpage","gis","tribal_ordinance","emergency_order","directors_order","hotline"]),
  authorityLevel: z.enum(["primary_regulatory","agency_mirror","third_party"]),
  authorityKey: key, retrievedDate: isoDate, quotedText: z.string().nullable(),
}).strict();

const groupRow = z.object({ key, authorityKey: key, citation: z.string(), humanSummary: z.string(), verbatimText: z.string().nullable() }).strict();

const seasonPeriodRow = z.object({
  key, groupKey: key.nullable(), label: z.string(),
  status: z.enum(["open","closed","open_catch_release"]), startSpec: dateSpec, endSpec: dateSpec,
}).strict();

const scope = z.discriminatedUnion("type", [
  z.object({ type: z.literal("water") }).strict(),
  z.object({ type: z.literal("reach"), reachKey: key }).strict(),
  z.object({ type: z.literal("authority_territory"), authorityKey: key }).strict(),
]);

const speciesTarget = z.union([
  z.object({ speciesGroupKey: key }).strict(),
  z.object({ speciesCommonName: z.string() }).strict(),
]);

const regulationRow = z.object({
  ruleType: z.enum(RULE_TYPES), parameters: z.record(z.unknown()),
  groupKey: key.nullable(), seasonPeriodKey: key.nullable(), authorityKey: key,
  rulePolarity: z.enum(["applies","asserts_none","excludes"]), speciesScope: z.enum(["all","listed"]),
  speciesTargets: z.array(speciesTarget), scope,
  appliesToClass: z.enum(["any","tribal_member","non_tribal","spouse_of_member","minor","senior","disabled","resident","nonresident","active_military","youth"]),
  jurisdictionState: z.enum(["CA","NV","OR"]).nullable(), citation: z.string(), humanSummary: z.string(),
  verbatimText: z.string().nullable(), isParaphrase: z.boolean(), confidence: z.enum(["low","medium","high"]),
  sourceKeys: z.object({ primary: key, corroborating: z.array(key) }).strict(),
}).strict().refine((r) => r.speciesScope === "all" || r.speciesTargets.length > 0, { message: "listed regulation requires speciesTargets" });

const reciprocityRow = z.object({
  honoringAuthorityKey: key, honoredAuthorityKey: key.nullable(), honored: z.boolean(),
  replacesStateLicense: z.boolean(), condition: z.record(z.unknown()).nullable(), sourceKey: key, note: z.string().nullable(),
}).strict();

export const waterDataset = z.object({
  asOf: isoDate, water: waterInfo, authorities: z.array(authorityRow).min(1),
  reaches: z.array(reachRow), species: z.array(speciesRow), speciesGroups: z.array(speciesGroupRow),
  sources: z.array(sourceRow).min(1), groups: z.array(groupRow), seasonPeriods: z.array(seasonPeriodRow),
  regulations: z.array(regulationRow), reciprocity: z.array(reciprocityRow),
}).strict();

export type WaterDataset = z.infer<typeof waterDataset>;
