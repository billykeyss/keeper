# Stocked-Fish Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Stocked fish" panel listing every species with source-backed stocking records, plus a map filter showing only waters stocked with a selected species.

**Architecture:** One new read-only Hono route file (`src/api/stocking.ts`) with two endpoints; an optional `stocked=` filter on the existing `GET /api/waters`; one new frontend panel component wired into `App.tsx`/`Map.tsx`. No DB schema changes — reads the `species_stocking_event`/`species_stocking_schedule` tables that already exist.

**Tech Stack:** TypeScript, Hono, Drizzle `sql` raw queries + PostgreSQL, React, MapLibre GL, Vitest.

## Global Constraints

- "Stocked" means source-backed stocking records only: a water counts for a species iff it has ≥1 `species_stocking_event` OR `species_stocking_schedule` row for it. `presence: "stocked"` alone does NOT count (spec: `docs/superpowers/specs/2026-07-02-stocked-fish-browser-design.md`).
- The `species` table has one row per (water, species) — the same common name appears many times with different ids. ALL aggregation/matching must group/match on `species.common_name` (case-insensitive), never on `species.id`.
- `npm` is aliased to `pnpm`. After each task: `npm run typecheck && npm test` green.
- Do NOT run `npm run ingest:corridor` during this plan — the working tree holds researched-but-unverified stocking data files awaiting a verification pass; the live DB (Battle Born Pond stocking only) is the fixture for manual verification.
- New API routes must be registered in `src/api/server.ts` BEFORE the static-SPA block (its `app.get("*")` fallback swallows later GET routes).

---

### Task 1: Stocking API — species summary, waters-by-species, and the `stocked=` pin filter

**Files:**
- Create: `src/api/stocking.ts`
- Modify: `src/api/server.ts`
- Modify: `src/api/waters.ts`
- Test: `tests/api/stocking.test.ts`

**Interfaces:**
- Produces: `GET /api/stocking/species` → `{ species: Array<{ commonName: string; watersCount: number; eventCount: number; scheduleCount: number; lastStockedOn: string | null }> }` ordered by `watersCount` desc then name.
- Produces: `GET /api/stocking/waters?species=<commonName>` → `{ waters: Array<{ id: number; name: string; waterType: string; states: string[]; lon: number; lat: number; lastStockedOn: string | null }> }` ordered by name; 400 when `species` missing/empty.
- Produces: `GET /api/waters?bbox=…&stocked=<commonName>` → same shape as today, but water pins and reach pins restricted to waters with a stocking record for that species (case-insensitive common-name match). Omitted param → unchanged behavior.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/stocking.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { waterBody } from "../../src/db/schema";
import { loadDatasets } from "../../src/ingest/load";
import type { WaterDataset } from "../../src/ingest/datasetSchema";
import { app } from "../../src/api/server";

afterAll(async () => { await closeDb(); });

const src = { key: "s1", url: "https://example.gov/stocking", title: "Stocking Report", documentType: "webpage", instrumentType: "webpage", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null } as const;
const cdfw = { key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] } as const;
const baseReg = { ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "7.50", humanSummary: "5/day", verbatimText: "5 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } } as const;
const rainbow = { commonName: "Rainbow trout", scientificName: "Oncorhynchus mykiss", category: "trout", nativeStatus: "stocked", presence: "stocked" } as const;
const brown = { commonName: "Brown trout", scientificName: "Salmo trutta", category: "trout", nativeStatus: "stocked", presence: "stocked" } as const;

// Water A: two rainbow events. Water B: rainbow schedule + brown event. Water C: no stocking.
const waterA: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Stocked Lake A", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.10, lat: 39.10, verifyCurrent: false },
  authorities: [{ ...cdfw }], reaches: [], species: [{ ...rainbow }], speciesGroups: [],
  sources: [{ ...src }], groups: [], seasonPeriods: [], regulations: [{ ...baseReg }], reciprocity: [],
  stockingEvents: [
    { speciesCommonName: "Rainbow trout", quantity: 500, sizeNote: null, date: "2026-04-01", sourceKeys: { primary: "s1", corroborating: [] } },
    { speciesCommonName: "Rainbow trout", quantity: 300, sizeNote: null, date: "2026-06-15", sourceKeys: { primary: "s1", corroborating: [] } },
  ],
  stockingSchedule: [],
};
const waterB: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Stocked Lake B", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.20, lat: 39.20, verifyCurrent: false },
  authorities: [{ ...cdfw }], reaches: [], species: [{ ...rainbow }, { ...brown }], speciesGroups: [],
  sources: [{ ...src }], groups: [], seasonPeriods: [], regulations: [{ ...baseReg }], reciprocity: [],
  stockingEvents: [
    { speciesCommonName: "Brown trout", quantity: 100, sizeNote: null, date: "2026-05-01", sourceKeys: { primary: "s1", corroborating: [] } },
  ],
  stockingSchedule: [
    { speciesCommonName: "Rainbow trout", frequency: "seasonal", seasonStartMonth: 4, seasonEndMonth: 9, note: "Stocked through summer.", sourceKeys: { primary: "s1", corroborating: [] } },
  ],
};
const waterC: WaterDataset = {
  asOf: "2026-07-01",
  water: { name: "Wild Lake C", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.30, lat: 39.30, verifyCurrent: false },
  authorities: [{ ...cdfw }], reaches: [], species: [{ ...rainbow }], speciesGroups: [],
  sources: [{ ...src }], groups: [], seasonPeriods: [], regulations: [{ ...baseReg }], reciprocity: [],
  stockingEvents: [], stockingSchedule: [],
};

