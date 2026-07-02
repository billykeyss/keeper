# Keeper

*Know what you can keep — CA/NV fishing rules on a map.*

Source-of-truth data platform for freshwater sport-fishing species and regulations across
California and Nevada (developed under the working name **fishing-law**). It answers, for a given
water and date: *Is it open? What can I keep? How many? What size? Barbless? Do I need a special
permit?* — with every answer traceable to an authoritative legal instrument and reconstructable
as-of any past date.

The repository contains the **data model** (PostgreSQL/PostGIS schema via Drizzle ORM, per-`rule_type`
Zod parameter validators, correctness machinery, a relative-season date resolver), a
**research-verified corridor dataset** (12 Truckee–Tahoe–Reno waters, 82 cited regulations in
`data/corridor/`), an idempotent **ingest loader**, a **read API** (Hono: bbox water lookup +
resolved-rules-for-a-date), and a **mobile-first map portal** (Vite/React/MapLibre).

## Prerequisites

- **Docker** (Docker Desktop or a compatible engine) — runs the PostGIS database via Docker Compose.
- **Node.js** LTS and npm.

## Run the portal

```bash
npm install                # install dependencies (plus: npm --prefix web install)
npm run db:up              # start the PostGIS 16-3.4 container (Postgres on localhost:5433)
npm run db:migrate         # apply Drizzle migrations (creates all enums + tables)
npm run ingest:corridor    # load the 12 corridor waters + regulations into the app DB
npm start                  # build the web app and serve portal + API on http://localhost:8787
```

Then open **http://localhost:8787** — scroll the map around the Tahoe–Truckee–Reno corridor and
tap a water to see its rules for today, with citations to the governing legal source. If port
8787 is taken, run with `PORT=8791 npm start` (any free port). To use it from your phone, open
`http://<your-computer's-LAN-IP>:8787` while on the same Wi-Fi.

For development: `npm run api` (API only) + `npm run dev:web` (Vite dev server on :5173,
proxying `/api`).

## Setup (data platform only)

```bash
npm install          # install dependencies
npm run db:up        # start the PostGIS 16-3.4 container (Postgres on localhost:5433)
npm run db:migrate   # apply Drizzle migrations (creates all enums + tables)
```

The database connection string defaults to `postgres://fl:fl@localhost:5433/fishing_law`
(override via `DATABASE_URL`; see `.env.example`). If the PostGIS extension is not yet enabled,
run once:

```bash
docker compose exec -T db psql -U fl -d fishing_law -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

## Test

```bash
npm test         # run the full Vitest suite (schema, params, validation, resolver, seed, acceptance)
npm run typecheck  # tsc --noEmit
```

Tests run against a dedicated `fishing_law_test` database (created and migrated automatically by
`tests/globalSetup.ts`), so the app database stays pristine. The acceptance sweep in
`tests/acceptance.test.ts` runs every canonical seed function and asserts that every seeded
regulation's `parameters` blob validates against its Zod schema and satisfies the explicit
all-species sentinel.

## Corridor dataset & honesty rules

`data/corridor/*.json` holds the portal's regulations — researched from official sources only
(CDFW booklet + CCR Title 14, NDOW CR 25-16 + NAC 503, Pyramid Lake Paiute Tribe regulations)
and cross-checked by an independent verification pass. Every rule carries a citation, source URL,
retrieval date, and a `confidence` grade; unconfirmed values are marked `low`/`medium` with
conservative summaries rather than invented numbers, and known agency-document conflicts are
recorded in notes (e.g. CDFW's booklet still mentions Nevada's trout stamp, which was repealed
in 2018). Waters whose status can change out-of-cycle carry `verifyCurrent: true` and the portal
shows a "verify current conditions" banner. **The portal is a convenience summary, not legal
advice — always confirm with the managing agency.**

## Seed data

`src/seed/corridor.ts` encodes the nine canonical corridor cases from the design spec (§7):

1. **Compound bag** (Topaz Lake) — 25 warmwater game fish/day with a ≤5 black-bass carve-out sub-limit.
2. **Two-period reach season** (Truckee River Reach C) — relative `last Saturday in April → Nov 15` take window (2 trout) and a `Nov 16 → Fri before last Sat Apr` catch-and-release winter window, both bags reach-scoped and bound to `season_period` rows rather than re-embedding dates.
3. **Slot limit** (Pyramid Lake) — Lahontan cutthroat protected slot 20–24 in (fork length), keep 17–20 in and ≥1 fish over 24 in.
4. **Reach-scoped closure** (Truckee River Reach A) — closed all year within 1,000 ft below the Lake Tahoe outlet dam; reach anchored by offset descriptor.
5. **Interstate reciprocity** (Lake Tahoe / Donner Lake) — CA or NV license honored at Tahoe (NV side needs trout stamp); NV license explicitly not honored at Donner.
6. **Tribal permit** (Pyramid Lake) — tribal fishing permit replaces the NV state license for non-tribal anglers 12+; reservation-wide `authority_territory` scope.
7. **Little Truckee gear stack** (Little Truckee River, Stampede → Boca) — all-year open season, 0 trout catch-and-release bag, artificial-lures-with-barbless-hooks gear restriction, decomposed into three atomic typed rows sharing one provision.
8. **AIS gate** (Lake Tahoe) — motorized watercraft require inspection, decontamination, Tahoe inspection seal, and drain-plug-out.
9. **Verified absence** (NV Truckee River) — no trout size limit recorded as `rule_polarity=asserts_none`, with a refuted third-party "14-inch minimum" claim stored as a disputed source.

Each seeded regulation is inserted at `status=verified` with a primary legal-instrument source and,
where binding, verbatim text.

## Design docs

The full design and implementation plan live under `docs/superpowers/`:

- **Spec:** `docs/superpowers/specs/2026-07-01-fishing-regulations-data-model-design.md` — entities,
  enums, per-`rule_type` JSONB parameter shapes, the eight correctness/temporal rules (§5), the nine
  canonical worked examples (§7), and the corridor seed-data scope (§8).
- **Plan:** `docs/superpowers/plans/2026-07-01-fishing-regulations-data-model.md` — the task-by-task
  TDD implementation plan (schema → Zod validators → correctness helpers → resolver → seed + acceptance).
