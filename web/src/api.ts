// Typed fetchers for the Hono read API. The interfaces below mirror the REAL
// response shapes emitted by `src/api/waters.ts` and `src/api/rules.ts` — keep
// them in sync with those handlers, not with any guessed contract.

export type ScopeStatus = "open" | "catch_and_release" | "closed" | "unknown";
export type Polarity = "applies" | "asserts_none" | "excludes";
export type Confidence = "low" | "medium" | "high";

/** One pin from `GET /api/waters?bbox=` — the bbox endpoint only knows
 *  verifyCurrent + ruleCount, never the resolved status. */
export interface WaterPin {
  id: number;
  name: string;
  waterType: string;
  states: string[];
  lon: number;
  lat: number;
  verifyCurrent: boolean;
  ruleCount: number;
}

/** A season period annotation carried by `season`-type rules. */
export interface RulePeriod {
  label: string;
  status: "open" | "closed" | "open_catch_release";
  activeNow: boolean;
}

/** A resolved rule card. `detail` is the raw validated parameters blob for the
 *  rule type — shape varies by ruleType (bag/size_limit/gear_method/…). */
export interface Rule {
  ruleType: string;
  summary: string;
  detail: Record<string, unknown>;
  citation: string | null;
  sourceUrl: string | null;
  polarity: Polarity;
  confidence: Confidence;
  appliesTo: string;
  species: string[];
  periods?: RulePeriod[];
}

export interface LicenseRule extends Rule {
  authority: string | null;
}

export interface Scope {
  scope: string;
  kind: "water" | "reach";
  sublabel: string | null;
  status: ScopeStatus;
  rules: Rule[];
}

export interface ReciprocityRow {
  honoringAuthority: string | null;
  honoredAuthority: string | null;
  honored: boolean;
  replacesStateLicense: boolean;
  condition: Record<string, unknown> | null;
}

export interface SpeciesRow {
  commonName: string;
  scientificName: string | null;
  category: string;
  presence: string;
}

export interface RulesResponse {
  water: {
    id: number;
    name: string;
    waterType: string;
    states: string[];
    counties: string[];
    verifyCurrent: boolean;
  };
  status: {
    overall: ScopeStatus;
    label: string;
    verifyCurrent: boolean;
  };
  scopes: Scope[];
  licenses: LicenseRule[];
  reciprocity: ReciprocityRow[];
  species: SpeciesRow[];
  asOf: string;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = `: ${body.error}`;
    } catch {
      /* non-JSON error body — ignore */
    }
    throw new Error(`Request failed (${res.status})${detail}`);
  }
  return (await res.json()) as T;
}

/** Fetch water pins inside a bbox. `bbox` is "minLon,minLat,maxLon,maxLat". */
export async function fetchWaters(bbox: string, signal?: AbortSignal): Promise<WaterPin[]> {
  const body = await getJson<{ waters: WaterPin[] }>(
    `/api/waters?bbox=${encodeURIComponent(bbox)}`,
    signal,
  );
  return body.waters;
}

/** Fetch the resolved rules for a water on a date (defaults to the server's today). */
export async function fetchRules(
  id: number,
  on?: string,
  signal?: AbortSignal,
): Promise<RulesResponse> {
  const q = on ? `?on=${encodeURIComponent(on)}` : "";
  return getJson<RulesResponse>(`/api/waters/${id}/rules${q}`, signal);
}
