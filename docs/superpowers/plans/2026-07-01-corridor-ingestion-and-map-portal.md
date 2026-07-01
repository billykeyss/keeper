# Corridor Ingestion + Map Portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real cited regulations + coordinates for the 12 Truckee–Tahoe–Reno corridor waters loaded idempotently into Postgres, a Hono read API (bbox pins + resolved-rules-for-a-date), and a mobile-first MapLibre web portal — per `docs/superpowers/specs/2026-07-01-corridor-ingestion-and-map-portal-design.md`.

**Architecture:** Tests move to a dedicated `fishing_law_test` DB so the app DB is wholly owned by an idempotent wipe-and-reload loader. Research-verified JSON dataset files (`data/corridor/*.json`) validate against a Zod dataset schema and flow through the existing correctness checks (`validateParameters`, `checkSpeciesScope`, `checkLegalInstrument`) inside one transaction. A small Hono server exposes `/api/waters?bbox=` (PostGIS envelope query) and `/api/waters/:id/rules?on=` (scope + season resolution via `resolveDateSpec`), and statically serves the Vite/React/MapLibre SPA.

**Tech Stack:** existing Drizzle/PostGIS/Zod/Vitest foundation + Hono, @hono/node-server, tsx (runtime), Vite + React + maplibre-gl (web), OSM raster tiles.

**Conventions:** follow the existing repo patterns (see `src/db/`, `src/params/`, `src/seed/corridor.ts`). All commits end with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; use `git -c user.name="fishing-law-dev" -c user.email="yichenhuang95@gmail.com" commit ...` if identity is unset.

---

## File Structure

```
tests/globalSetup.ts              # create fishing_law_test + run migrations (test isolation)
vitest.config.ts                  # (modify) env DATABASE_URL → test DB, globalSetup
src/ingest/datasetSchema.ts       # Zod schema for data/corridor/*.json
src/ingest/load.ts                # wipe-and-reload loader (single transaction)
src/ingest/cli.ts                 # `npm run ingest:corridor`
data/corridor/*.json              # 12 research-verified water datasets
src/api/server.ts                 # Hono app + static serve + listen
src/api/waters.ts                 # GET /api/waters?bbox=
src/api/rules.ts                  # GET /api/waters/:id/rules?on=  (+ resolution helpers)
src/api/season.ts                 # isDateInWindow(startSpec, endSpec, date)
web/                              # Vite + React + maplibre-gl SPA (see Task 8/9)
tests/ingest/*.test.ts            # schema + loader tests
tests/api/*.test.ts               # API integration tests
```

---

## Phase A — Test-database isolation

### Task 1: Move the Vitest suite to `fishing_law_test`

**Files:**
- Create: `tests/globalSetup.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write `tests/globalSetup.ts`**

```ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const ADMIN_URL = "postgres://fl:fl@localhost:5433/fishing_law";
export const TEST_URL = "postgres://fl:fl@localhost:5433/fishing_law_test";

export default async function setup() {
  const admin = postgres(ADMIN_URL, { max: 1 });
  const exists = await admin`select 1 from pg_database where datname = 'fishing_law_test'`;
  if (exists.length === 0) await admin.unsafe(`create database fishing_law_test`);
  await admin.end({ timeout: 5 });

  const test = postgres(TEST_URL, { max: 1 });
  await test.unsafe(`create extension if not exists postgis`);
  await migrate(drizzle(test), { migrationsFolder: "migrations" });
  await test.end({ timeout: 5 });
}
```

- [ ] **Step 2: Point the suite at the test DB in `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
    fileParallelism: false,
    globalSetup: ["tests/globalSetup.ts"],
    env: { DATABASE_URL: "postgres://fl:fl@localhost:5433/fishing_law_test" },
  },
});
```

- [ ] **Step 3: Verify isolation**

Run: `npm test` → all 69 existing tests pass (now against `fishing_law_test`).
Then confirm the app DB stopped growing: run the count query twice around a second `npm test`:
`docker compose exec -T db psql -U fl -d fishing_law -tA -c "select count(*) from regulation"` — identical before/after.
Note: `tests/validation/asOf.test.ts` applies the audit trigger via `applySqlFile`; migration 0002 already created it in the test DB — the `create or replace` is idempotent, no change needed.

- [ ] **Step 4: Commit**

```bash
git add tests/globalSetup.ts vitest.config.ts
git commit -m "test: isolate suite in fishing_law_test database"
```

---

## Phase B — Dataset schema + loader

### Task 2: Zod dataset schema

**Files:**
- Create: `src/ingest/datasetSchema.ts`
- Test: `tests/ingest/datasetSchema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { waterDataset } from "../../src/ingest/datasetSchema";

