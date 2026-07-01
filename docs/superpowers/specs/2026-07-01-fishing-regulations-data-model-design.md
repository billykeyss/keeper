# Fishing Regulations Data Model — Design Spec (v1)

**Status:** Draft for review
**Date:** 2026-07-01
**Scope of this spec:** The *data model* only — the schema, enums, JSONB parameter
shapes, correctness/temporal rules, and seed-data scope. The ingestion pipeline,
review workflow, read API, and consumer app each get their own spec in later phases.

---

## 1. Overview & goals

Build the source-of-truth **data platform** for freshwater sport-fishing species and
regulations across California and Nevada. The platform must let an application answer,
for a given water and date, questions like: *Is it open? What can I keep? How many? What
size? Barbless? Do I need a special permit?* — with every answer traceable to an
authoritative source and reconstructable as-of any past date.

Because the app effectively tells people **what is legal**, the model optimizes for:

1. **Accuracy & provenance** — every rule cites an authoritative source with an as-of date.
2. **Legal defensibility** — a published, binding rule must rest on an actual legal
   instrument (CCR Title 14 / NAC 503 / tribal ordinance), not a summary booklet.
3. **Temporal reconstruction** — "what did this rule say on date X" is reliably answerable.
4. **Verified absences** — "there is no size limit here" is a stored fact, not a gap.
5. **Most-specific-wins resolution** — statewide defaults, zone/district rules, water rules,
   and reach rules coexist and resolve deterministically.

### Decisions locked in brainstorming
- **Storage:** Database-first, PostgreSQL + PostGIS.
- **Stack:** TypeScript full-stack (Node LTS + Drizzle ORM + drizzle-kit migrations + Zod for
  JSONB parameter validation; PostGIS via Drizzle custom `geometry` column types + raw SQL for
  spatial ops; Anthropic TypeScript SDK for LLM-assisted extraction; Vitest for tests).
- **Sourcing:** LLM-assisted extraction from official CDFW / NDOW / Pyramid Lake Paiute Tribe
  sources, then human review before a rule is marked `verified`/`published`.
- **v1 vertical slice:** the **Truckee–Tahoe–Reno corridor** (water list in §8).
- **v1 breadth:** "Fuller v1" — includes flow/quota closure triggers, AIS/mussel gates, and
  report-card/tag obligations. Licensing = requirements + reciprocity only (priced
  `license_product` catalog deferred).

---

## 2. Scope

### In scope (v1)
- Full relational schema (Postgres/PostGIS) with Alembic migrations.
- All entities, enums, and per-`rule_type` JSONB parameter shapes below.
- Correctness machinery: temporal versioning of rules **and their satellites**, integrity
  guards, legal-instrument enforcement, explicit all-species sentinel, per-authority year
  definitions, staleness tracking, dynamic-closure safety flag.
- Human-verified seed data for the corridor waters (§8).

### Out of scope (v1 — deferred to later specs)
- Ingestion pipeline internals, review UI, read API, consumer app (separate specs).
- `license_product` priced catalog / fee tiers / sales windows (commerce concern).
- `stocking_event` counts and `water_body.designations` biology metadata (water-metadata service).
- Computed/dynamic zone geometry (`ST_Buffer`-generated polygons, feature-class buffers) —
  v1 keeps only *stored* geometry and *stored* buffers.
- River-mile linear-referencing (LRS) measures on reaches.
- A predicate evaluator for `scope_condition` (kept human-readable + manually attached).

---

## 3. Design principles

