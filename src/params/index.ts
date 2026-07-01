import type { z } from "zod";
import { seasonParams } from "./season";
import { bagParams } from "./bag";
import { sizeLimitParams } from "./sizeLimit";
import { gearMethodParams } from "./gearMethod";
import { fishingHoursParams } from "./fishingHours";
import { closureParams } from "./closure";
import { handlingParams } from "./handling";
import { vesselParams } from "./vessel";
import { aisParams } from "./ais";
import { documentationParams } from "./documentation";
import { licenseParams } from "./license";
import { definitionParams } from "./definition";
import { specialParams } from "./special";

export const ruleTypeParamSchemas = {
  season: seasonParams, bag: bagParams, size_limit: sizeLimitParams, gear_method: gearMethodParams,
  fishing_hours: fishingHoursParams, closure: closureParams, handling: handlingParams, vessel: vesselParams,
  ais: aisParams, documentation: documentationParams, license: licenseParams, definition: definitionParams,
  special: specialParams,
} as const satisfies Record<string, z.ZodTypeAny>;

export type RuleType = keyof typeof ruleTypeParamSchemas;

export function validateParameters(ruleType: string, params: unknown) {
  const schema = (ruleTypeParamSchemas as Record<string, z.ZodTypeAny>)[ruleType];
  if (!schema) return { success: false as const, error: `unknown rule_type: ${ruleType}` };
  const r = schema.safeParse(params);
  return r.success ? { success: true as const, data: r.data } : { success: false as const, error: r.error.message };
}

export * from "./shared";
export * from "./season";
export * from "./bag";
export * from "./sizeLimit";
export * from "./gearMethod";
export * from "./fishingHours";
export * from "./closure";
export * from "./handling";
export * from "./vessel";
export * from "./ais";
export * from "./documentation";
export * from "./license";
export * from "./definition";
export * from "./special";
