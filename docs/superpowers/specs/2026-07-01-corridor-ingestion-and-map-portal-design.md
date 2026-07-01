# Corridor Ingestion + Map Portal — Design Spec

**Status:** Approved direction (user goal statement 2026-07-01); options resolved to recommended defaults (user AFK)
**Date:** 2026-07-01
**Depends on:** the data-model foundation (`2026-07-01-fishing-regulations-data-model-design.md`), branch `feat/data-model`
**Branch:** `feat/corridor-portal`

---

## 1. Goal

> "A final web portal that I can use easily to check for rules and regulations based on a map
> scroll. The webapp should be mobile optimized."

One vertical slice, three units that only make sense together:

1. **Corridor ingestion** — real, cited regulations + coordinates for the 12 Truckee–Tahoe–Reno
   corridor waters, loaded idempotently into the app database.
2. **Read API** — bbox water lookup + "resolved rules for this water on this date".
3. **Mobile-first map portal** — full-screen map; pins refresh on scroll/zoom; tap a water →
   bottom sheet with plain-English rules, citations, and warnings.

Decisions locked: **agent-research ingestion** (no `ANTHROPIC_API_KEY` in this environment; the
SDK extraction pipeline remains the statewide scale-out phase), **local-only hosting**,
**MapLibre GL + free OSM raster tiles** (no API keys).

## 2. Unit 1 — Corridor ingestion

### Test-database isolation (hygiene prerequisite)
The Vitest suite currently pollutes the app DB (198 waters / 273 regulations of fixture debris).
Fix: tests run against a dedicated **`fishing_law_test`** database.
- `tests/globalSetup.ts`: creates `fishing_law_test` if missing, runs Drizzle migrations against
  it. `vitest.config.ts` sets `DATABASE_URL` to the test DB for the whole suite.
- The app DB (`fishing_law`) is then wholly owned by ingestion.

### Dataset
- `data/corridor/*.json` — one file per water, human-reviewable, validated by a Zod **dataset
  schema** (`src/ingest/datasetSchema.ts`). Content per water: identity (name, type, states,
  counties, aliases, `gnis_id` when known), a point geometry (lon/lat; river files may add
  reaches with from/to descriptions + their own points), authorities + `water_body_authority`
  links (so `authority_territory` scope resolves), species presence, sources (official URL,
  instrument type, authority level, retrieved date, quoted text), regulation groups,
  season periods (date-spec JSON), regulations (rule_type, parameters, citation, verbatim,
  human summary, status `verified`, polarity), and license reciprocity rows.
- Populated by **research agents** against official sources (CDFW T14 §7.50/NDOW guide + CR
  regs/Pyramid Lake tribal regs), then **cross-checked by an independent verification agent**
  before load. Values the agents cannot confirm get `confidence: low` and a conservative
  `human_summary` ("check current regulations"), never invented numbers.

### Loader
- `npm run ingest:corridor` → `src/ingest/load.ts`:
  1. **Wipe-and-reload**: `TRUNCATE` all domain tables (`RESTART IDENTITY CASCADE`; drizzle
     migration bookkeeping untouched). Idempotent by construction.
  2. Validate every file against the dataset schema; every `parameters` blob through
     `validateParameters`; every date-spec through `dateSpec`; run `checkSpeciesScope` and
     (for anything published+binding) `checkLegalInstrument` pre-insert. Any failure aborts
     the load with a named error — nothing partial is committed (single transaction).
  3. Insert in FK order (authority → water/source/species → group → season_period →
     regulation → satellites), stamping `reviewer: "corridor-ingest"`.

## 3. Unit 2 — Read API

**Stack:** Hono + `@hono/node-server` (tiny, TS-first), same repo, `src/api/`.

- `GET /api/waters?bbox=minLon,minLat,maxLon,maxLat` → pins:
  `[{ id, name, waterType, states, lon, lat, verifyCurrent, ruleCount }]` via PostGIS
  `ST_Intersects(geom, ST_MakeEnvelope(...))`. 400 on malformed bbox.
- `GET /api/waters/:id/rules?on=YYYY-MM-DD` (default: today) → resolved view:
  ```
  { water: {...}, status: { overall: open|catch_and_release|closed|unknown, label, verifyCurrent },
    scopes: [ { scope: "water"|reach name, rules: [ { ruleType, summary, detail, citation,
      sourceUrl, polarity } ] } ],
    licenses: [...], reciprocity: [...], species: [...] }
  ```
  Resolution rules: regulations targeting the water directly; reach-scoped rules grouped
  under their reach's name/from-to; `authority_territory` rules apply when the water has a
  `water_body_authority` link to that authority; season status computed for the `on` date via
  `resolveDateSpec` on the rule's `season`/`season_period` windows (windows spanning year
  boundaries handled); **no season data → `unknown`, shown as "check current regulations",
  never "open"**; `verifyCurrent` waters always carry the live-check warning. 404 unknown id.
- Serves the built SPA (`web/dist`) statically at `/`. `npm run api` starts it (port 8787).
- Integration tests (Vitest) against the test DB with a small fixture load.

## 4. Unit 3 — Web portal

**Stack:** `web/` — Vite + React + TypeScript + `maplibre-gl`; OSM raster tiles with
attribution; no component library (hand-rolled, mobile-first CSS). Design quality per the
frontend-design guidance (distinctive, not generic-bootstrap).

- Full-screen map, initial view over Tahoe–Truckee (~zoom 9). On `moveend` → fetch
  `/api/waters?bbox=` for the viewport → render pins (color = open / closed-today / C&R /
  unknown; amber halo when `verifyCurrent`).
- Tap a pin → **bottom sheet** (thumb-friendly, drag between peek/full/dismissed): water name +
  type/state chips; status banner for *today*; rules grouped by scope then rule type with
  plain-English summary, key numbers rendered big (bag limit, size), and the legal citation +
  source link underneath; license/permit + reciprocity section; species list; the
  "verify current conditions" notice where flagged; data as-of footer.
- Loading/error states for both fetches; offline-ish failure shows a retry toast.
- Desktop = same responsive layout (sheet becomes a side panel ≥ 768px).
- `npm run dev:web` (Vite dev, proxying `/api`), `npm run build:web` (into `web/dist`).

## 5. Testing & verification

- Loader: unit tests (schema rejection, wipe idempotency, correctness-check abort) + a full
  corridor load in CI-style test against the test DB.
- API: integration tests — bbox in/out, rules resolution (open vs closed date, reach grouping,
  tribal `authority_territory`, asserts_none rendering, unknown-season → `unknown`).
- Portal: Playwright at iPhone viewport (390×844): map renders, pins appear, tap → sheet
  shows a known rule (e.g. Pyramid slot limit), status banner correct for today.
- Full suite stays green; `npm run typecheck` clean.

## 6. Out of scope (deferred)

SDK extraction pipeline (needs API key; statewide phase), deployment (Render offer stands),
auth/accounts, search/filters beyond the map, offline caching, polygons/reach line geometry
(pins + reach midpoints only in v1), i18n.