describe("stocking browse API", () => {
  beforeAll(async () => { await loadDatasets(db, [waterA, waterB, waterC]); });

  it("GET /api/stocking/species aggregates by common name across waters", async () => {
    const res = await app.request("/api/stocking/species");
    expect(res.status).toBe(200);
    const body = await res.json();
    const rainbowRow = body.species.find((s: any) => s.commonName === "Rainbow trout");
    const brownRow = body.species.find((s: any) => s.commonName === "Brown trout");
    expect(rainbowRow).toEqual({ commonName: "Rainbow trout", watersCount: 2, eventCount: 2, scheduleCount: 1, lastStockedOn: "2026-06-15" });
    expect(brownRow).toEqual({ commonName: "Brown trout", watersCount: 1, eventCount: 1, scheduleCount: 0, lastStockedOn: "2026-05-01" });
    // rainbow (2 waters) sorts before brown (1 water)
    expect(body.species.indexOf(rainbowRow)).toBeLessThan(body.species.indexOf(brownRow));
  });

  it("GET /api/stocking/waters lists waters stocked with a species (case-insensitive)", async () => {
    const res = await app.request("/api/stocking/waters?species=rainbow%20trout");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.waters.map((w: any) => w.name)).toEqual(["Stocked Lake A", "Stocked Lake B"]);
    const a = body.waters.find((w: any) => w.name === "Stocked Lake A");
    expect(a.lastStockedOn).toBe("2026-06-15");
    expect(typeof a.lon).toBe("number");
    const b = body.waters.find((w: any) => w.name === "Stocked Lake B");
    expect(b.lastStockedOn).toBeNull(); // schedule-only for this species
  });

  it("GET /api/stocking/waters without species is a 400", async () => {
    expect((await app.request("/api/stocking/waters")).status).toBe(400);
    expect((await app.request("/api/stocking/waters?species=")).status).toBe(400);
  });

  it("GET /api/waters honors the stocked= filter for pins", async () => {
    const bbox = "bbox=-121,39,-119,40";
    const all = await (await app.request(`/api/waters?${bbox}`)).json();
    expect(all.waters.map((w: any) => w.name).sort()).toEqual(["Stocked Lake A", "Stocked Lake B", "Wild Lake C"]);

    const brownOnly = await (await app.request(`/api/waters?${bbox}&stocked=Brown%20trout`)).json();
    expect(brownOnly.waters.map((w: any) => w.name)).toEqual(["Stocked Lake B"]);

    const rainbowOnly = await (await app.request(`/api/waters?${bbox}&stocked=RAINBOW%20TROUT`)).json();
    expect(rainbowOnly.waters.map((w: any) => w.name).sort()).toEqual(["Stocked Lake A", "Stocked Lake B"]);

    const none = await (await app.request(`/api/waters?${bbox}&stocked=Golden%20trout`)).json();
    expect(none.waters).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/keeper && npx vitest run tests/api/stocking.test.ts`
Expected: FAIL — `/api/stocking/species` and `/api/stocking/waters` return the SPA fallback or 404 (routes don't exist), and the `stocked=` filter assertions fail (param ignored).

- [ ] **Step 3: Create the stocking route file**

Create `src/api/stocking.ts`:

```ts
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

export const stocking = new Hono();

/** Species that have source-backed stocking records (events or schedules), aggregated by
 *  common name — the species table holds one row per (water, species), so identity here is
 *  the name, not the id. */
stocking.get("/api/stocking/species", async (c) => {
  const rows = (await db.execute(sql`
    select sp.common_name as "commonName",
           count(distinct x.water_body_id)::int as "watersCount",
           count(*) filter (where x.kind = 'event')::int as "eventCount",
           count(*) filter (where x.kind = 'schedule')::int as "scheduleCount",
           max(x.stocked_on)::text as "lastStockedOn"
    from (
      select e.species_id, e.water_body_id, e.stocked_on, 'event' as kind
        from species_stocking_event e
      union all
      select s.species_id, s.water_body_id, null::date, 'schedule'
        from species_stocking_schedule s
    ) x
    join species sp on sp.id = x.species_id
    group by sp.common_name
    order by count(distinct x.water_body_id) desc, sp.common_name
  `)) as unknown as Array<Record<string, unknown>>;

  return c.json({
    species: rows.map((r) => ({
      commonName: r.commonName as string,
      watersCount: Number(r.watersCount),
      eventCount: Number(r.eventCount),
      scheduleCount: Number(r.scheduleCount),
      lastStockedOn: (r.lastStockedOn as string | null) ?? null,
    })),
  });
});

/** Waters stocked with one species (case-insensitive common-name match), viewport-independent —
 *  feeds the panel's water list; lastStockedOn is per-species-at-this-water (null = schedule only). */
stocking.get("/api/stocking/waters", async (c) => {
  const species = c.req.query("species")?.trim();
  if (!species) return c.json({ error: "species query param is required" }, 400);

  const rows = (await db.execute(sql`
    select w.id, w.name, w.water_type as "waterType", w.states,
           st_x(st_centroid(w.geom)) as lon, st_y(st_centroid(w.geom)) as lat,
           max(x.stocked_on)::text as "lastStockedOn"
    from (
      select e.species_id, e.water_body_id, e.stocked_on from species_stocking_event e
      union all
      select s.species_id, s.water_body_id, null::date from species_stocking_schedule s
    ) x
    join species sp on sp.id = x.species_id
    join water_body w on w.id = x.water_body_id
    where lower(sp.common_name) = lower(${species}) and w.geom is not null
    group by w.id, w.name, w.water_type, w.states, w.geom
    order by w.name
  `)) as unknown as Array<Record<string, unknown>>;

  return c.json({
    waters: rows.map((r) => ({
      id: Number(r.id),
      name: r.name as string,
      waterType: r.waterType as string,
      states: (r.states as string[]) ?? [],
      lon: Number(r.lon),
      lat: Number(r.lat),
      lastStockedOn: (r.lastStockedOn as string | null) ?? null,
    })),
  });
});
```

- [ ] **Step 4: Register the route before the static block**

In `src/api/server.ts`, find:

```ts
import { waters } from "./waters";
import { rules } from "./rules";

export const app = new Hono();

app.route("/", waters);
app.route("/", rules);
```

Replace with:

```ts
import { waters } from "./waters";
import { rules } from "./rules";
import { stocking } from "./stocking";

export const app = new Hono();

app.route("/", waters);
app.route("/", rules);
app.route("/", stocking);
```

- [ ] **Step 5: Add the `stocked=` filter to /api/waters**

In `src/api/waters.ts`, find:

```ts
waters.get("/api/waters", async (c) => {
  const bbox = parseBbox(c.req.query("bbox"));
  if (!bbox) return c.json({ error: "bbox must be minLon,minLat,maxLon,maxLat with min < max" }, 400);
  const [minLon, minLat, maxLon, maxLat] = bbox;
```

Replace with:

```ts
waters.get("/api/waters", async (c) => {
  const bbox = parseBbox(c.req.query("bbox"));
  if (!bbox) return c.json({ error: "bbox must be minLon,minLat,maxLon,maxLat with min < max" }, 400);
  const [minLon, minLat, maxLon, maxLat] = bbox;
  // Optional stocked-species filter: restrict pins to waters with a source-backed stocking
  // record (event or schedule) for this species, matched case-insensitively by common name.
  const stocked = c.req.query("stocked")?.trim() || null;
```

Then in the water-pins query, find:

```ts
    from water_body w
    where w.geom is not null
      and st_intersects(w.geom, st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))
    order by w.name
```

Replace with:

```ts
    from water_body w
    where w.geom is not null
      and st_intersects(w.geom, st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))
      and (${stocked}::text is null or exists (
        select 1 from (
          select e.water_body_id, e.species_id from species_stocking_event e
          union all
          select s.water_body_id, s.species_id from species_stocking_schedule s
        ) sx join species sp on sp.id = sx.species_id
        where sx.water_body_id = w.id and lower(sp.common_name) = lower(${stocked})
      ))
    order by w.name
```

And in the reach query, find:

```ts
    from reach r
    join water_body w on w.id = r.water_body_id
    where (
          (r.geom is not null and st_intersects(r.geom, st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)))
       or (r.geom is null and r.lon is not null and r.lat is not null
           and st_intersects(st_setsrid(st_makepoint(r.lon, r.lat), 4326), st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)))
    )
    order by w.name, r.id
```

Replace with:

```ts
    from reach r
    join water_body w on w.id = r.water_body_id
    where (
          (r.geom is not null and st_intersects(r.geom, st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)))
       or (r.geom is null and r.lon is not null and r.lat is not null
           and st_intersects(st_setsrid(st_makepoint(r.lon, r.lat), 4326), st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)))
    )
      and (${stocked}::text is null or exists (
        select 1 from (
          select e.water_body_id, e.species_id from species_stocking_event e
          union all
          select s.water_body_id, s.species_id from species_stocking_schedule s
        ) sx join species sp on sp.id = sx.species_id
        where sx.water_body_id = w.id and lower(sp.common_name) = lower(${stocked})
      ))
    order by w.name, r.id
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/api/stocking.test.ts tests/api/waters.test.ts`
Expected: all pass (including the pre-existing waters tests — the filter is a no-op when omitted).

- [ ] **Step 7: Full suite + typecheck, commit**

Run: `cd ~/keeper && npm run typecheck && npm test`
Expected: green.

```bash
git add src/api/stocking.ts src/api/server.ts src/api/waters.ts tests/api/stocking.test.ts
git commit -m "feat(api): stocked-fish species summary, waters-by-species, and stocked= pin filter"
```

---

### Task 2: Frontend — StockedFishPanel + map filter

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/StockedFishPanel.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/Map.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: Task 1's three endpoints exactly as typed there.
- Produces: `StockedFishPanel({ open, onClose, activeFilter, onFilter, onPickWater })` component; `MapView` gains props `stockedFilter: string | null` and `flyTo: { lon: number; lat: number } | null`; `fetchWaters(bbox, signal, stocked?)` gains an optional third param.

- [ ] **Step 1: Add API types + fetchers**

In `web/src/api.ts`, find the `fetchWaters` function:

```ts
/** Fetch water + reach pins inside a bbox. `bbox` is "minLon,minLat,maxLon,maxLat". */
export async function fetchWaters(
  bbox: string,
  signal?: AbortSignal,
): Promise<{ waters: WaterPin[]; reaches: ReachPin[] }> {
  return getJson<{ waters: WaterPin[]; reaches: ReachPin[] }>(
    `/api/waters?bbox=${encodeURIComponent(bbox)}`,
    signal,
  );
}
```

Replace with:

```ts
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
```

- [ ] **Step 2: Create the panel component**

Create `web/src/StockedFishPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  fetchStockedSpecies,
  fetchStockedWaters,
  type StockedSpeciesRow,
  type StockedWaterRow,
} from "./api";
import { CloseIcon, RetryIcon } from "./icons";

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m]} ${d}, ${y}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  activeFilter: string | null;
  onFilter: (species: string | null) => void;
  onPickWater: (water: StockedWaterRow) => void;
}