const minimal = {
  asOf: "2026-07-01",
  water: { name: "Donner Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"], aliases: [], gnisId: null, lon: -120.2437, lat: 39.3237, verifyCurrent: false },
  authorities: [{ key: "cdfw", name: "California Department of Fish and Wildlife", state: "CA", type: "state_agency", roles: ["take_rules"] }],
  reaches: [], species: [], speciesGroups: [],
  sources: [{ key: "s1", url: "https://example.gov", title: "CCR T14 §7.50", documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory", authorityKey: "cdfw", retrievedDate: "2026-07-01", quotedText: null }],
  groups: [], seasonPeriods: [],
  regulations: [{ ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" }, groupKey: null, seasonPeriodKey: null, authorityKey: "cdfw", rulePolarity: "applies", speciesScope: "all", speciesTargets: [], scope: { type: "water" }, appliesToClass: "any", jurisdictionState: "CA", citation: "7.50(b)", humanSummary: "5 trout/day", verbatimText: "5 per day", isParaphrase: false, confidence: "high", sourceKeys: { primary: "s1", corroborating: [] } }],
  reciprocity: [],
};

describe("waterDataset schema", () => {
  it("accepts a minimal valid dataset", () => {
    expect(waterDataset.parse(minimal).water.name).toBe("Donner Lake");
  });
  it("rejects an unknown source key reference shape and unknown fields", () => {
    expect(() => waterDataset.parse({ ...minimal, bogus: 1 })).toThrow();
  });
  it("rejects a listed regulation without species targets", () => {
    const bad = structuredClone(minimal);
    (bad.regulations[0] as any).speciesScope = "listed";
    expect(() => waterDataset.parse(bad)).toThrow(/listed/);
  });
});
```

- [ ] **Step 2: Run to confirm failure** — `npx vitest run tests/ingest/datasetSchema.test.ts` → module not found.

- [ ] **Step 3: Write `src/ingest/datasetSchema.ts`** (all objects `.strict()`; reuse `dateSpec` + `RULE_TYPES` from `src/params/shared`)

```ts
import { z } from "zod";
import { dateSpec, RULE_TYPES } from "../params/shared";

const key = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const waterInfo = z.object({
  name: z.string(), waterType: z.enum(["lake","reservoir","river","stream","creek","pond","marina","impoundment"]),
  states: z.array(z.enum(["CA","NV"])).min(1), counties: z.array(z.string()), aliases: z.array(z.string()),
  gnisId: z.string().nullable(), lon: z.number().min(-125).max(-114), lat: z.number().min(35).max(43),
  verifyCurrent: z.boolean(),
}).strict();

const authorityRow = z.object({
  key, name: z.string(), state: z.enum(["CA","NV"]).nullable(),
  type: z.enum(["state_agency","tribal","federal","land_trust","ngo","private_landowner"]),
  roles: z.array(z.enum(["take_rules","access","land_management","permit_issuer","none"])),
}).strict();

const reachRow = z.object({ key, name: z.string(), fromDesc: z.string(), toDesc: z.string(), lon: z.number(), lat: z.number() }).strict();

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
  jurisdictionState: z.enum(["CA","NV"]).nullable(), citation: z.string(), humanSummary: z.string(),
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
```

- [ ] **Step 4: Run to confirm pass, typecheck, commit**

```bash
npx vitest run tests/ingest/datasetSchema.test.ts && npm run typecheck
git add src/ingest/datasetSchema.ts tests/ingest/datasetSchema.test.ts
git commit -m "feat(ingest): Zod dataset schema for corridor water files"
```

### Task 3: Wipe-and-reload loader

**Files:**
- Create: `src/ingest/load.ts`, `src/ingest/cli.ts`
- Modify: `package.json` (script `"ingest:corridor": "tsx src/ingest/cli.ts"`; add `hono`, `@hono/node-server` deps now too so one install covers Phase C)
- Test: `tests/ingest/load.test.ts`

- [ ] **Step 1: Write the failing test** (runs against the test DB — the loader takes a `db` handle)

```ts
import { describe, it, expect, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { regulation, waterBody } from "../../src/db/schema";
import { loadDatasets } from "../../src/ingest/load";
import type { WaterDataset } from "../../src/ingest/datasetSchema";

afterAll(async () => { await closeDb(); });

const ds: WaterDataset = /* the same `minimal` object from Task 2's test, typed */ undefined as any;
// In the real test file, import/duplicate the Task 2 `minimal` fixture verbatim and cast once.

describe("loadDatasets", () => {
  it("wipes and reloads idempotently", async () => {
    await loadDatasets(db, [ds]);
    const first = await db.select().from(regulation);
    await loadDatasets(db, [ds]);
    const second = await db.select().from(regulation);
    expect(second.length).toBe(first.length); // no accumulation
    const waters = await db.select().from(waterBody);
    expect(waters).toHaveLength(1);
    expect(waters[0].geom).toBeTruthy();
  });
  it("aborts atomically on an invalid parameters blob", async () => {
    const bad = structuredClone(ds);
    (bad.regulations[0].parameters as any).bogus = 1;
    await expect(loadDatasets(db, [bad])).rejects.toThrow(/bag/);
    const waters = await db.select().from(waterBody); // previous good load still intact
    expect(waters).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write `src/ingest/load.ts`**

Responsibilities, in one `db.transaction`:
1. `TRUNCATE` all domain tables: `license_reciprocity, regulation_source, regulation_target, regulation_species, regulation, season_period, regulation_group, water_body_species, species_group_member, species_group, species_alias, species, reach, zone, water_body_relation, water_body_authority, water_body, source, authority, audit_log RESTART IDENTITY CASCADE` (one statement via `tx.execute(sql.raw(...))`).
2. For each dataset (files may share authorities — dedupe by authority `name` in a cross-file registry):
   - insert authority rows (skip if name already inserted this run), water (geom `SRID=4326;POINT(lon lat)`), `water_body_authority` per role, reaches (point geom → `MultiPoint` is invalid for the `MultiLineString` column — leave reach `geom` null and store lon/lat termini only in descriptors; reach pins come from the water pin in v1), species + `water_body_species`, species groups (+ members when a species with matching category exists), sources, groups, season periods (validate `startSpec`/`endSpec` with `dateSpec.parse`).
   - For each regulation: `validateParameters(ruleType, parameters)` → throw `new Error(\`\${water.name}/\${ruleType}: \${error}\`)` on failure; resolve keys → FK ids; insert regulation (`status: "verified"`, `basis: "explicit"`, `reviewer: "corridor-ingest"`, `lastVerifiedAt: asOf`, `validFrom: null`); insert `regulation_species` targets (throw if a `speciesCommonName`/`speciesGroupKey` is unknown), `regulation_target` (water → the water id; reach → reach id; authority_territory → authority id), `regulation_source` (primary + corroborating).
   - Post-insert per regulation: `checkSpeciesScope` with the just-inserted species rows → throw on `!ok`.
   - Insert reciprocity rows (water-scoped).
3. Return `{ waters, regulations }` counts.

Export `export async function loadDatasets(dbc: typeof db, datasets: WaterDataset[]): Promise<{waters: number; regulations: number}>`.

- [ ] **Step 4: Write `src/ingest/cli.ts`**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db, closeDb } from "../db/client";
import { waterDataset } from "./datasetSchema";
import { loadDatasets } from "./load";

const dir = "data/corridor";
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const datasets = files.map((f) => {
  try { return waterDataset.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))); }
  catch (e) { throw new Error(`${f}: ${e instanceof Error ? e.message : e}`); }
});
const res = await loadDatasets(db, datasets);
console.log(`Loaded ${res.waters} waters, ${res.regulations} regulations from ${files.length} files.`);
await closeDb();
```

- [ ] **Step 5: Run tests, typecheck, commit**

```bash
npx vitest run tests/ingest && npm run typecheck
git add -A && git commit -m "feat(ingest): idempotent wipe-and-reload corridor loader + CLI"
```

---

## Phase C — Corridor dataset (research)

### Task 4: Research, verify, and load the 12 corridor water datasets

**Files:**
- Create: `data/corridor/{donner-lake,lake-tahoe,truckee-river-ca,truckee-river-nv,little-truckee-river,martis-creek-lake,prosser-creek-reservoir,boca-reservoir,stampede-reservoir,pyramid-lake,sparks-marina,independence-lake}.json`

This task is research + data entry against the Task 2 contract, not code. Execution notes for the controller (not a single implementer subagent):

- [ ] **Step 1: Fan out read-only research agents** (3–4 waters each, in parallel) with: the exact dataset JSON contract (Task 2 schema, field-by-field), the water list + coordinates requirement, official-sources-only instruction (CDFW T14 §7.50 / NDOW guide + CR regs / Pyramid Lake Paiute Tribe), and the honesty rule: **unconfirmed values get `confidence:"low"` + conservative `humanSummary`, never invented numbers**. Statewide-default rules (e.g. CA 5-trout default) are encoded per-water with `basis` explicit in verbatim/citation. Each agent RETURNS the JSON (controller writes files).
- [ ] **Step 2: Independent verification agent** — cross-checks every regulation's citation/values against the sources (fetching them), flags mismatches; controller fixes flagged entries or downgrades `confidence`.
- [ ] **Step 3: Validate + load**: `npm run ingest:corridor` → all files parse, loader validation passes, counts printed. Spot-check via psql: every water has geom; `select name, count(r.id) from water_body w left join regulation_target t on ...` — each water has ≥1 rule.
- [ ] **Step 4: Commit** — `git add data/corridor && git commit -m "data: research-verified corridor datasets (12 waters)"`

---

## Phase D — Read API

### Task 5: Hono server + bbox waters endpoint

**Files:**
- Create: `src/api/server.ts`, `src/api/waters.ts`
- Test: `tests/api/waters.test.ts`

- [ ] **Step 1: Write the failing test** (loads a fixture dataset via `loadDatasets` into the test DB, then calls the Hono app via `app.request(...)` — no listener needed)

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { loadDatasets } from "../../src/ingest/load";
import { app } from "../../src/api/server";
// fixture: the Task 2 `minimal` dataset (Donner Lake at -120.2437, 39.3237)

afterAll(async () => { await closeDb(); });

describe("GET /api/waters", () => {
  beforeAll(async () => { await loadDatasets(db, [fixture]); });
  it("returns waters inside the bbox with lon/lat", async () => {
    const res = await app.request("/api/waters?bbox=-120.5,39.2,-120.0,39.5");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.waters).toHaveLength(1);
    expect(body.waters[0]).toMatchObject({ name: "Donner Lake", lon: expect.closeTo(-120.2437, 3), lat: expect.closeTo(39.3237, 3) });
    expect(body.waters[0].ruleCount).toBeGreaterThan(0);
  });
  it("excludes waters outside the bbox", async () => {
    const res = await app.request("/api/waters?bbox=-119.9,39.2,-119.5,39.5");
    expect((await res.json()).waters).toHaveLength(0);
  });
  it("400s on malformed bbox", async () => {
    expect((await app.request("/api/waters?bbox=nope")).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

`src/api/waters.ts` — parse/validate bbox (4 finite numbers, min<max), then:

```ts
const rows = await db.execute(sql`
  select w.id, w.name, w.water_type as "waterType", w.states, w.verify_current as "verifyCurrent",
         st_x(st_centroid(w.geom)) as lon, st_y(st_centroid(w.geom)) as lat,
         (select count(*)::int from regulation_target t
            join regulation r on r.id = t.regulation_id and r.status in ('verified','published')
           where (t.target_type = 'water_body' and t.target_id = w.id)
              or (t.target_type = 'reach' and t.target_id in (select id from reach where water_body_id = w.id))
              or (t.target_type = 'authority_territory' and t.target_id in (select authority_id from water_body_authority where water_body_id = w.id))
         ) as "ruleCount"
  from water_body w
  where w.geom is not null
    and st_intersects(w.geom, st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))`);
```

`src/api/server.ts` — Hono app: `app.route` the two API modules, `serveStatic({ root: "./web/dist" })` fallback for `/` (guard: only if the dir exists), and a `main` block (`if (import.meta.url === pathToFileURL(process.argv[1]).href)`) that `serve({ fetch: app.fetch, port: 8787 })`. Export `app` for tests. Add `"api": "tsx src/api/server.ts"` to package.json scripts.

- [ ] **Step 4: Run tests + typecheck + commit** — `feat(api): Hono server + bbox waters endpoint`.

### Task 6: Rules resolution endpoint

**Files:**
- Create: `src/api/season.ts`, `src/api/rules.ts`
- Test: `tests/api/season.test.ts`, `tests/api/rules.test.ts`

- [ ] **Step 1: Write the failing season-window test**

```ts
import { describe, it, expect } from "vitest";
import { isDateInWindow } from "../../src/api/season";

const lastSatApr = { type: "relative", ordinal: "last", weekday: "sat", month: 4, verbatim: "last Sat Apr" } as const;
const nov15 = { type: "fixed", month: 11, day: 15, verbatim: "Nov 15" } as const;
const nov16 = { type: "fixed", month: 11, day: 16, verbatim: "Nov 16" } as const;
const friBefore = { ...lastSatApr, relation: "preceding", offset_days: -1, verbatim: "Fri preceding" } as const;
const yearRound = { type: "year_round", verbatim: "All year" } as const;

describe("isDateInWindow", () => {
  it("in-year window", () => {
    expect(isDateInWindow(lastSatApr, nov15, "2026-07-01")).toBe(true);   // Apr 25 – Nov 15
    expect(isDateInWindow(lastSatApr, nov15, "2026-12-01")).toBe(false);
  });
  it("cross-year window (winter season)", () => {
    expect(isDateInWindow(nov16, friBefore, "2026-01-15")).toBe(true);    // Nov 16 2025 → Apr 24 2026
    expect(isDateInWindow(nov16, friBefore, "2026-12-01")).toBe(true);    // Nov 16 2026 → Apr 2027
    expect(isDateInWindow(nov16, friBefore, "2026-07-01")).toBe(false);
  });
  it("year_round is always open", () => {
    expect(isDateInWindow(yearRound, yearRound, "2026-02-30" as any)).toBe(false); // invalid date → false
    expect(isDateInWindow(yearRound, yearRound, "2026-02-10")).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `src/api/season.ts`**

```ts
import type { DateSpec } from "../params/shared";
import { resolveDateSpec } from "../resolver/dateSpec";

/** Is `on` (YYYY-MM-DD) inside the recurring window [start, end]?
 *  Handles year_round and windows spanning the calendar-year boundary by testing the
 *  window anchored at both `year` and `year - 1`. Invalid dates return false. */
export function isDateInWindow(start: DateSpec, end: DateSpec, on: string): boolean {
  const t = Date.parse(on + "T00:00:00Z");
  if (Number.isNaN(t)) return false;
  const d = new Date(t);
  if (d.toISOString().slice(0, 10) !== on) return false; // reject 2026-02-30 style rollovers
  if (start.type === "year_round" || end.type === "year_round") return true;
  const year = d.getUTCFullYear();
  for (const y of [year, year - 1]) {
    try {
      const s = Date.parse(resolveDateSpec(start, y) + "T00:00:00Z");
      let e = Date.parse(resolveDateSpec(end, y) + "T00:00:00Z");
      if (e < s) e = Date.parse(resolveDateSpec(end, y + 1) + "T00:00:00Z"); // spans boundary
      if (t >= s && t <= e) return true;
    } catch { /* unresolvable spec (astronomical) → skip */ }
  }
  return false;
}
```

- [ ] **Step 3: Write the failing rules-endpoint test** — fixture with: a water; a reach; a group with two `season_period`s (take/winter as above) + two bags bound to them (daily 2 / daily 0 C&R) scoped to the reach; one water-scoped `gear_method`; one `authority_territory` license rule + `water_body_authority` link; one `asserts_none` size_limit. Assert:
  - `GET /api/waters/:id/rules?on=2026-07-01` → status.overall `"open"`; the reach scope contains the daily-2 bag and NOT the winter bag; the license rule appears (territory via the wba link); the asserts_none rule renders with `polarity: "asserts_none"`.
  - `on=2026-01-15` → reach scope shows the C&R bag; status.overall `"catch_and_release"` for that scope's summary.
  - A water with no season data → status.overall `"unknown"`.
  - Unknown id → 404; bad `on` → 400.

- [ ] **Step 4: Implement `src/api/rules.ts`**

Resolution algorithm (all Drizzle queries against the schema):
1. Load water (404 if missing). Parse `on` (default: today via `new Date().toISOString().slice(0,10)`), 400 if not matching `isoDate` or invalid.
2. Collect applicable regulation ids: direct water target ∪ reach targets (reaches of this water) ∪ authority_territory targets (authorities linked via `water_body_authority`), `mode='include'`; then remove any regulation with an `exclude` target matching the same water/reach set. Only `status in ('verified','published')` and validity window containing `on`.
3. Attach: parameters, `season_period` (via `seasonPeriodId` → start/end/status), group citation fallback, primary source url (`regulation_source role='primary'` → `source.url`), species labels (joined names/groups).
4. Group into scopes: `"water"` + one per reach (label = reach `name`, sublabel `fromDesc → toDesc`). Within a scope, a rule bound to a `season_period` for which `isDateInWindow(...) === false` is filtered out (it's not in force on `on`); `season`-type rules stay (they *describe* the calendar) and get a computed `activeNow` flag per period.
5. Scope status: from active `season` periods / season_period bindings — `open_catch_release` → `catch_and_release`; open + a bag with `catch_and_release:true` → `catch_and_release`; open otherwise → `open`; a `closure` rule active → `closed`; no season info at all → `unknown`. `status.overall` = the water scope's status if known, else `unknown`; `verifyCurrent` copied onto status.
6. Response shape exactly as spec §3; every rule row: `{ ruleType, summary: humanSummary, citation, sourceUrl, polarity, params: parameters, confidence }`; plus top-level `licenses` (rule_type license), `reciprocity` (rows joined with authority names), `species` (water_body_species joined), `asOf: on`.

- [ ] **Step 5: Run tests + typecheck + commit** — `feat(api): resolved rules endpoint with season/scope resolution`.

---

## Phase E — Web portal

### Task 7: Vite/React scaffold + API client

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/styles.css`
- Modify: root `package.json` scripts: `"dev:web": "npm --prefix web run dev"`, `"build:web": "npm --prefix web run build"`, `"start": "npm run build:web && npm run api"`

Key configs:

```jsonc
// web/package.json
{ "name": "fishing-law-web", "private": true, "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -b && vite build", "preview": "vite preview" },
  "dependencies": { "maplibre-gl": "^4.7.0", "react": "^18.3.0", "react-dom": "^18.3.0" },
  "devDependencies": { "@types/react": "^18.3.0", "@types/react-dom": "^18.3.0", "@vitejs/plugin-react": "^4.3.0", "typescript": "^5.6.0", "vite": "^5.4.0" } }
```

```ts
// web/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], server: { proxy: { "/api": "http://localhost:8787" } } });
```

`web/src/api.ts` — typed fetchers `fetchWaters(bbox): Promise<WaterPin[]>` and `fetchRules(id, on?): Promise<RulesResponse>` mirroring the API response types (hand-declared interfaces matching Task 5/6 shapes; throw on `!res.ok`).
`index.html` — `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, title "CA/NV Fishing Rules".

- [ ] Steps: scaffold, `npm --prefix web install`, `npm run build:web` succeeds, commit `feat(web): Vite/React scaffold + typed API client`.

### Task 8: Map + pins + bottom sheet UI

**Files:**
- Create: `web/src/Map.tsx`, `web/src/RulesSheet.tsx`, `web/src/StatusPill.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`

UX contract (the frontend-design guidance provided at dispatch governs visual specifics):

- **Map (`Map.tsx`):** MapLibre with an inline raster style — source `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, `attribution: "© OpenStreetMap contributors"`, `maxZoom: 19`. Initial `center: [-120.0, 39.35], zoom: 9`. On `load` + debounced (250ms) `moveend`: `const b = map.getBounds()` → `fetchWaters(\`${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}\`)` → diff-render `maplibregl.Marker`s (custom DOM element pins showing a water-type glyph; class per status color; amber ring when `verifyCurrent`). Marker click → `onSelect(id)`.
- **Sheet (`RulesSheet.tsx`):** fixed bottom panel, `max-height: 82dvh`, rounded top, drag-handle; states peek (header only) / expanded (scrollable) / closed; renders `fetchRules(id)`: header (name + type/state chips + StatusPill for today), scope sections (water first, then reaches with from→to sublabels), rule cards — big key figures (bag `daily`, size limits with protected slot), plain-English summary, citation + source link line, confidence badge when not `high`, `asserts_none` rendered as "No {rule type} — confirmed" style; licenses/reciprocity section; species chips; sticky amber "Conditions can change — verify current status" banner when `verifyCurrent`; loading skeleton + error retry states. ≥768px: sheet becomes a 420px right-side panel.
- **App.tsx:** holds `selectedId`, composes Map + RulesSheet, top-left floating brand chip ("CA/NV Fishing Rules") + date display.
- All touch targets ≥44px; no hover-only affordances; `100dvh` layout, safe-area padding.

- [ ] Steps: implement, `npm run build:web` clean, manual dev-server smoke (`npm run api` + `npm run dev:web`, open http://localhost:5173), commit `feat(web): map pins + rules bottom sheet (mobile-first)`.

---

## Phase F — End-to-end verification

### Task 9: Full-stack verification + README

- [ ] **Step 1:** `npm run ingest:corridor` (app DB), `npm run build:web`, `npm run api` (serves SPA at http://localhost:8787).
- [ ] **Step 2:** Playwright (MCP) at 390×844: navigate, wait for map tiles + pins; screenshot; tap the Pyramid Lake pin → sheet shows tribal-permit + slot-limit rules with citations; tap a Truckee reach water → reach-scoped sections; confirm status banner matches today's date expectation (e.g. Little Truckee `open`/C&R year-round). Screenshot the open sheet.
- [ ] **Step 3:** Full `npm test` + `npm run typecheck` green.
- [ ] **Step 4:** README: add "Run the portal" section (`npm run db:up && npm run db:migrate && npm run ingest:corridor && npm start` → http://localhost:8787; phone-on-LAN note). Commit `docs: portal run instructions` + any fixes as `fix(web)/fix(api)` commits.

---

## Self-review notes (author)

- Spec coverage: §2 test isolation → Task 1; dataset+loader → Tasks 2–3; research/verify/load → Task 4; §3 API (bbox, rules resolution, static serve, 400/404, unknown-never-open) → Tasks 5–6; §4 portal (map, pins-on-scroll, sheet, mobile, error states, desktop panel) → Tasks 7–8; §5 verification → per-task tests + Task 9.
- Reach geometry: dataset carries reach lon/lat but v1 renders only water pins (spec §6 defers line geometry); reach coordinates are retained in the JSON for the future without a DB column change (descriptors only).
- Type consistency: `loadDatasets(db, datasets)` used in Tasks 3/5/6 tests; `isDateInWindow(start, end, on)` in Tasks 6; API shapes in Task 5/6 match `web/src/api.ts` consumers in Task 7.
