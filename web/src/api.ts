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

/** One reach pin from `GET /api/waters?bbox=` — a sub-segment of a water (e.g. a river reach)
 *  plotted separately so multi-reach waters don't collapse into one pin. `line` is the real
 *  traced path ([lon, lat] pairs) when known; falls back to a point marker at lon/lat when null.
 *  Like WaterPin, carries no resolved status (that's fetched per-water on selection). */
export interface ReachPin {
  id: number;
  waterBodyId: number;
  waterName: string;
  name: string | null;
  sublabel: string | null;
  lon: number;
  lat: number;
  line: [number, number][] | null;
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

export interface StockingEventRow {
  species: string;
  quantity: number | null;
  sizeNote: string | null;
  date: string;
  sourceUrl: string | null;
}

export interface StockingScheduleRow {
  species: string;
  frequency: string;
  seasonStartMonth: number | null;
  seasonEndMonth: number | null;
  note: string | null;
  sourceUrl: string | null;
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
  stocking: { events: StockingEventRow[]; schedule: StockingScheduleRow[] };
  asOf: string;
}

const PASSWORD_KEY = "keeper:password";
export function getStoredPassword(): string | null {
  return localStorage.getItem(PASSWORD_KEY);
}
export function storePassword(pw: string): void {
  localStorage.setItem(PASSWORD_KEY, pw);
}
export function clearPassword(): void {
  localStorage.removeItem(PASSWORD_KEY);
}

/** Headers every API call must carry: JSON accept + the app password when we have one. */
export function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const pw = getStoredPassword();
  return { accept: "application/json", ...(pw ? { "x-keeper-password": pw } : {}), ...extra };
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: apiHeaders() });
  if (res.status === 401) {
    clearPassword();
    window.dispatchEvent(new Event("keeper:unauthorized"));
    throw new Error("Request failed (401): unauthorized");
  }
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

/** Fetch water + reach pins inside a bbox. `bbox` is "minLon,minLat,maxLon,maxLat".
 *  `stocked` (optional) restricts pins to waters with stocking records for that species. */
export async function fetchWaters(
  bbox: string,
  signal?: AbortSignal,
  stocked?: string | null,
): Promise<{ waters: WaterPin[]; reaches: ReachPin[] }> {
  const stockedQ = stocked ? `&stocked=${encodeURIComponent(stocked)}` : "";
  return getJson<{ waters: WaterPin[]; reaches: ReachPin[] }>(
    `/api/waters?bbox=${encodeURIComponent(bbox)}${stockedQ}`,
    signal,
  );
}

/** One row from GET /api/stocking/species. */
export interface StockedSpeciesRow {
  commonName: string;
  watersCount: number;
  eventCount: number;
  scheduleCount: number;
  lastStockedOn: string | null;
}

/** One row from GET /api/stocking/waters?species=. */
export interface StockedWaterRow {
  id: number;
  name: string;
  waterType: string;
  states: string[];
  lon: number;
  lat: number;
  lastStockedOn: string | null;
}

export async function fetchStockedSpecies(signal?: AbortSignal): Promise<StockedSpeciesRow[]> {
  const res = await getJson<{ species: StockedSpeciesRow[] }>("/api/stocking/species", signal);
  return res.species;
}

export async function fetchStockedWaters(species: string, signal?: AbortSignal): Promise<StockedWaterRow[]> {
  const res = await getJson<{ waters: StockedWaterRow[] }>(
    `/api/stocking/waters?species=${encodeURIComponent(species)}`,
    signal,
  );
  return res.waters;
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

// --- chat ---

export interface ChatSessionRow {
  id: number;
  title: string;
  updatedAt: string;
  messageCount: number;
}
export interface ChatMessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export async function fetchChatSessions(signal?: AbortSignal): Promise<ChatSessionRow[]> {
  return (await getJson<{ sessions: ChatSessionRow[] }>("/api/chat/sessions", signal)).sessions;
}

export async function createChatSession(): Promise<{ id: number; title: string }> {
  const res = await fetch("/api/chat/sessions", {
    method: "POST",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: "{}",
  });
  if (res.status === 401) {
    // Same contract as getJson/streamChatMessage: re-lock the app on auth failure.
    clearPassword();
    window.dispatchEvent(new Event("keeper:unauthorized"));
    throw new Error("Request failed (401): unauthorized");
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as { id: number; title: string };
}

export async function fetchChatMessages(id: number, signal?: AbortSignal): Promise<ChatMessageRow[]> {
  return (await getJson<{ messages: ChatMessageRow[] }>(`/api/chat/sessions/${id}/messages`, signal)).messages;
}

export interface ChatStreamHandlers {
  onTool: (name: string) => void;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/** POST a chat message and consume the SSE reply stream (fetch + reader — EventSource can't POST). */
export async function streamChatMessage(
  sessionId: number,
  text: string,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ text }),
    signal,
  });
  if (res.status === 401) {
    clearPassword();
    window.dispatchEvent(new Event("keeper:unauthorized"));
    throw new Error("unauthorized");
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    handlers.onError(body?.error ?? `Request failed (${res.status})`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const event = /event: (.+)/.exec(frame)?.[1]?.trim();
      const dataRaw = /data: (.+)/.exec(frame)?.[1];
      if (!event || !dataRaw) continue;
      const data = JSON.parse(dataRaw) as Record<string, unknown>;
      if (event === "tool") handlers.onTool(String(data.name));
      else if (event === "delta") handlers.onDelta(String(data.text));
      else if (event === "done") handlers.onDone();
      else if (event === "error") handlers.onError(String(data.message));
    }
  }
}