/** Ledger-styled browser for source-backed stocking records: species list -> waters stocked
 *  with the selected species. Selecting a species also filters the map via onFilter. */
export function StockedFishPanel({ open, onClose, activeFilter, onFilter, onPickWater }: Props) {
  const [species, setSpecies] = useState<StockedSpeciesRow[] | null>(null);
  const [waters, setWaters] = useState<StockedWaterRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || species) return;
    const ac = new AbortController();
    fetchStockedSpecies(ac.signal)
      .then((rows) => { setSpecies(rows); setError(false); })
      .catch(() => { if (!ac.signal.aborted) setError(true); });
    return () => ac.abort();
  }, [open, species]);

  useEffect(() => {
    if (!activeFilter) { setWaters(null); return; }
    const ac = new AbortController();
    setWaters(null);
    fetchStockedWaters(activeFilter, ac.signal)
      .then((rows) => setWaters(rows))
      .catch(() => { if (!ac.signal.aborted) setError(true); });
    return () => ac.abort();
  }, [activeFilter]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <section className="stocked-panel" role="dialog" aria-modal="false" aria-label="Stocked fish browser">
      <div className="stocked-head">
        <h2 className="stocked-title">Stocked fish</h2>
        <button className="sheet-close stocked-close" aria-label="Close" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>

      {error && (
        <div className="stocked-error" role="alert">
          <span>Couldn’t load stocking data.</span>
          <button className="btn-retry" onClick={() => { setError(false); setSpecies(null); }}>
            <RetryIcon size={15} /> Retry
          </button>
        </div>
      )}

      {!activeFilter && species && (
        <ul className="stocked-list">
          {species.map((s) => (
            <li key={s.commonName}>
              <button className="stocked-row" onClick={() => onFilter(s.commonName)}>
                <span className="stocked-species-name">{s.commonName}</span>
                <span className="stocked-meta">
                  {s.watersCount} water{s.watersCount === 1 ? "" : "s"}
                  {s.lastStockedOn ? ` · last ${formatDate(s.lastStockedOn)}` : ""}
                </span>
              </button>
            </li>
          ))}
          {species.length === 0 && <li className="stocked-empty">No stocking records yet.</li>}
        </ul>
      )}

      {activeFilter && (
        <>
          <button className="stocked-back" onClick={() => onFilter(null)}>
            ← All species
          </button>
          <p className="stocked-filter-note">
            Showing waters stocked with <strong>{activeFilter}</strong>
          </p>
          <ul className="stocked-list">
            {(waters ?? []).map((w) => (
              <li key={w.id}>
                <button className="stocked-row" onClick={() => onPickWater(w)}>
                  <span className="stocked-species-name">{w.name}</span>
                  <span className="stocked-meta">
                    {w.states.join("·")}
                    {w.lastStockedOn ? ` · last ${formatDate(w.lastStockedOn)}` : " · scheduled"}
                  </span>
                </button>
              </li>
            ))}
            {waters === null && !error && <li className="stocked-empty">Loading…</li>}
          </ul>
        </>
      )}

      {!activeFilter && species === null && !error && <p className="stocked-empty">Loading…</p>}
    </section>
  );
}
```

- [ ] **Step 3: Wire filter + panel + fly-to into App**

Replace the full contents of `web/src/App.tsx` with:

```tsx
import { useCallback, useState } from "react";
import { MapView } from "./Map";
import { RulesSheet } from "./RulesSheet";
import { StockedFishPanel } from "./StockedFishPanel";
import type { WaterPin, ScopeStatus, StockedWaterRow } from "./api";

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function App() {
  const [selected, setSelected] = useState<WaterPin | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<ScopeStatus | null>(null);
  const [focusScope, setFocusScope] = useState<string | null>(null);
  const [stockedOpen, setStockedOpen] = useState(false);
  const [stockedFilter, setStockedFilter] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number } | null>(null);

  const handleSelect = useCallback((pin: WaterPin, scope?: string) => {
    setSelected(pin);
    setSelectedStatus(null); // reset until rules resolve
    setFocusScope(scope ?? null);
  }, []);

  const handleStatus = useCallback((_id: number, status: ScopeStatus) => {
    // RulesSheet aborts superseded fetches, so any status that arrives is current.
    setSelectedStatus(status);
  }, []);

  const handleClose = useCallback(() => {
    setSelected(null);
    setSelectedStatus(null);
  }, []);

  const handlePickStockedWater = useCallback((w: StockedWaterRow) => {
    setFlyTo({ lon: w.lon, lat: w.lat });
    setStockedOpen(false);
    handleSelect({
      id: w.id, name: w.name, waterType: w.waterType, states: w.states,
      lon: w.lon, lat: w.lat, verifyCurrent: false, ruleCount: 0,
    });
  }, [handleSelect]);

  return (
    <div className="app">
      <MapView
        selectedId={selected?.id ?? null}
        selectedStatus={selectedStatus}
        onSelect={handleSelect}
        stockedFilter={stockedFilter}
        flyTo={flyTo}
      />

      <div className="brand-chip">
        <span className="brand-wordmark">
          Keeper
          <span className="brand-seal" aria-hidden="true" />
        </span>
        <span className="brand-sub">CA·NV fishing rules — {todayLabel()}</span>
      </div>

      <div className="overlay-chips">
        <button className="stocked-chip" onClick={() => setStockedOpen((v) => !v)} aria-expanded={stockedOpen}>
          Stocked fish
        </button>
        {stockedFilter && (
          <button
            className="stocked-chip stocked-chip--active"
            onClick={() => setStockedFilter(null)}
            aria-label={`Clear stocked filter: ${stockedFilter}`}
          >
            {stockedFilter} ×
          </button>
        )}
      </div>

      <StockedFishPanel
        open={stockedOpen}
        onClose={() => setStockedOpen(false)}
        activeFilter={stockedFilter}
        onFilter={setStockedFilter}
        onPickWater={handlePickStockedWater}
      />

      <RulesSheet pin={selected} focusScope={focusScope} onClose={handleClose} onStatus={handleStatus} />
    </div>
  );
}
```

- [ ] **Step 4: Thread the filter + flyTo through MapView**

In `web/src/Map.tsx`, find:

```ts
interface MapProps {
  selectedId: number | null;
  selectedStatus: ScopeStatus | null;
  onSelect: (pin: WaterPin, focusScope?: string) => void;
}
```

Replace with:

```ts
interface MapProps {
  selectedId: number | null;
  selectedStatus: ScopeStatus | null;
  onSelect: (pin: WaterPin, focusScope?: string) => void;
  /** When set, only waters stocked with this species (and their reaches) are shown. */
  stockedFilter: string | null;
  /** One-shot fly request (e.g. picking a water from the stocked-fish panel). */
  flyTo: { lon: number; lat: number } | null;
}
```

Find:

```ts
export function MapView({ selectedId, selectedStatus, onSelect }: MapProps) {
```

Replace with:

```ts
export function MapView({ selectedId, selectedStatus, onSelect, stockedFilter, flyTo }: MapProps) {
```

Find (in the live-refs block):

```ts
  const selectedIdRef = useRef<number | null>(selectedId);
  selectedIdRef.current = selectedId;
```

Replace with:

```ts
  const selectedIdRef = useRef<number | null>(selectedId);
  selectedIdRef.current = selectedId;
  const stockedFilterRef = useRef<string | null>(stockedFilter);
  stockedFilterRef.current = stockedFilter;
```

Find (inside `refresh`):

```ts
      fetchWaters(bbox, ac.signal)
```

Replace with:

```ts
      fetchWaters(bbox, ac.signal, stockedFilterRef.current)
```

Find the selection-restyle effect:

```ts
  }, [selectedId, selectedStatus]);
