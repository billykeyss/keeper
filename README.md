# fishing-law

Source-of-truth data platform for freshwater sport-fishing species and regulations across
California and Nevada. It answers, for a given water and date: *Is it open? What can I keep?
How many? What size? Barbless? Do I need a special permit?* — with every answer traceable to an
authoritative legal instrument and reconstructable as-of any past date.

This repository is the **data model** slice: a PostgreSQL/PostGIS schema (Drizzle ORM), per-`rule_type`
Zod parameter validators, correctness machinery (legal-instrument enforcement, explicit all-species
sentinel, temporal integrity + clone-on-supersede versioning), a relative-season date resolver, and
human-verified seed data encoding the nine canonical Truckee–Tahoe–Reno corridor cases.

## Prerequisites

- **Docker** (Docker Desktop or a compatible engine) — runs the PostGIS database via Docker Compose.
- **Node.js** LTS and npm.

## Setup

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

Tests run against the live container (Vitest is configured with `fileParallelism: false`, so test
files execute sequentially against the shared database). The acceptance sweep in
`tests/acceptance.test.ts` runs every canonical seed function and asserts that every seeded
regulation's `parameters` blob validates against its Zod schema and satisfies the explicit
all-species sentinel.

## Seed data

`src/seed/corridor.ts` encodes the nine canonical corridor cases from the design spec (§7):
compound bag (Topaz), relative season + zero-limit C&R gear stack (Little Truckee), slot limit
(Pyramid), reach-scoped closure (Truckee Reach A), interstate reciprocity (Tahoe/Donner), tribal
permit (Pyramid), AIS gate (Lake Tahoe), and a verified absence (NV Truckee, no size limit). Each
seeded regulation is inserted at `status=verified` with a primary legal-instrument source and,
where binding, verbatim text.

## Design docs

The full design and implementation plan live under `docs/superpowers/`:

- **Spec:** `docs/superpowers/specs/2026-07-01-fishing-regulations-data-model-design.md` — entities,
  enums, per-`rule_type` JSONB parameter shapes, the eight correctness/temporal rules (§5), the nine
  canonical worked examples (§7), and the corridor seed-data scope (§8).
- **Plan:** `docs/superpowers/plans/2026-07-01-fishing-regulations-data-model.md` — the task-by-task
  TDD implementation plan (schema → Zod validators → correctness helpers → resolver → seed + acceptance).
