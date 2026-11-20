// DB-free rules engine. Imports nothing outside this directory (see types.ts).
export type {
  DateSpec, ScopeStatus, PeriodStatus, CandidateRule, ReachInfo, SerializedRule, SerializedLicense,
  Scope, ResolvedWater,
} from "./types.ts";
export { resolveWater, STATUS_LABEL, isValidIsoDate } from "./resolve.ts";
export { isDateInWindow, windowResolvable } from "./season.ts";
export { resolveDateSpec } from "./dateSpec.ts";