```

Insert immediately after it (two new effects):

```ts
  // Refetch pins when the stocked-species filter changes.
  useEffect(() => {
    refreshRef.current();
  }, [stockedFilter]);

  // One-shot fly-to (picking a water from the stocked-fish panel).
  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    mapRef.current.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: 12, duration: 900 });
  }, [flyTo]);
```

- [ ] **Step 5: CSS**

In `web/src/styles.css`, find the closing brace of the `.brand-sub` rule (search for `.brand-sub`), and append after that rule block:

```css
/* --- stocked-fish browser --- */
.overlay-chips {
  position: fixed;
  top: calc(var(--safe-top, 0px) + 14px);
  right: 14px;
  display: flex;
  gap: 8px;
  z-index: 20;
}
.stocked-chip {
  font-family: var(--font-body);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
  background: color-mix(in srgb, var(--bone) 94%, transparent);
  backdrop-filter: blur(6px);
  border: 1px solid var(--ink-14);
  border-radius: var(--radius-pill);
  padding: 7px 12px;
  box-shadow: var(--shadow-chip);
  cursor: pointer;
}
.stocked-chip--active {
  background: var(--warden);
  color: var(--bone);
  border-color: var(--warden);
}
.stocked-panel {
  position: fixed;
  top: calc(var(--safe-top, 0px) + 56px);
  right: 14px;
  width: min(340px, calc(100vw - 28px));
  max-height: min(60dvh, 520px);
  overflow-y: auto;
  background: var(--bone);
  border: 1px solid var(--ink-14);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-sheet);
  z-index: 30;
  padding: 12px 14px;
}
.stocked-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.stocked-title {
  font-family: var(--font-display);
  font-size: 18px;
  margin: 0;
}
.stocked-close {
  position: static;
}
.stocked-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.stocked-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-top: 1px dashed var(--ink-12);
  padding: 9px 2px;
  cursor: pointer;
}
.stocked-list li:first-child .stocked-row {
  border-top: none;
}
.stocked-species-name {
  font-family: var(--font-body);
  font-weight: 600;
  font-size: 13.5px;
  color: var(--ink);
}
.stocked-meta {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--ink-48);
}
.stocked-back {
  background: none;
  border: none;
  color: var(--ink-64);
  font-family: var(--font-body);
  font-size: 12.5px;
  padding: 2px 0 6px;
  cursor: pointer;
}
.stocked-filter-note {
  font-size: 12.5px;
  color: var(--ink-64);
  margin: 0 0 4px;
}
.stocked-empty {
  font-size: 12.5px;
  color: var(--ink-48);
  padding: 8px 2px;
  list-style: none;
}
.stocked-error {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: var(--ink-64);
  padding: 8px 2px;
}
```

(If any custom property referenced here doesn't exist in `:root` — check `--radius-pill`, `--ink-12`, `--ink-14` — substitute the closest existing token from `:root` rather than inventing a new one.)

- [ ] **Step 6: Typecheck + build**

Run: `cd ~/keeper && npm run typecheck && npm run build:web`
Expected: both succeed (a pre-existing >500 kB chunk warning is fine).

- [ ] **Step 7: Commit**

```bash
git add web/src/api.ts web/src/StockedFishPanel.tsx web/src/App.tsx web/src/Map.tsx web/src/styles.css
git commit -m "feat(web): stocked-fish browser panel + map species filter"
```

---

### Task 3: End-to-end verification

**Files:** none (verification only; do NOT run `npm run ingest:corridor` — see Global Constraints).

**Interfaces:**
- Consumes: everything from Tasks 1–2, against the live DB (which currently has stocking data for Battle Born Pond only: 2 events — Rainbow trout, Channel catfish).

- [ ] **Step 1: Restart the service**

```bash
tmux kill-session -t keeper 2>/dev/null; ~/keeper/scripts/keeper-tmux.sh
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8791/
```
Expected: `200`.

- [ ] **Step 2: API checks**

```bash
curl -s http://localhost:8791/api/stocking/species | python3 -m json.tool
```
Expected: two species rows (Rainbow trout, Channel catfish), each `watersCount: 1`, correct `lastStockedOn` (`2024-05-14` rainbow, `2025-05-29` catfish).

```bash
curl -s "http://localhost:8791/api/stocking/waters?species=Channel%20catfish" | python3 -m json.tool
curl -s "http://localhost:8791/api/waters?bbox=-120.0,39.4,-119.6,39.8&stocked=Channel%20catfish" | python3 -c "import sys,json; d=json.load(sys.stdin); print([w['name'] for w in d['waters']])"
```
Expected: Battle Born Pond in both; the filtered pins list contains ONLY Battle Born Pond.

- [ ] **Step 3: Visual check via Playwright**

Navigate to `http://localhost:8791/`, click the "Stocked fish" chip, screenshot. Confirm: the panel lists the two species with counts; selecting "Channel catfish" filters the map (only Battle Born Pond's pin remains in the Reno area) and shows the active-filter chip; clicking the water in the list flies to it and opens its rules sheet; the × chip clears the filter and pins return.

- [ ] **Step 4: Ledger note**

Append to `.superpowers/sdd/progress.md`: `Stocked-fish browser: Tasks 1-3 complete (commits <shas>), verified live.`