- **Atomic, typed rules bundled by provision.** A single published provision (e.g. "all year,
  artificial barbless, 0 trout") decomposes into several typed `regulation` rows
  (`season` + `gear_method` + `bag`) sharing one `regulation_group`. Each row stays
  independently queryable; the group preserves "issued together, cite together."
- **Polymorphic scope & species via join tables**, supporting multi-target rules and
  include/exclude carve-outs (e.g. "this water *minus* a 300ft buffer"; "all species *except*
  trout and cui-ui").
- **Absence is data.** `rule_polarity = asserts_none` records a *verified* "no rule of this type."
- **JSONB `parameters`, validated per `rule_type` by a Zod schema.** Structured enough to
  query hot fields, flexible enough for compound/nested cases.
- **Never hard-delete a rule.** Supersession is temporal versioning.

---

## 4. Entities & fields

Legend: `PK` primary key, `FK` foreign key, `?` nullable. All tables get `created_at`,
`updated_at timestamptz`. Geometry is `SRID 4326`.

### 4.1 Geography & jurisdiction

**`authority`** — an entity that issues/enforces rules or licenses.
| field | type | notes |
|---|---|---|
| id | int PK | |
| name | text | e.g. CDFW, NDOW, Pyramid Lake Paiute Tribe |
| state | text? | NULL for federal/tribal/NGO |
| type | enum `authority_type` | |
| territory | geometry(MultiPolygon)? | reservation/preserve boundary — **descriptive metadata in v1** (resolution not dependent on it) |
| regulation_year_start | text? | e.g. `03-01` (CA) — anchors season resolution |
| license_year_basis | enum `license_year_basis`? | fixed_calendar / rolling_12mo / regulation_year |

**`water_body`** — a named lake/reservoir/river/stream/creek/pond/marina.
| field | type | notes |
|---|---|---|
| id | int PK | |
| name | text | |
| water_type | enum `water_type` | |
| gnis_id | text? | USGS canonical identity; **joins use this, never name** |
| states | text[] | e.g. `{CA,NV}` for Tahoe |
| counties | text[] | regs published per-county; disambiguates "Nevada County, CA" vs the state |
| geom | geometry | point or polygon |
| aliases | text[] | e.g. "Martis Lake" |
| regulatory_label | text? | label the governing regulatory polygon uses when it differs from `name` |
| governing_zone_id | int FK zone? | spatial-join resolution of which polygon governs this water |
| management_category | enum `mgmt_category`? | drives special default limits (e.g. community fishing pond) |
| verify_current | bool default false | **true = status is dynamic** (flow/quota managed); app must not assert "open" without a live check |

**`water_body_relation`** — directed hydrologic links (replaces free-text `parent_system`).
| field | type | notes |
|---|---|---|
| id | int PK | |
| from_water_body_id | int FK water_body | |
| to_water_body_id | int FK water_body | |
| relation | enum `hydro_relation` | `outlet` \| `tributary_of` (trimmed set) |

**`water_body_authority`** — overlapping/co-management authorities with roles; supports the
negative fact "this authority has NO jurisdiction here."
| field | type | notes |
|---|---|---|
| id | int PK | |
| water_body_id | int FK water_body | |
| authority_id | int FK authority | |
| role | enum `wba_role` | `none` = affirmative "no jurisdiction" |
| jurisdiction_note | text? | |

**`reach`** — a regulated segment of a river/stream.
| field | type | notes |
|---|---|---|
| id | int PK | |
| water_body_id | int FK water_body | resolve via `gnis_id`, never name; may point at a tributary, not the researched lake |
| name | text? | |
| from_desc / to_desc | text | human description of termini |
| from_anchor_feature / to_anchor_feature | text? | e.g. "Derby Dam", "Lake Tahoe outlet dam" |
| from_offset_ft / to_offset_ft | numeric? | distance from anchor |
| from_direction / to_direction | enum `flow_dir`? | upstream/downstream |
| geom | geometry(MultiLineString)? | nullable by design; supports disjoint spans around a closure |
| county | text? | |
| authority_id | int FK authority? | terminus can be a jurisdiction handoff (CA/NV state line) |

> LRS river-mile `measure` fields are **cut** from v1 (no LRS network available).

**`zone`** — flexible spatial/administrative target: districts, regions, counties,
tributary groups, closed areas, swim/dive areas, jurisdiction areas, and **stored** buffers.
| field | type | notes |
|---|---|---|
| id | int PK | |
| name | text | |
| kind | enum `zone_kind` | |
| geom | geometry? | stored polygon; NULL when marker-defined |
| water_body_id | int FK water_body? | |
| authority_id | int FK authority? | |
| anchor_feature_ref | text? | e.g. "mouths of all tributaries", "Sand Harbor boat ramp" |
| anchor_water_body_id | int FK water_body? | |
| buffer_distance | numeric? | **stored** buffer radius |
| buffer_unit | enum `dist_unit`? | |
| marker_defined | bool default false | boundary set by signs/buoys, no surveyed polygon |
| counties | text[]? | |
| description | text? | |

> Dynamic/computed/feature-class buffer machinery (`generated`, `dynamic`, `feature_class`)
> is **cut** from v1 — reinstated when we ingest official feature geometries.

### 4.2 Species

**`species`** — a fish species.
| field | type | notes |
|---|---|---|
| id | int PK | |
| common_name | text | |
| scientific_name | text? | |
| category | enum `species_category` | enables category-level targeting |
| native_status | enum `native_status` | |
| parent_species_ids | int[]? | hybrid parentage (Tiger Trout = brown × brook) |

**`species_alias`** — `id`, `species_id FK`, `name`.

**`species_group`** — a named regulatory aggregate ("trout", "game fish", "black bass",
"warmwater game fish"). **Authority-scoped**, because definitions differ by jurisdiction
(CA "trout" includes char/mackinaw; NV "game fish" excludes non-game).
| field | type | notes |
|---|---|---|
| id | int PK | |
| name | text | |
| category | enum `species_category`? | when the group == a taxonomic category |
| authority_id | int FK authority? | NULL = universal/taxonomic |
| description | text? | |

**`species_group_member`** — `group_id FK`, `species_id FK`.

**`water_body_species`** — presence of a species in a water.
| field | type | notes |
|---|---|---|
| water_body_id | int FK water_body | |
| species_id | int FK species | |
| presence | enum `presence` | native/stocked/introduced/historical |
| source_id | int FK source? | |

> Structured stocking counts (`stocking_event`) are **deferred** to a water-metadata service.

### 4.3 Regulations (core)

**`regulation`** — the atomic rule: exactly ONE `rule_type` + one validated `parameters` blob.
Scope, species, and sources are externalized to join tables (§4.3 below).

| field | type | notes |
|---|---|---|
| id | int PK | |
| rule_type | enum `rule_type` | |
| parameters | jsonb | validated by the per-`rule_type` Zod schema (§6) |
| regulation_group_id | int FK regulation_group? | co-issued rows from one provision |
| season_period_id | int FK season_period? | bag/gear/size rows point here to inherit a shared window |
| authority_id | int FK authority | publishing/enforcing authority |
| origin_authority_id | int FK authority? | originating authority when different (federal ESA rule re-published by a tribe) |
| required_permit_authority_id | int FK authority? | issuer of a required permit when ≠ authority_id |
| rule_polarity | enum `rule_polarity` default `applies` | `asserts_none` = verified "no rule of this type" |
| basis | enum `basis` default `explicit` | explicit / statewide_default / inherited |
| precedence | int default 0 | spatial specificity for most-specific-wins (reach > zone > water_body > region/district > statewide) |
| species_scope | enum `species_scope` default `listed` | **`all` is explicit** — never inferred from a missing target row |
| applies_to_class | enum `angler_class` default `any` | |
| applies_min_age / applies_max_age | int? | |
| jurisdiction_state | text? | constrains a water-scoped rule to one state's portion of an interstate water (CA/NV) |
| scope_condition | text? | rare predicate-scoped provision (human-readable; no evaluator in v1) |
| is_binding | bool default true | false = advisory/voluntary guidance |
| confidence | enum `confidence` default `high` | epistemic confidence, orthogonal to `status` |
| citation | text? | per-row clause ref, e.g. `7.50(b)(154)(C)` |
| human_summary | text | plain-English one-liner |
| verbatim_text | text? | exact regulatory language (required for published binding rules; see §5) |
| is_paraphrase | bool default false | |
| status | enum `status` default `draft` | |
| reviewer | text? | |
| reviewed_at | timestamptz? | |
| last_verified_at | date? | **last confirmed still-in-effect** (staleness) |
| valid_from / valid_to | date? | statutory versioning window |
| supersedes_id | int FK regulation? | temporal versioning only; never hard-delete |

**`regulation_group`** — one published provision/listing owning many atomic typed rows.
`id`, `authority_id FK`, `citation?`, `verbatim_text?`, `human_summary?`, `note?`.

**`regulation_species`** — polymorphic "who it applies to."
| field | type | notes |
|---|---|---|
| id | int PK | |
| regulation_id | int FK regulation | |
| species_id | int FK species? | |
| species_group_id | int FK species_group? | |
| role | enum `species_role` default `target` | target / bait / prohibited |
| mode | enum `species_mode` default `include` | include / exclude (carve-out) |

> **All-species convention:** a rule that applies to every species sets
> `regulation.species_scope = all`. It is **never** inferred from "no target row." A `listed`
> rule with zero `role=target` rows is invalid (data-entry error), enforced by check.

**`regulation_target`** — many-to-many scope; resolved scope = union(includes) − union(excludes).
| field | type | notes |
|---|---|---|
| id | int PK | |
| regulation_id | int FK regulation | |
| target_type | enum `target_type` | water_body / reach / zone / statewide / authority_territory |
| target_id | int? | FK into the table named by `target_type`; NULL for statewide |
| mode | enum `target_mode` default `include` | include / exclude |

> `authority_territory` scope is v1-**enumerated** (list the tribal lake + lower river + named
> tributaries explicitly) rather than resolved live from `authority.territory` geometry.

**`regulation_source`** — many-to-many citations. Constraint: **≥1 `role=primary`** per regulation.
| field | type | notes |
|---|---|---|
| id | int PK | |
| regulation_id | int FK regulation | |
| source_id | int FK source | |
| role | enum `source_role` | primary / corroborating / spatial / text / verification / superseded |
| section_ref | text? | |

**`season_period`** — a single-source-of-truth dated window that multiple rules reference.
**Versioned** (must-fix).
| field | type | notes |
|---|---|---|
| id | int PK | |
| regulation_group_id | int FK regulation_group? | |
| label | text | e.g. `take_season`, `winter_cr` |
| status | enum `period_status` | open / closed / open_catch_release |
| start_spec | jsonb | `date_spec` (§6 shared types) |
| end_spec | jsonb | `date_spec`; resolver materializes concrete dates per license/regulation year |
| valid_from / valid_to | date? | temporal versioning |
| supersedes_id | int FK season_period? | |

**`source`** — a provenance document.
| field | type | notes |
|---|---|---|
| id | int PK | |
| authority_id | int FK authority? | |
| document_type | enum `document_type` | webpage/pdf/booklet/gis/api |
| instrument_type | enum `instrument_type`? | legal instrument vs explanatory source |
| authority_level | enum `authority_level` | primary_regulatory / agency_mirror / third_party |
| is_official | bool default true | |
| mirror_of_id | int FK source? | this is a mirror/reproduction of an authoritative source |
| fetch_status | enum `fetch_status`? | ok / failed_binary / failed_404 / manual |
| url / title | text? | |
| published_date / retrieved_date | date? | |
| section_ref | text? | |
| quoted_text | text? | |
| disputed | bool default false | |
| refutation_note | text? | e.g. why an erroneous "14-inch minimum" claim was rejected |

**`license_reciprocity`** — per-water license relationship between two authorities; models
POSITIVE (Tahoe honors CA/NV) and NEGATIVE (Donner does not) facts, and tribal substitution.
| field | type | notes |
|---|---|---|
| id | int PK | |
| water_body_id | int FK water_body? | |
| zone_id | int FK zone? | |
| honoring_authority_id | int FK authority | whose water/jurisdiction |
| honored_authority_id | int FK authority? | |
| honored_state | text? | |
| honored | bool | false = explicitly NOT honored |
| replaces_state_license | bool default false | tribal permit replaces/voids the state license |
| condition | jsonb? | e.g. `{nv_trout_stamp_required: true}` |
| source_id | int FK source? | |

### 4.4 Cross-cutting

**`audit_log`** — row-level change log via trigger.
`id`, `table_name`, `row_id`, `action enum audit_action`, `actor`, `at timestamptz default now()`, `diff jsonb`.

---

## 5. Correctness & integrity rules

These are the eight must-fixes from the adversarial review, folded into the schema:

1. **Point-in-time reconstruction (satellite versioning).** Versioning lives not only on
   `regulation` but on its satellites. Convention: **clone-on-supersede** — creating a new
   `regulation` version re-creates its `regulation_target`, `regulation_species`,
   `regulation_source`, and (if edited) `season_period` rows, linked to the new version.
   Satellites are treated as immutable per version. "What did this rule say on date X" joins
   only the version and satellites whose `[valid_from, valid_to]` contains X. `season_period`
   is explicitly versioned.
2. **Temporal integrity guard.** A DB exclusion constraint (+ pipeline validation) prevents two
   `status=published` rules of the same `rule_type` with overlapping resolved scope, overlapping
   species, and overlapping validity from coexisting without a deterministic tie-break. A
   coverage check flags gaps/overlaps in supersession chains so a rule can't silently vanish or double.
3. **Annual/season harvest limits.** `bag.parameters` carries `annual` + `reset_basis`
   (calendar_year / license_year / regulation_year / season) in addition to daily/possession.
4. **Legal-instrument enforcement.** Constraint: `status=published AND is_binding=true` ⇒
   (≥1 `regulation_source role=primary` whose `source.authority_level=primary_regulatory` and
   `source.instrument_type ∈ {commission_reg, admin_code, statute, tribal_ordinance,
   emergency_order, directors_order}`) **AND** `verbatim_text IS NOT NULL` unless
   `rule_polarity=asserts_none`. (Prevents shipping the summary booklet as law.)
5. **Explicit all-species sentinel.** `regulation.species_scope ∈ {all, listed}`; "all species"
   is never inferred from a missing target row (see §4.3).
6. **License-year vs regulation-year.** `authority.regulation_year_start` +
   `authority.license_year_basis` define which year anchors `season_period` materialization;
   regression tests cover the rollover boundary.
7. **Dynamic-closure safety.** `water_body.verify_current = true` marks flow/quota-managed
   waters; the resolver must never assert "open" for such a water without a live check. Structured
   triggers live in `closure.parameters` (§6).
8. **Staleness.** `regulation.last_verified_at` + a max-age re-verification policy distinguish a
   rule confirmed current from one merely ingested against an old source.

---

## 6. Enums & per-`rule_type` parameter shapes

### 6.1 Enums

```
authority_type   : state_agency | tribal | federal | land_trust | ngo | private_landowner
water_type       : lake | reservoir | river | stream | creek | pond | marina | impoundment
hydro_relation   : outlet | tributary_of
wba_role         : take_rules | access | land_management | permit_issuer | none
flow_dir         : upstream | downstream
dist_unit        : ft | yd | m
zone_kind        : district | region | county | tributary_group | closed_area | swim_area | jurisdiction | named_area | buffer
species_category : trout | char | salmon | bass | warmwater | panfish | catfish | sucker | minnow | sculpin | hybrid | other
native_status    : native | introduced | stocked | stocked_hybrid
presence         : native | stocked | introduced | historical
mgmt_category    : community_fishing_pond | trophy_water | general
document_type    : webpage | pdf | booklet | gis | api
instrument_type  : commission_reg | admin_code | statute | booklet | guide | webpage | gis | tribal_ordinance | emergency_order | directors_order | hotline
authority_level  : primary_regulatory | agency_mirror | third_party
fetch_status     : ok | failed_binary | failed_404 | manual
rule_type        : season | bag | size_limit | gear_method | fishing_hours | closure | handling | vessel | ais | documentation | license | definition | special
rule_polarity    : applies | asserts_none | excludes
basis            : explicit | statewide_default | inherited
angler_class     : any | tribal_member | non_tribal | spouse_of_member | minor | senior | disabled | resident | nonresident | active_military | youth
confidence       : low | medium | high
status           : draft | needs_review | verified | published | proposed | superseded | rejected
species_role     : target | bait | prohibited
species_mode     : include | exclude
species_scope    : all | listed
target_type      : water_body | reach | zone | statewide | authority_territory
target_mode      : include | exclude
source_role      : primary | corroborating | spatial | text | verification | superseded
period_status    : open | closed | open_catch_release
reset_basis      : calendar_year | license_year | regulation_year | season
sublimit_mode    : additive | carve_out
license_year_basis : fixed_calendar | rolling_12mo | regulation_year
audit_action     : insert | update | delete
```

### 6.2 Shared JSONB types

```
date_spec = {
  type: fixed | relative | astronomical | year_round,
  # fixed:        month, day
  # relative:     ordinal(first|second|third|fourth|last|nth), weekday(mon..sun),
  #               month, relation(on|preceding|following), offset_days, anchor_holiday
  # astronomical: anchor(sunrise|sunset), offset_minutes
  verbatim: str
}
time_spec = { anchor: sunrise|sunset|clock, offset_minutes?, clock_time?: "HH:MM", verbatim: str }
```

### 6.3 `rule_type` parameter shapes (validated by Zod)

- **`season`** — `{ periods: [{ label, status, start: date_spec, end: date_spec }], note? }`.
  When other rules reference a window, create a `season_period` row and set
  `regulation.season_period_id` instead of re-embedding dates.
- **`bag`** — merges daily+possession+annual:
  `{ daily: int?, possession: int?, annual: int?, reset_basis?, possession_multiplier?,
  unit="fish", aggregation: combined_group|per_species|combined_all,
  relationship?: independent|cumulative|shared_aggregate,
  catch_and_release?: bool (true = 0 harvest, fishing allowed),
  counts_toward_statewide_aggregate?: bool,
  sub_limits?: [{ target:{species|species_group}, mode: additive|carve_out, max_daily?, max_possession?,
  min_length_in?, max_length_in?, note? }],
  allowed_combinations?: [str], possession_condition?, counting_rule? }`.
- **`size_limit`** — `{ min_length_in?, max_length_in?, protected_slot?:{min_in,max_in},
  measurement: total_length|fork_length|girth, unit: inch|cm,
  over_slot_retention?:{max_daily, min_in?}, note? }`. "No size limit" = `asserts_none` + all-null.
- **`gear_method`** — merges gear+method:
  `{ bait_allowed, artificial_only, flies_only, lures_allowed, barbless_required,
  single_hook_required, max_hooks?, max_hook_gap_in?, max_droppers?, max_leader_len_in?,
  max_rods?, max_lines?, chumming_allowed?, snagging_allowed?, downriggers_allowed?,
  prohibited_methods?:[str], requires_permit_note?, evidentiary_note?, note? }`.
  (A second-rod stamp requirement is a `requires_permit_note` string in v1, not an FK — the
  priced `license_product` catalog is deferred.)
- **`fishing_hours`** — `{ basis: any_hour|sunrise_sunset|park_hours|custom,
  allowed_from: time_spec, allowed_to: time_spec, note? }`. A nightly window is ALWAYS
  `fishing_hours`, never `closure`, for cross-state comparability.
- **`closure`** — full no-fishing (spatial and/or seasonal, incl. dynamic):
  `{ closure_kind: seasonal|spatial|emergency|year_round|flow_triggered|quota_triggered,
  boundary_definition: geom|signs_buoys|radius|described,
  trigger?: { kind: flow|quota, gauge_station?, threshold_cfs?, comparison?: below|above,
  quota_count?, quota_area?, status_source_url?, hotline? }, note? }`. Geometry/anchor/buffer via
  `regulation_target → zone`; recurring window via `season_period_id`.
- **`handling`** — `{ must_release_unharmed?, keep_in_water?, filleting_prohibited?,
  live_transport_prohibited?, stringer_max?, stringers_per_person?,
  counts_toward_bag_when_retained?, condition?: str, note? }`.
- **`vessel`** — `{ gas_motor_allowed, electric_motor_allowed, non_motorized_allowed,
  float_tube_allowed?, paddleboard_allowed?, outside_boats_allowed?, hp_limit?, no_wake?, reason?, note? }`.
- **`ais`** (Fuller v1) — aquatic-invasive-species access gate:
  `{ inspection_required, decontamination_required, quarantine_days?, seal_or_sticker_required?,
  sticker_note?, drain_plug_out_required?, felt_soles_prohibited?, applies_to: motorized|all_watercraft,
  program_authority_id?, status_source_url?, note? }`.
- **`documentation`** (Fuller v1) — report-card / harvest-tag duties:
  `{ report_card_required?, card_name?, tag_required?, tag_affix_timing?: immediately|before_transport,
  record_before_moving?, return_required?, note? }`.
- **`license`** — requirement statement (products/reciprocity live in tables):
  `{ required, min_age?, under_min_age?: "no_license_required", issuing_authority_id?,
  replaces_state_license?, required_product_note?, reciprocity?:{applies, honored_authority_ids:[int], note},
  exemption?:{event, date: date_spec, other_regs_apply}, note? }`.
- **`definition`** — glossary/derivation meta-rule governing how OTHER rules compute:
  `{ term, applies_to_rule_types:[str], possession_multiplier?, counting_rules?:{includes,excludes},
  statewide_aggregate?: bool, text, note? }`. Scope usually statewide/authority_territory.
- **`special`** — **discouraged** escape hatch: `{ description, raw: object }`. Presence triggers review.

---

## 7. Canonical worked examples

These real corridor cases are the acceptance targets — the schema is "done" when each
round-trips cleanly. Full JSON rows are carried in the seed fixtures.

1. **Compound bag** — Topaz Lake: "25 warmwater game fish/day, ≤5 black bass" →
   `bag{ daily:25, aggregation:combined_group, sub_limits:[{target:black_bass, mode:carve_out, max_daily:5}] }`,
   target = NV-scoped `warmwater game fish` group via `regulation_species`.
2. **Relative two-period season** — Truckee River Reach C: take-season (last Sat Apr → Nov 15)
   + winter C&R (Nov 16 → Friday preceding last Sat Apr), stored as two `season_period` rows; the
   `2 trout` bag binds to the take window, the `0 trout` bag to the winter window — no date duplication.
3. **Slot limit** — Pyramid Lake Lahontan cutthroat: keep 17–20" and 24"+, protected slot 20–24",
   fork length, ≤1 over 24" → `size_limit{ min:17, protected_slot:{20,24}, over_slot_retention:{max_daily:1,min_in:24} }`.
4. **Reach-scoped closure** — Truckee River Reach A: closed all year for 1,000 ft below the Tahoe
   outlet dam → `reach` with anchor+offset terminus; `closure` targets the reach; Truckee-is-outlet-of-Tahoe
   captured in `water_body_relation`.
5. **Interstate reciprocity (positive + negative)** — Tahoe honors CA/NV licenses (NV side needs a
   trout stamp); Donner explicitly does not — two `license_reciprocity` rows, one `honored=true`, one `honored=false`.
6. **Tribal permit** — Pyramid Lake: tribal permit replaces the state license; scope is reservation-wide
   via `target_type=authority_territory` (enumerated); `applies_to_class=non_tribal`, `min_age=12`.
7. **Zero-limit C&R + gear stack** — Little Truckee (Stampede→Boca): one `regulation_group` = `season`(all year)
   + `bag`(0 trout, catch_and_release=true) + `gear_method`(artificial + barbless, single_hook_required=false).
8. **Verified absence** — NV Truckee River trout: `size_limit` with `rule_polarity=asserts_none`,
   all-null lengths, `is_paraphrase=true`, refuting a secondary "14-inch minimum" claim (source `disputed=true`).
9. **AIS gate** — Lake Tahoe: `ais{ inspection_required:true, decontamination_required:true,
   seal_or_sticker_required:true, drain_plug_out_required:true, applies_to:motorized }`.

---

## 8. Seed-data scope (the corridor)

Human-verified v1 waters: **Donner Lake** (CA), **Lake Tahoe** (CA/NV interstate),
**Truckee River — CA reaches**, **Truckee River — NV reaches (Reno/Sparks)**,
**Little Truckee River** (CA), **Martis Creek Lake** (CA), **Prosser Creek Reservoir** (CA),
**Boca Reservoir** (CA), **Stampede Reservoir** (CA), **Pyramid Lake** (NV — tribal),
**Sparks Marina** (NV), **Independence Lake** (CA). Each rule seeded at `status=verified` with a
`primary` legal-instrument source and verbatim text.

---

## 9. Ingestion & review (context only — separate spec)

LLM-assisted extraction pulls official sources → emits `draft` rules with a source quote →
human review promotes `draft → needs_review → verified → published`. The schema's `confidence`,
`status`, `disputed`, `fetch_status`, and the legal-instrument constraint (§5.4) are the guardrails
this pipeline writes against. Detailed design deferred.

---

## 10. Testing strategy

- **Schema round-trip tests:** each of the 9 canonical examples (§7) inserts, validates against its
  Zod parameter schema, and reads back identically.
- **Zod validators:** per-`rule_type` parameter schemas reject malformed blobs (wrong keys,
  bad enum values, negative limits).
- **Temporal reconstruction tests:** given a supersession chain, "as-of date X" returns the correct
  version + satellites; clone-on-supersede leaves prior versions unmutated.
- **Integrity-guard tests:** overlapping published rules of same type/scope/species/date are rejected;
  coverage gaps in a supersession chain are flagged.
- **Legal-instrument constraint tests:** a `published + binding` rule with only a `booklet` primary
  source, or with null `verbatim_text` (and not `asserts_none`), is rejected.
- **All-species sentinel tests:** a `listed` rule with no `role=target` row is rejected; `all` is honored.
- **Season resolver tests:** relative date-specs materialize to correct concrete dates for a given
  regulation year, including the license-year/regulation-year rollover boundary.

---

## 11. Open questions (to resolve during planning)

1. **Season resolution:** compute concrete dates on the fly via a resolver function (v1 recommendation),
   or materialize a `season_instance(season_period_id, year, start_date, end_date)` cache? Materializing
   simplifies "open on 2026-04-24?" but adds a yearly refresh job.
2. **Compound-bag "OR" composition** (Pyramid "one 17-20 AND one 24+, OR two 17-20"): are cap-based
   `sub_limits` sufficient for the resolver, or is `allowed_combinations` required to be populated?
3. **Cross-water personal aggregate** ("one daily limit per day across all waters"): modeled via a
   `definition` rule + `bag.counts_toward_statewide_aggregate` — confirm the resolver contract.
4. **Angler-class variance:** modeled as separate `regulation` rows per class (assumption) vs a
   class→variant child table.
5. **Authoritative geometry:** confirm we will ingest official boundary/feature geometries (BIA reservation
   polygons, CDFW polygons, tributary-mouth points) so `zone`/reach geometry targets resolve in PostGIS;
   until then those targets are descriptive + enumerated.

---

## 12. Future phases (each its own spec)

1. **Ingestion pipeline** — LLM-assisted extraction + source stitching.
2. **Review workflow & tooling** — the human verification UI/CLI.
3. **Read API** — waters / species / "regulations as-of-date" resolver endpoints.
4. **Scale-out** — extend beyond the corridor to all CA + NV waters.
5. **Consumer app** — the angler-facing client.
6. **Deferred data domains** — `license_product` catalog, `stocking_event`, computed/dynamic zones.
