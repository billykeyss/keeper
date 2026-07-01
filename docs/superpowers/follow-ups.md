# Follow-ups & Deferred Work

_As of 2026-07-01, after the data-model foundation branch (`feat/data-model`)._

The data-model foundation is complete and green (69 tests). This file records work
consciously deferred, so it isn't lost. See the spec (`specs/2026-07-01-fishing-regulations-data-model-design.md`)
and plan (`plans/2026-07-01-fishing-regulations-data-model.md`) for context.

## Deferred to the ingestion-pipeline phase (decided 2026-07-01)

The ingestion pipeline will be the **only writer**, so cross-row correctness is currently
enforced in the **application layer + the acceptance sweep** and will be hardened with
**database-level triggers** when that pipeline is built.

- [ ] **DB-level cross-row enforcement via `DEFERRABLE INITIALLY DEFERRED` constraint triggers.**
  - `published` + `is_binding` ⇒ ≥1 `regulation_source` with `role='primary'` whose `source`
    is `authority_level='primary_regulatory'` and `instrument_type` in the legal set; and
    `verbatim_text` present unless `rule_polarity='asserts_none'`. (Spec §5.4; app-layer:
    `src/validation/legalInstrument.ts`.)
  - `species_scope='listed'` ⇒ ≥1 `regulation_species` with `role='target'`. (Spec §5.5;
    app-layer: `src/validation/allSpecies.ts`.)
  - **Requires transactional writes** (a `regulation` + its satellites inserted atomically) so
    deferred triggers see the full row set at commit. The current seeds insert per-statement;
    the pipeline should wrap each rule in a transaction. `supersedeRegulation` is already
    transactional.
- [ ] **DB-level temporal overlap enforcement (§5.2).** Currently app-layer
  (`findOverlaps` + `findSupersessionGaps` in `src/validation/integrity.ts`). A Postgres
  `EXCLUSION` constraint is hard given M:N scope — needs a resolved scope/species key column
  or expression index. Evaluate when the resolver phase lands.

## Spec-deferred domains (spec §2 / §12) — later phases

- [ ] `license_product` (priced license/permit/stamp catalog, fee tiers, sales windows).
- [ ] `stocking_event` + `water_body.designations` (biology/metadata → water-metadata service).
- [ ] Computed/dynamic zone geometry (`ST_Buffer`-generated, feature-class buffers). v1 keeps
      only stored geometry + stored buffers.
- [ ] `reach` river-mile LRS `measure` fields.
- [ ] `scope_condition` predicate evaluator (kept human-readable in v1).

## Minor known limitations

- [ ] `date_spec` `nth` ordinal has no `n` field, so `resolveDateSpec` throws for it. Real
      seasons use `first`–`fourth`/`last`, which are supported. Add an `n` field if an
      arbitrary-nth season appears. (`src/resolver/dateSpec.ts`.)
- [ ] Season materialization is computed on-the-fly; no `season_instance` cache table yet
      (spec §11 open question #1). Add if "is it open on date X?" becomes a hot path.

## Next phases (spec §12) — each its own spec → plan → implementation

1. **Ingestion pipeline** — LLM-assisted extraction from official CDFW / NDOW / Pyramid Lake
   sources → `draft` rules with source quotes (also the home for the DB triggers above).
2. **Review workflow & tooling** — human verification UI/CLI (`draft → verified → published`).
3. **Read API** — waters / species / "regulations as-of-date" resolver endpoints.
4. **Scale-out** — extend beyond the Truckee–Tahoe–Reno corridor to all CA + NV waters.
5. **Consumer app** — the angler-facing client.
