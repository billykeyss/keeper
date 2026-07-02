# Fish stocking data — design

## Purpose

Keeper currently records *whether* a species is present at a water
(`presence: native|stocked|introduced|historical` on `waterBodySpecies`) but not
*when* or *how much* is stocked. Agencies (NDOW angler guides, CDFW planting
reports/pages) often publish this — discrete logged events ("1,500 Channel
Catfish, 05-29-2025") and, less often, a stated recurring pattern ("trout
stocked weekly, April–September"). This adds both as first-class, sourced data,
surfaced in the existing rules sheet.

## Scope

All 374 currently-ingested waters (corridor + California + Nevada). Oregon is
out of scope until that state's water data itself is researched.

## Data shape

Two independent, both-optional-per-water concepts:

- **Stocking event** — a discrete, dated plant: species, quantity, size note
  (freeform, e.g. "9.5 in" or "12–15 in"), date, source.
- **Stocking schedule** — a recurring pattern, only when the source explicitly
  states one: species, frequency (`weekly|biweekly|monthly|seasonal|annual|as_available`),
  season window (start/end month, optional), freeform note, source.

Neither is required; most waters will have zero, some one, a few both. No
fabricated data — same rigor as `regulations[]`: every event/schedule entry
must cite a `sourceKeys.primary` that resolves to a real, specific, working
source URL, and the extracted values must be verifiably present in that source
(same adversarial-verify pattern used for the CA/NV regulation research passes).

## Schema (data files)

New top-level arrays in the per-water JSON files, sibling to `regulations`:

```ts
stockingEvents: [{
  speciesCommonName: string,       // must match an entry in species[] or get added there
  quantity: number | null,
  sizeNote: string | null,
  date: "YYYY-MM-DD",
  sourceKeys: { primary: key, corroborating: key[] },
}]

stockingSchedule: [{
  speciesCommonName: string,
  frequency: "weekly" | "biweekly" | "monthly" | "seasonal" | "annual" | "as_available",
  seasonStartMonth: number | null,  // 1-12
  seasonEndMonth: number | null,
  note: string,
  sourceKeys: { primary: key, corroborating: key[] },
}]
```

Validated in `src/ingest/datasetSchema.ts` (Zod), same file/pattern as the
existing `regulationRow` etc. `speciesCommonName` is cross-checked against the
file's own `species[]` array at ingest time (same guard as
`speciesTargets` on regulations already has via `load.ts`'s
`speciesIdByCommonName` map) — if a stocking entry names a species not listed
in `species[]`, ingest fails loudly rather than silently dropping it.

## Schema (database)

Two new tables, following the exact pattern of `waterBodySpecies`:

```ts
export const speciesStockingEvent = pgTable("species_stocking_event", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").notNull().references(() => waterBody.id),
  speciesId: integer("species_id").notNull().references(() => species.id),
  quantity: integer("quantity"),
  sizeNote: text("size_note"),
  stockedOn: date("stocked_on").notNull(),
  sourceId: integer("source_id").notNull().references(() => source.id),
  ...stamps,
});

export const speciesStockingSchedule = pgTable("species_stocking_schedule", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").notNull().references(() => waterBody.id),
  speciesId: integer("species_id").notNull().references(() => species.id),
  frequency: stockingFrequencyEnum("frequency").notNull(),
  seasonStartMonth: integer("season_start_month"),
  seasonEndMonth: integer("season_end_month"),
  note: text("note"),
  sourceId: integer("source_id").notNull().references(() => source.id),
  ...stamps,
});
```

New enum `stockingFrequencyEnum` in `src/db/enums.ts`
(`weekly|biweekly|monthly|seasonal|annual|as_available`). Both tables added to
`TRUNCATE_TABLES` in `load.ts` (wipe-and-reload semantics, matching every
other domain table). Migration generated via `npm run db:generate` — no
hand-written SQL.

## Ingest

`load.ts` gains two straightforward insert loops after the existing
`waterBodySpecies` loop: resolve `speciesCommonName` → `speciesId` (reusing
the existing `speciesIdByCommonName` map built during the species loop — throw
if not found, same as every other cross-reference in this file), resolve
`sourceKeys.primary` → `sourceId` (reusing `sourceIdByKey`, same throw-if-
missing pattern), insert. Corroborating source keys are validated for
existence but not persisted (matching how `regulation_source` currently
persists corroborating rows — for v1 of stocking, only the primary source is
stored per row, since neither table has a role-typed junction; extend later
if corroborating provenance is wanted).

