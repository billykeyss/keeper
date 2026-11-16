// Compile-time guard (checked by `tsc --noEmit`, not run): the hand-copied DateSpec in
// src/resolve/types.ts must stay mutually assignable with the zod-inferred one in src/params/shared.ts.
import type { DateSpec as ResolveDateSpec } from "../../src/resolve/types";
import type { DateSpec as ZodDateSpec } from "../../src/params/shared";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export const resolveToZod: (x: ResolveDateSpec) => ZodDateSpec = (x) => x;
export const zodToResolve: (x: ZodDateSpec) => ResolveDateSpec = (x) => x;
export const identical: Equal<ResolveDateSpec, ZodDateSpec> = true;
