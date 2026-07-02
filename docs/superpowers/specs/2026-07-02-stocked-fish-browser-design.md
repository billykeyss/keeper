# Stocked-fish browser — design

## Purpose

An easy way to see which fish are stocked across Keeper's waters and to search
waters by stocked species: a "Stocked fish" panel listing every species with
source-backed stocking records, and a map filter showing only the waters
stocked with a selected species.

## Scope decision

"Stocked" means **source-backed stocking records** — a water counts for a
species only if it has at least one `species_stocking_event` or
`species_stocking_schedule` row for it (61 waters at time of writing). Bare
`presence: "stocked"` species claims without dated events or a stated schedule
do NOT appear in this view; it stays receipt-backed like everything else in
Keeper.

## API

1. **`GET /api/stocking/species`** (new route file `src/api/stocking.ts`,
   mounted before the static block like the others):

   ```json
   { "species": [
     { "commonName": "Rainbow trout", "watersCount": 42,
       "eventCount": 96, "scheduleCount": 31, "lastStockedOn": "2026-05-24" }
   ] }
   ```

   One SQL query: union of event/schedule rows grouped by species common name,
   `watersCount` = distinct water bodies, `lastStockedOn` = max event date
   (null when a species has only schedules). Ordered by `watersCount` desc.

2. **`GET /api/waters?bbox=…&stocked=<speciesCommonName>`** — optional param
   on the existing endpoint. When present, water pins are restricted to waters
   having a stocking event or schedule row for that species (exact
   common-name match, case-insensitive); reach pins are restricted to those
   waters too. No param → behavior unchanged.

## Frontend

- **"Stocked fish" chip** next to the existing `.brand-chip` overlay (same
  fixed-overlay styling family, z-index 20).
- Clicking opens **`StockedFishPanel`** (new `web/src/StockedFishPanel.tsx`),
  a small ledger-styled floating panel (mobile: bottom sheet; desktop:
  anchored card) listing species from `/api/stocking/species` with
  waters/event counts and last-stocked date.
- Selecting a species sets a **map filter**: `App.tsx` holds
  `stockedFilter: string | null`, passed to `MapView`, which appends
  `&stocked=…` to its `/api/waters` fetches — only matching waters render.
  The panel shows the matching waters as a list (name, last stocked for that
  species); tapping one flies the map to it and opens its rules sheet (the
  existing Stocking section shows full detail).
- Active filter renders as a dismissible chip (species name + ×) so it's
  always visible/clearable even with the panel closed.
- New `web/src/api.ts` types + `fetchStockingSpecies()` helper mirroring the
  real response shape, per that file's convention.

## Out of scope

- Filtering by size/date-range of stockings; per-species map coloring;
  anything write-side. No DB schema changes at all.