## API

Extend the existing `GET /api/waters/:id/rules` handler
(`src/api/rules.ts`) — no new endpoint, no extra round-trip, matching how
`species`/`licenses`/`reciprocity` are already bundled into one response.
Add a `stocking: { events: StockingEventRow[], schedule: StockingScheduleRow[] }`
field, queried the same way `speciesRows` already is (a plain select joined
to `species` for the common name, ordered by date descending for events).

```ts
interface StockingEventRow {
  species: string;
  quantity: number | null;
  sizeNote: string | null;
  date: string;
  sourceUrl: string | null;
}
interface StockingScheduleRow {
  species: string;
  frequency: string;
  seasonStartMonth: number | null;
  seasonEndMonth: number | null;
  note: string;
  sourceUrl: string | null;
}
```

## Frontend

New `StockingSection` component (new file `web/src/StockingSection.tsx`,
following `RuleCard.tsx`'s conventions), rendered in `RulesBody`
(`RulesSheet.tsx`) immediately after the "Species present" section — it's
the natural adjacent read. Renders only when `stocking.events.length ||
stocking.schedule.length` is nonzero (no empty-state clutter, matching how
"License reciprocity" already only renders conditionally).

Layout: schedule entries first (if any) as compact rows — species, frequency,
season window, note; then a chronological list of recent events — species,
quantity, size, date — newest first, each with its own `Source` link (reusing
the existing `rule-source`/`rule-link` CSS classes, not new ones, to stay
visually consistent with the rest of the sheet).

`web/src/api.ts` gains `StockingEventRow`/`StockingScheduleRow` types and
extends `RulesResponse` with the `stocking` field, mirroring the API shape
exactly (this file's existing header comment already states its job: "mirror
the REAL response shapes emitted by the handlers").

## Data population (the large step)

Same discover → research → verify pipeline used for the CA/NV regulation
expansion, scoped to stocking data specifically, run per state group
(corridor+CA together since they share `data/corridor` + `data/california`,
then NV):

1. **Research**: for each water, search for a stocking-specific source (CDFW's
   fish planting schedule pages, NDOW angler guides/waters pages — both agency
   types were already seen carrying real dated stocking figures during the NV
   research pass). Extract real events/schedule only from what's actually on
   the page; write to the water's existing JSON file (new arrays, existing
   file — not new files).
2. **Verify**: adversarial per-file check — every event/schedule's quantity,
   date, and species must be traceable to the cited source's actual text (same
   fabrication check that caught the CA "ateelhead" typo and the invented
   quotes earlier); flag anything not verifiable.
3. **Fix-up**: apply verified corrections directly, same as the CA/NV fix-up
   passes already done in this session.
4. Waters with no stocking source found get neither array (empty is a valid,
   honest outcome — not every water is stocked, and not every stocked water
   has a public schedule).

## Testing

- Zod schema tests for `stockingEvents`/`stockingSchedule` (valid case,
  rejects unknown species, rejects malformed date), mirroring
  `tests/ingest/datasetSchema.test.ts`'s existing style.
- `load.ts` ingest test: a fixture water with one event + one schedule entry,
  assert both land in their tables with correct FKs — mirroring
  `tests/ingest/load.test.ts`.
- API test: `GET /api/waters/:id/rules` returns a populated `stocking` field
  for a fixture water with stocking data, and `{events: [], schedule: []}`
  for one without — mirroring `tests/api/waters.test.ts`'s fixture style.
- No new frontend test infra exists in this repo (no component tests found
  for `RuleCard`/`RulesSheet` today) — `StockingSection` follows that existing
  precedent (manual/visual verification via the `run`/Playwright pattern
  already used throughout this session, not a new test framework).

## Out of scope (explicitly)

- Oregon (no water data yet).
- Corroborating-source persistence for stocking rows (only primary is stored
  in v1).
- Any UI beyond the rules-sheet section (no map-level "stocked recently" pin
  styling, no separate stocking-only view).
- Automated/live stocking-feed ingestion (e.g. polling CDFW's API on a
  schedule) — this is a one-time research-and-populate pass, refreshed the
  same manual way `npm run ingest:corridor` already refreshes everything else.
