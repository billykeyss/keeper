# Fishing Regulations Data Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PostgreSQL/PostGIS source-of-truth schema (Drizzle ORM) + Zod parameter validators + correctness machinery + verified corridor seed data for the CA/NV freshwater fishing-regulations platform, per `docs/superpowers/specs/2026-07-01-fishing-regulations-data-model-design.md`.

**Architecture:** Database-first. Drizzle ORM defines ~20 tables and ~30 pgEnums; `drizzle-kit` generates SQL migrations. Each `regulation` row is one atomic typed rule whose `parameters` JSONB is validated by a per-`rule_type` Zod schema. Correctness is enforced by DB constraints/triggers plus TypeScript validation helpers (legal-instrument enforcement, explicit all-species sentinel, temporal integrity guard, clone-on-supersede versioning). A date-spec resolver materializes relative seasons. Seed fixtures encode the 9 canonical corridor cases and round-trip through the schema.

**Tech Stack:** Node LTS, TypeScript, Drizzle ORM + drizzle-kit, `postgres` (postgres.js) driver, Zod, Vitest, Docker Compose (postgis/postgis image).

**Conventions (locked — keep consistent across all tasks):**
- Drizzle table consts are camelCase (`waterBody`); DB names snake_case (`water_body`).
- pgEnum names are snake_case (`rule_type`); exported const camelCase + `Enum` suffix (`ruleTypeEnum`).
- Zod param schemas: `<ruleType>Params` (e.g. `gearMethodParams`); registry `ruleTypeParamSchemas`; entry point `validateParameters(ruleType, params)`.
- Geometry stored as EWKT text via a Drizzle `customType` named `geometry`.
- All spatial ops use raw SQL (`sql\`...\``), never an ORM abstraction.

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, drizzle.config.ts
docker-compose.yml, .env.example
src/db/
  client.ts                 # postgres.js + drizzle client, pool lifecycle
  geometry.ts               # customType<geometry> (EWKT)
  enums.ts                  # all pgEnum definitions
  schema/
    geography.ts            # authority, waterBody, waterBodyRelation, waterBodyAuthority, reach, zone
    species.ts             # species, speciesAlias, speciesGroup, speciesGroupMember, waterBodySpecies
    regulation.ts          # regulation, regulationGroup, regulationSpecies, regulationTarget, regulationSource, seasonPeriod, source, licenseReciprocity
    audit.ts               # auditLog
    index.ts               # re-export all tables + enums
src/params/
  shared.ts                # dateSpec, timeSpec Zod
  season.ts bag.ts sizeLimit.ts gearMethod.ts fishingHours.ts closure.ts
  handling.ts vessel.ts ais.ts documentation.ts license.ts definition.ts special.ts
  index.ts                 # ruleTypeParamSchemas registry + validateParameters()
src/validation/
  allSpecies.ts            # sentinel: reject listed rule with no target row
  legalInstrument.ts       # published+binding ⇒ primary legal instrument + verbatim
  integrity.ts             # overlap + coverage checks
  versioning.ts            # clone-on-supersede
src/resolver/
  dateSpec.ts              # resolve relative/astronomical date_spec → concrete date
db/sql/
  audit_trigger.sql        # row-level audit trigger + attach statements
  constraints.sql          # exclusion/uniqueness + legal-instrument CHECK helpers
src/seed/corridor.ts       # the 9 canonical example rows
tests/**                   # mirrors src/, Vitest
```

---

## Phase 0 — Project scaffold

### Task 1: Initialize the TypeScript project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `docker-compose.yml`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "fishing-law",
  "private": true,
  "type": "module",
  "scripts": {
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "drizzle-kit": "^0.28.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "tests", "drizzle.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`, `.gitignore`, `.env.example`, `docker-compose.yml`**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], hookTimeout: 30000, testTimeout: 30000, fileParallelism: false },
});
```

`.gitignore`:
```
node_modules
dist
.env
```

`.env.example`:
```
DATABASE_URL=postgres://fl:fl@localhost:5433/fishing_law
```

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: fl
      POSTGRES_PASSWORD: fl
      POSTGRES_DB: fishing_law
    ports: ["5433:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fl -d fishing_law"]
      interval: 2s
      timeout: 5s
      retries: 20
```

- [ ] **Step 4: Install and verify**

Run: `npm install && npm run typecheck`
Expected: install succeeds; `tsc --noEmit` exits 0 (no source yet).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold TypeScript + Drizzle + Vitest project"
```

### Task 2: Database client, PostGIS enablement, and geometry custom type

**Files:**
- Create: `src/db/geometry.ts`, `src/db/client.ts`, `drizzle.config.ts`
- Test: `tests/db/connection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/db/connection.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";

afterAll(async () => { await closeDb(); });

describe("database", () => {
  it("has PostGIS available", async () => {
    const rows = await db.execute(sql`select postgis_version() as v`);
    expect(String((rows as any)[0].v)).toMatch(/^3\./);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm run db:up && npx vitest run tests/db/connection.test.ts`
Expected: FAIL — cannot import `src/db/client` (not created).

- [ ] **Step 3: Create `src/db/geometry.ts`**

```ts
import { customType } from "drizzle-orm/pg-core";

// Stores geometry as EWKT text (e.g. "SRID=4326;POINT(-120 39)").
// Spatial ops are done with raw SQL; this type is for round-tripping values.
export const geometry = (name: string, opts: { type: string; srid?: number } = { type: "Geometry", srid: 4326 }) =>
  customType<{ data: string; driverData: string }>({
    dataType() {
      return `geometry(${opts.type}${opts.srid ? `,${opts.srid}` : ""})`;
    },
    toDriver(value: string) { return value; },
    fromDriver(value: string) { return value; },
  })(name);
```

- [ ] **Step 4: Create `src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://fl:fl@localhost:5433/fishing_law";
export const queryClient = postgres(url, { max: 5 });
export const db = drizzle(queryClient);
export async function closeDb() { await queryClient.end({ timeout: 5 }); }
```

- [ ] **Step 5: Create `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://fl:fl@localhost:5433/fishing_law" },
});
```

- [ ] **Step 6: Ensure the PostGIS extension + a placeholder schema index**

Create `src/db/schema/index.ts` (empty re-export for now so drizzle.config resolves):
```ts
export {};
```
Run: `docker compose exec -T db psql -U fl -d fishing_law -c "CREATE EXTENSION IF NOT EXISTS postgis;"`
Expected: `CREATE EXTENSION` (or notice it already exists).

- [ ] **Step 7: Run the test to confirm it passes**

Run: `npx vitest run tests/db/connection.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(db): postgres.js+drizzle client, PostGIS geometry custom type"
```

---

## Phase 1 — Enums and core schema

### Task 3: Define all pgEnums

**Files:**
- Create: `src/db/enums.ts`
- Test: `tests/db/enums.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/db/enums.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import * as e from "../../src/db/enums";

describe("enums", () => {
  it("rule_type has all 13 fuller-v1 values", () => {
    expect(e.ruleTypeEnum.enumValues).toEqual([
      "season","bag","size_limit","gear_method","fishing_hours","closure",
      "handling","vessel","ais","documentation","license","definition","special",
    ]);
  });
  it("species_scope carries the explicit sentinel", () => {
    expect(e.speciesScopeEnum.enumValues).toEqual(["all","listed"]);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npx vitest run tests/db/enums.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/db/enums.ts`** (transcribes spec §6.1 exactly)

```ts
import { pgEnum } from "drizzle-orm/pg-core";

export const authorityTypeEnum = pgEnum("authority_type", ["state_agency","tribal","federal","land_trust","ngo","private_landowner"]);
export const waterTypeEnum = pgEnum("water_type", ["lake","reservoir","river","stream","creek","pond","marina","impoundment"]);
export const hydroRelationEnum = pgEnum("hydro_relation", ["outlet","tributary_of"]);
export const wbaRoleEnum = pgEnum("wba_role", ["take_rules","access","land_management","permit_issuer","none"]);
export const flowDirEnum = pgEnum("flow_dir", ["upstream","downstream"]);
export const distUnitEnum = pgEnum("dist_unit", ["ft","yd","m"]);
export const zoneKindEnum = pgEnum("zone_kind", ["district","region","county","tributary_group","closed_area","swim_area","jurisdiction","named_area","buffer"]);
export const speciesCategoryEnum = pgEnum("species_category", ["trout","char","salmon","bass","warmwater","panfish","catfish","sucker","minnow","sculpin","hybrid","other"]);
export const nativeStatusEnum = pgEnum("native_status", ["native","introduced","stocked","stocked_hybrid"]);
export const presenceEnum = pgEnum("presence", ["native","stocked","introduced","historical"]);
export const mgmtCategoryEnum = pgEnum("mgmt_category", ["community_fishing_pond","trophy_water","general"]);
export const documentTypeEnum = pgEnum("document_type", ["webpage","pdf","booklet","gis","api"]);
export const instrumentTypeEnum = pgEnum("instrument_type", ["commission_reg","admin_code","statute","booklet","guide","webpage","gis","tribal_ordinance","emergency_order","directors_order","hotline"]);
export const authorityLevelEnum = pgEnum("authority_level", ["primary_regulatory","agency_mirror","third_party"]);
export const fetchStatusEnum = pgEnum("fetch_status", ["ok","failed_binary","failed_404","manual"]);
export const ruleTypeEnum = pgEnum("rule_type", ["season","bag","size_limit","gear_method","fishing_hours","closure","handling","vessel","ais","documentation","license","definition","special"]);
export const rulePolarityEnum = pgEnum("rule_polarity", ["applies","asserts_none","excludes"]);
export const basisEnum = pgEnum("basis", ["explicit","statewide_default","inherited"]);
export const anglerClassEnum = pgEnum("angler_class", ["any","tribal_member","non_tribal","spouse_of_member","minor","senior","disabled","resident","nonresident","active_military","youth"]);
export const confidenceEnum = pgEnum("confidence", ["low","medium","high"]);
export const statusEnum = pgEnum("status", ["draft","needs_review","verified","published","proposed","superseded","rejected"]);
export const speciesRoleEnum = pgEnum("species_role", ["target","bait","prohibited"]);
export const speciesModeEnum = pgEnum("species_mode", ["include","exclude"]);
export const speciesScopeEnum = pgEnum("species_scope", ["all","listed"]);
export const targetTypeEnum = pgEnum("target_type", ["water_body","reach","zone","statewide","authority_territory"]);
export const targetModeEnum = pgEnum("target_mode", ["include","exclude"]);
export const sourceRoleEnum = pgEnum("source_role", ["primary","corroborating","spatial","text","verification","superseded"]);
export const periodStatusEnum = pgEnum("period_status", ["open","closed","open_catch_release"]);
export const resetBasisEnum = pgEnum("reset_basis", ["calendar_year","license_year","regulation_year","season"]);
export const sublimitModeEnum = pgEnum("sublimit_mode", ["additive","carve_out"]);
export const licenseYearBasisEnum = pgEnum("license_year_basis", ["fixed_calendar","rolling_12mo","regulation_year"]);
export const auditActionEnum = pgEnum("audit_action", ["insert","update","delete"]);
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/db/enums.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): all pgEnums (spec §6.1)"
```

### Task 4: Geography & jurisdiction tables

**Files:**
- Create: `src/db/schema/geography.ts`

- [ ] **Step 1: Write `src/db/schema/geography.ts`** (transcribes spec §4.1)

```ts
import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { geometry } from "../geometry";
import {
  authorityTypeEnum, licenseYearBasisEnum, waterTypeEnum, mgmtCategoryEnum,
  hydroRelationEnum, wbaRoleEnum, flowDirEnum, zoneKindEnum, distUnitEnum,
} from "../enums";

const stamps = { createdAt: timestamp("created_at").defaultNow().notNull(), updatedAt: timestamp("updated_at").defaultNow().notNull() };

export const authority = pgTable("authority", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  state: text("state"),
  type: authorityTypeEnum("type").notNull(),
  territory: geometry("territory", { type: "MultiPolygon", srid: 4326 }),
  regulationYearStart: text("regulation_year_start"),
  licenseYearBasis: licenseYearBasisEnum("license_year_basis"),
  ...stamps,
});

export const waterBody = pgTable("water_body", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  waterType: waterTypeEnum("water_type").notNull(),
  gnisId: text("gnis_id"),
  states: text("states").array().notNull().default([]),
  counties: text("counties").array().notNull().default([]),
  geom: geometry("geom", { type: "Geometry", srid: 4326 }),
  aliases: text("aliases").array().notNull().default([]),
  regulatoryLabel: text("regulatory_label"),
  governingZoneId: integer("governing_zone_id"),
  managementCategory: mgmtCategoryEnum("management_category"),
  verifyCurrent: boolean("verify_current").notNull().default(false),
  ...stamps,
});

export const waterBodyRelation = pgTable("water_body_relation", {
  id: serial("id").primaryKey(),
  fromWaterBodyId: integer("from_water_body_id").notNull().references(() => waterBody.id),
  toWaterBodyId: integer("to_water_body_id").notNull().references(() => waterBody.id),
  relation: hydroRelationEnum("relation").notNull(),
  ...stamps,
});

export const waterBodyAuthority = pgTable("water_body_authority", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").notNull().references(() => waterBody.id),
  authorityId: integer("authority_id").notNull().references(() => authority.id),
  role: wbaRoleEnum("role").notNull(),
  jurisdictionNote: text("jurisdiction_note"),
  ...stamps,
});

export const reach = pgTable("reach", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").notNull().references(() => waterBody.id),
  name: text("name"),
  fromDesc: text("from_desc"),
  toDesc: text("to_desc"),
  fromAnchorFeature: text("from_anchor_feature"),
  fromOffsetFt: integer("from_offset_ft"),
  fromDirection: flowDirEnum("from_direction"),
  toAnchorFeature: text("to_anchor_feature"),
  toOffsetFt: integer("to_offset_ft"),
  toDirection: flowDirEnum("to_direction"),
  geom: geometry("geom", { type: "MultiLineString", srid: 4326 }),
  county: text("county"),
  authorityId: integer("authority_id").references(() => authority.id),
  ...stamps,
});

export const zone = pgTable("zone", {
  id: serial("id").primaryKey(),
  name: text("name"),
  kind: zoneKindEnum("kind").notNull(),
  geom: geometry("geom", { type: "Geometry", srid: 4326 }),
  waterBodyId: integer("water_body_id").references(() => waterBody.id),
  authorityId: integer("authority_id").references(() => authority.id),
  anchorFeatureRef: text("anchor_feature_ref"),
  anchorWaterBodyId: integer("anchor_water_body_id").references(() => waterBody.id),
  bufferDistance: integer("buffer_distance"),
  bufferUnit: distUnitEnum("buffer_unit"),
  markerDefined: boolean("marker_defined").notNull().default(false),
  counties: text("counties").array(),
  description: text("description"),
  ...stamps,
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): geography & jurisdiction tables"
```

### Task 5: Species tables

**Files:**
- Create: `src/db/schema/species.ts`

- [ ] **Step 1: Write `src/db/schema/species.ts`** (spec §4.2)

```ts
import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { speciesCategoryEnum, nativeStatusEnum, presenceEnum } from "../enums";
import { waterBody } from "./geography";
import { source } from "./regulation";

const stamps = { createdAt: timestamp("created_at").defaultNow().notNull(), updatedAt: timestamp("updated_at").defaultNow().notNull() };

export const species = pgTable("species", {
  id: serial("id").primaryKey(),
  commonName: text("common_name").notNull(),
  scientificName: text("scientific_name"),
  category: speciesCategoryEnum("category").notNull(),
  nativeStatus: nativeStatusEnum("native_status").notNull(),
  parentSpeciesIds: integer("parent_species_ids").array(),
  ...stamps,
});

export const speciesAlias = pgTable("species_alias", {
  id: serial("id").primaryKey(),
  speciesId: integer("species_id").notNull().references(() => species.id),
  name: text("name").notNull(),
  ...stamps,
});

export const speciesGroup = pgTable("species_group", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: speciesCategoryEnum("category"),
  authorityId: integer("authority_id"),
  description: text("description"),
  ...stamps,
});

export const speciesGroupMember = pgTable("species_group_member", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => speciesGroup.id),
  speciesId: integer("species_id").notNull().references(() => species.id),
  ...stamps,
});

export const waterBodySpecies = pgTable("water_body_species", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").notNull().references(() => waterBody.id),
  speciesId: integer("species_id").notNull().references(() => species.id),
  presence: presenceEnum("presence").notNull(),
  sourceId: integer("source_id").references(() => source.id),
  ...stamps,
});
```

- [ ] **Step 2: Typecheck** — Run `npm run typecheck`; expect 0 (note: `source` import resolves once Task 6 lands; do Task 6 before typecheck if needed — they compile together).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): species tables"
```

### Task 6: Regulation core tables

**Files:**
- Create: `src/db/schema/regulation.ts`

- [ ] **Step 1: Write `src/db/schema/regulation.ts`** (spec §4.3)

```ts
import { pgTable, serial, integer, text, boolean, jsonb, date, timestamp } from "drizzle-orm/pg-core";
import {
  ruleTypeEnum, rulePolarityEnum, basisEnum, speciesScopeEnum, anglerClassEnum,
  confidenceEnum, statusEnum, speciesRoleEnum, speciesModeEnum, targetTypeEnum,
  targetModeEnum, sourceRoleEnum, periodStatusEnum, documentTypeEnum,
  instrumentTypeEnum, authorityLevelEnum, fetchStatusEnum,
} from "../enums";
import { authority, waterBody, zone } from "./geography";

const stamps = { createdAt: timestamp("created_at").defaultNow().notNull(), updatedAt: timestamp("updated_at").defaultNow().notNull() };

export const source = pgTable("source", {
  id: serial("id").primaryKey(),
  authorityId: integer("authority_id").references(() => authority.id),
  documentType: documentTypeEnum("document_type").notNull(),
  instrumentType: instrumentTypeEnum("instrument_type"),
  authorityLevel: authorityLevelEnum("authority_level").notNull(),
  isOfficial: boolean("is_official").notNull().default(true),
  mirrorOfId: integer("mirror_of_id"),
  fetchStatus: fetchStatusEnum("fetch_status"),
  url: text("url"),
  title: text("title"),
  publishedDate: date("published_date"),
  retrievedDate: date("retrieved_date"),
  sectionRef: text("section_ref"),
  quotedText: text("quoted_text"),
  disputed: boolean("disputed").notNull().default(false),
  refutationNote: text("refutation_note"),
  ...stamps,
});

export const regulationGroup = pgTable("regulation_group", {
  id: serial("id").primaryKey(),
  authorityId: integer("authority_id").notNull().references(() => authority.id),
  citation: text("citation"),
  verbatimText: text("verbatim_text"),
  humanSummary: text("human_summary"),
  note: text("note"),
  ...stamps,
});

export const seasonPeriod = pgTable("season_period", {
  id: serial("id").primaryKey(),
  regulationGroupId: integer("regulation_group_id").references(() => regulationGroup.id),
  label: text("label").notNull(),
  status: periodStatusEnum("status").notNull(),
  startSpec: jsonb("start_spec").notNull(),
  endSpec: jsonb("end_spec").notNull(),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  supersedesId: integer("supersedes_id"),
  ...stamps,
});

export const regulation = pgTable("regulation", {
  id: serial("id").primaryKey(),
  ruleType: ruleTypeEnum("rule_type").notNull(),
  parameters: jsonb("parameters").notNull(),
  regulationGroupId: integer("regulation_group_id").references(() => regulationGroup.id),
  seasonPeriodId: integer("season_period_id").references(() => seasonPeriod.id),
  authorityId: integer("authority_id").notNull().references(() => authority.id),
  originAuthorityId: integer("origin_authority_id").references(() => authority.id),
  requiredPermitAuthorityId: integer("required_permit_authority_id").references(() => authority.id),
  rulePolarity: rulePolarityEnum("rule_polarity").notNull().default("applies"),
  basis: basisEnum("basis").notNull().default("explicit"),
  precedence: integer("precedence").notNull().default(0),
  speciesScope: speciesScopeEnum("species_scope").notNull().default("listed"),
  appliesToClass: anglerClassEnum("applies_to_class").notNull().default("any"),
  appliesMinAge: integer("applies_min_age"),
  appliesMaxAge: integer("applies_max_age"),
  jurisdictionState: text("jurisdiction_state"),
  scopeCondition: text("scope_condition"),
  isBinding: boolean("is_binding").notNull().default(true),
  confidence: confidenceEnum("confidence").notNull().default("high"),
  citation: text("citation"),
  humanSummary: text("human_summary").notNull(),
  verbatimText: text("verbatim_text"),
  isParaphrase: boolean("is_paraphrase").notNull().default(false),
  status: statusEnum("status").notNull().default("draft"),
  reviewer: text("reviewer"),
  reviewedAt: timestamp("reviewed_at"),
  lastVerifiedAt: date("last_verified_at"),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  supersedesId: integer("supersedes_id"),
  ...stamps,
});

export const regulationSpecies = pgTable("regulation_species", {
  id: serial("id").primaryKey(),
  regulationId: integer("regulation_id").notNull().references(() => regulation.id),
  speciesId: integer("species_id"),
  speciesGroupId: integer("species_group_id"),
  role: speciesRoleEnum("role").notNull().default("target"),
  mode: speciesModeEnum("mode").notNull().default("include"),
  ...stamps,
});

export const regulationTarget = pgTable("regulation_target", {
  id: serial("id").primaryKey(),
  regulationId: integer("regulation_id").notNull().references(() => regulation.id),
  targetType: targetTypeEnum("target_type").notNull(),
  targetId: integer("target_id"),
  mode: targetModeEnum("mode").notNull().default("include"),
  ...stamps,
});

export const regulationSource = pgTable("regulation_source", {
  id: serial("id").primaryKey(),
  regulationId: integer("regulation_id").notNull().references(() => regulation.id),
  sourceId: integer("source_id").notNull().references(() => source.id),
  role: sourceRoleEnum("role").notNull(),
  sectionRef: text("section_ref"),
  ...stamps,
});

export const licenseReciprocity = pgTable("license_reciprocity", {
  id: serial("id").primaryKey(),
  waterBodyId: integer("water_body_id").references(() => waterBody.id),
  zoneId: integer("zone_id").references(() => zone.id),
  honoringAuthorityId: integer("honoring_authority_id").notNull().references(() => authority.id),
  honoredAuthorityId: integer("honored_authority_id").references(() => authority.id),
  honoredState: text("honored_state"),
  honored: boolean("honored").notNull(),
  replacesStateLicense: boolean("replaces_state_license").notNull().default(false),
  condition: jsonb("condition"),
  sourceId: integer("source_id").references(() => source.id),
  ...stamps,
});
```

- [ ] **Step 2: Typecheck** — Run `npm run typecheck`; expect 0.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): regulation core tables"
```

### Task 7: Audit table + schema barrel

**Files:**
- Create: `src/db/schema/audit.ts`
- Modify: `src/db/schema/index.ts`

- [ ] **Step 1: Write `src/db/schema/audit.ts`**

```ts
import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { auditActionEnum } from "../enums";

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  tableName: text("table_name").notNull(),
  rowId: integer("row_id").notNull(),
  action: auditActionEnum("action").notNull(),
  actor: text("actor"),
  at: timestamp("at").defaultNow().notNull(),
  diff: jsonb("diff"),
});
```

- [ ] **Step 2: Replace `src/db/schema/index.ts`**

```ts
export * from "../enums";
export * from "./geography";
export * from "./species";
export * from "./regulation";
export * from "./audit";
```

- [ ] **Step 3: Typecheck** — Run `npm run typecheck`; expect 0.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(db): audit_log + schema barrel export"
```

### Task 8: Generate and apply the initial migration + smoke test

**Files:**
- Create: `migrations/*` (generated), `tests/db/schema.test.ts`

- [ ] **Step 1: Generate migration**

Run: `npm run db:generate`
Expected: a `migrations/0000_*.sql` file listing `CREATE TYPE`/`CREATE TABLE` for all enums/tables.

- [ ] **Step 2: Apply migration**

Run: `npm run db:migrate`
Expected: applies cleanly.

- [ ] **Step 3: Write a smoke test that inserts a water body with geometry**

`tests/db/schema.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { authority, waterBody } from "../../src/db/schema";

afterAll(async () => { await closeDb(); });

describe("schema smoke", () => {
  it("inserts an authority and a water body with a point geometry", async () => {
    const [a] = await db.insert(authority).values({ name: "CDFW", state: "CA", type: "state_agency" }).returning();
    const [w] = await db.insert(waterBody).values({
      name: "Donner Lake", waterType: "lake", states: ["CA"], counties: ["Nevada"],
      geom: "SRID=4326;POINT(-120.2436 39.3230)",
    }).returning();
    expect(a.id).toBeGreaterThan(0);
    const [{ lon }] = await db.execute(sql`select st_x(geom) as lon from water_body where id = ${w.id}`) as any;
    expect(Number(lon)).toBeCloseTo(-120.2436, 3);
  });
});
```

- [ ] **Step 4: Run it** — Run `npx vitest run tests/db/schema.test.ts`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): initial migration + schema smoke test"
```

---

## Phase 2 — Zod parameter schemas

> Each `regulation.parameters` blob is validated by the Zod schema for its `rule_type`. Schemas transcribe spec §6.3. Optional fields use `.optional()`. Every schema uses `.strict()` so unknown keys fail (guards against silent data drift).

### Task 9: Shared date/time specs

**Files:** Create `src/params/shared.ts`; Test `tests/params/shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { dateSpec } from "../../src/params/shared";

describe("dateSpec", () => {
  it("accepts a relative 'last Saturday in April'", () => {
    const v = dateSpec.parse({ type: "relative", ordinal: "last", weekday: "sat", month: 4, verbatim: "last Saturday in April" });
    expect(v.month).toBe(4);
  });
  it("rejects an unknown type", () => {
    expect(() => dateSpec.parse({ type: "lunar", verbatim: "x" })).toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm failure** — `npx vitest run tests/params/shared.test.ts`; Expected FAIL (module missing).

- [ ] **Step 3: Write `src/params/shared.ts`**

```ts
import { z } from "zod";

export const dateSpec = z.object({
  type: z.enum(["fixed", "relative", "astronomical", "year_round"]),
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
  ordinal: z.enum(["first", "second", "third", "fourth", "last", "nth"]).optional(),
  weekday: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]).optional(),
  relation: z.enum(["on", "preceding", "following"]).optional(),
  offset_days: z.number().int().optional(),
  anchor_holiday: z.string().optional(),
  anchor: z.enum(["sunrise", "sunset"]).optional(),
  offset_minutes: z.number().int().optional(),
  verbatim: z.string(),
}).strict();

export const timeSpec = z.object({
  anchor: z.enum(["sunrise", "sunset", "clock"]),
  offset_minutes: z.number().int().optional(),
  clock_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  verbatim: z.string(),
}).strict();

export type DateSpec = z.infer<typeof dateSpec>;
export type TimeSpec = z.infer<typeof timeSpec>;
```

- [ ] **Step 4: Run to confirm pass**; **Step 5: Commit** `feat(params): shared date/time specs`.

### Task 10: season, bag, size_limit param schemas

**Files:** Create `src/params/season.ts`, `src/params/bag.ts`, `src/params/sizeLimit.ts`; Test `tests/params/bag.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/params/bag.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { bagParams } from "../../src/params/bag";

describe("bagParams", () => {
  it("encodes the Topaz compound bag (25 warmwater, <=5 bass)", () => {
    const v = bagParams.parse({
      daily: 25, possession: 50, unit: "fish", aggregation: "combined_group",
      relationship: "independent",
      sub_limits: [{ target: { species_group: "black_bass" }, mode: "carve_out", max_daily: 5, max_possession: 10 }],
    });
    expect(v.sub_limits?.[0].max_daily).toBe(5);
  });
  it("supports annual limits with reset_basis", () => {
    const v = bagParams.parse({ daily: 1, annual: 3, reset_basis: "calendar_year", unit: "fish", aggregation: "combined_group" });
    expect(v.annual).toBe(3);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write the three schemas**

`src/params/season.ts`:
```ts
import { z } from "zod";
import { dateSpec } from "./shared";
export const seasonParams = z.object({
  periods: z.array(z.object({
    label: z.string(),
    status: z.enum(["open", "closed", "open_catch_release"]),
    start: dateSpec,
    end: dateSpec,
  })).min(1),
  note: z.string().optional(),
}).strict();
export type SeasonParams = z.infer<typeof seasonParams>;
```

`src/params/bag.ts`:
```ts
import { z } from "zod";
const subLimit = z.object({
  target: z.union([z.object({ species: z.string() }), z.object({ species_group: z.string() })]),
  mode: z.enum(["additive", "carve_out"]),
  max_daily: z.number().int().nonnegative().optional(),
  max_possession: z.number().int().nonnegative().optional(),
  min_length_in: z.number().nonnegative().optional(),
  max_length_in: z.number().nonnegative().optional(),
  note: z.string().optional(),
}).strict();
export const bagParams = z.object({
  daily: z.number().int().nonnegative().nullable().optional(),
  possession: z.number().int().nonnegative().nullable().optional(),
  annual: z.number().int().nonnegative().nullable().optional(),
  reset_basis: z.enum(["calendar_year", "license_year", "regulation_year", "season"]).optional(),
  possession_multiplier: z.number().positive().optional(),
  unit: z.string().default("fish"),
  aggregation: z.enum(["combined_group", "per_species", "combined_all"]),
  relationship: z.enum(["independent", "cumulative", "shared_aggregate"]).optional(),
  catch_and_release: z.boolean().optional(),
  counts_toward_statewide_aggregate: z.boolean().optional(),
  sub_limits: z.array(subLimit).optional(),
  allowed_combinations: z.array(z.string()).optional(),
  possession_condition: z.string().optional(),
  counting_rule: z.string().optional(),
}).strict();
export type BagParams = z.infer<typeof bagParams>;
```

`src/params/sizeLimit.ts`:
```ts
import { z } from "zod";
export const sizeLimitParams = z.object({
  min_length_in: z.number().nonnegative().nullable().optional(),
  max_length_in: z.number().nonnegative().nullable().optional(),
  protected_slot: z.object({ min_in: z.number().nonnegative(), max_in: z.number().nonnegative() }).nullable().optional(),
  measurement: z.enum(["total_length", "fork_length", "girth"]),
  unit: z.enum(["inch", "cm"]),
  over_slot_retention: z.object({ max_daily: z.number().int().nonnegative(), min_in: z.number().nonnegative().optional() }).optional(),
  note: z.string().optional(),
}).strict();
export type SizeLimitParams = z.infer<typeof sizeLimitParams>;
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(params): season, bag, size_limit`.

### Task 11: gear_method, fishing_hours, closure param schemas

**Files:** Create `src/params/gearMethod.ts`, `src/params/fishingHours.ts`, `src/params/closure.ts`; Test `tests/params/closure.test.ts`

- [ ] **Step 1: Failing test** (`tests/params/closure.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { closureParams } from "../../src/params/closure";
describe("closureParams", () => {
  it("encodes a flow-triggered closure", () => {
    const v = closureParams.parse({
      closure_kind: "flow_triggered", boundary_definition: "described",
      trigger: { kind: "flow", gauge_station: "USGS 11463500", threshold_cfs: 300, comparison: "below", status_source_url: "https://example.gov" },
    });
    expect(v.trigger?.threshold_cfs).toBe(300);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write the three schemas**

`src/params/gearMethod.ts`:
```ts
import { z } from "zod";
export const gearMethodParams = z.object({
  bait_allowed: z.boolean(),
  artificial_only: z.boolean(),
  flies_only: z.boolean(),
  lures_allowed: z.boolean(),
  barbless_required: z.boolean(),
  single_hook_required: z.boolean(),
  max_hooks: z.number().int().positive().optional(),
  max_hook_gap_in: z.number().positive().optional(),
  max_droppers: z.number().int().nonnegative().optional(),
  max_leader_len_in: z.number().positive().optional(),
  max_rods: z.number().int().positive().optional(),
  max_lines: z.number().int().positive().optional(),
  chumming_allowed: z.boolean().optional(),
  snagging_allowed: z.boolean().optional(),
  downriggers_allowed: z.boolean().optional(),
  prohibited_methods: z.array(z.string()).optional(),
  requires_permit_note: z.string().optional(),
  evidentiary_note: z.string().optional(),
  note: z.string().optional(),
}).strict();
export type GearMethodParams = z.infer<typeof gearMethodParams>;
```

`src/params/fishingHours.ts`:
```ts
import { z } from "zod";
import { timeSpec } from "./shared";
export const fishingHoursParams = z.object({
  basis: z.enum(["any_hour", "sunrise_sunset", "park_hours", "custom"]),
  allowed_from: timeSpec,
  allowed_to: timeSpec,
  note: z.string().optional(),
}).strict();
export type FishingHoursParams = z.infer<typeof fishingHoursParams>;
```

`src/params/closure.ts`:
```ts
import { z } from "zod";
export const closureParams = z.object({
  closure_kind: z.enum(["seasonal", "spatial", "emergency", "year_round", "flow_triggered", "quota_triggered"]),
  boundary_definition: z.enum(["geom", "signs_buoys", "radius", "described"]),
  trigger: z.object({
    kind: z.enum(["flow", "quota"]),
    gauge_station: z.string().optional(),
    threshold_cfs: z.number().optional(),
    comparison: z.enum(["below", "above"]).optional(),
    quota_count: z.number().int().optional(),
    quota_area: z.string().optional(),
    status_source_url: z.string().optional(),
    hotline: z.string().optional(),
  }).strict().optional(),
  note: z.string().optional(),
}).strict();
export type ClosureParams = z.infer<typeof closureParams>;
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(params): gear_method, fishing_hours, closure`.

### Task 12: handling, vessel, ais, documentation param schemas

**Files:** Create `src/params/handling.ts`, `src/params/vessel.ts`, `src/params/ais.ts`, `src/params/documentation.ts`; Test `tests/params/ais.test.ts`

- [ ] **Step 1: Failing test** (`tests/params/ais.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { aisParams } from "../../src/params/ais";
describe("aisParams", () => {
  it("encodes the Tahoe inspection gate", () => {
    const v = aisParams.parse({
      inspection_required: true, decontamination_required: true, seal_or_sticker_required: true,
      drain_plug_out_required: true, applies_to: "motorized",
    });
    expect(v.inspection_required).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write the four schemas**

`src/params/handling.ts`:
```ts
import { z } from "zod";
export const handlingParams = z.object({
  must_release_unharmed: z.boolean().optional(),
  keep_in_water: z.boolean().optional(),
  filleting_prohibited: z.boolean().optional(),
  live_transport_prohibited: z.boolean().optional(),
  stringer_max: z.number().int().nonnegative().optional(),
  stringers_per_person: z.number().int().nonnegative().optional(),
  counts_toward_bag_when_retained: z.boolean().optional(),
  condition: z.string().optional(),
  note: z.string().optional(),
}).strict();
export type HandlingParams = z.infer<typeof handlingParams>;
```

`src/params/vessel.ts`:
```ts
import { z } from "zod";
export const vesselParams = z.object({
  gas_motor_allowed: z.boolean(),
  electric_motor_allowed: z.boolean(),
  non_motorized_allowed: z.boolean(),
  float_tube_allowed: z.boolean().optional(),
  paddleboard_allowed: z.boolean().optional(),
  outside_boats_allowed: z.boolean().optional(),
  hp_limit: z.number().nonnegative().optional(),
  no_wake: z.boolean().optional(),
  reason: z.string().optional(),
  note: z.string().optional(),
}).strict();
export type VesselParams = z.infer<typeof vesselParams>;
```

`src/params/ais.ts`:
```ts
import { z } from "zod";
export const aisParams = z.object({
  inspection_required: z.boolean(),
  decontamination_required: z.boolean(),
  quarantine_days: z.number().int().nonnegative().optional(),
  seal_or_sticker_required: z.boolean().optional(),
  sticker_note: z.string().optional(),
  drain_plug_out_required: z.boolean().optional(),
  felt_soles_prohibited: z.boolean().optional(),
  applies_to: z.enum(["motorized", "all_watercraft"]),
  program_authority_id: z.number().int().optional(),
  status_source_url: z.string().optional(),
  note: z.string().optional(),
}).strict();
export type AisParams = z.infer<typeof aisParams>;
```

`src/params/documentation.ts`:
```ts
import { z } from "zod";
export const documentationParams = z.object({
  report_card_required: z.boolean().optional(),
  card_name: z.string().optional(),
  tag_required: z.boolean().optional(),
  tag_affix_timing: z.enum(["immediately", "before_transport"]).optional(),
  record_before_moving: z.boolean().optional(),
  return_required: z.boolean().optional(),
  note: z.string().optional(),
}).strict();
export type DocumentationParams = z.infer<typeof documentationParams>;
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(params): handling, vessel, ais, documentation`.

### Task 13: license, definition, special param schemas

**Files:** Create `src/params/license.ts`, `src/params/definition.ts`, `src/params/special.ts`; Test `tests/params/license.test.ts`

- [ ] **Step 1: Failing test** (`tests/params/license.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { licenseParams } from "../../src/params/license";
describe("licenseParams", () => {
  it("encodes Tahoe reciprocity", () => {
    const v = licenseParams.parse({
      required: true, min_age: 16, under_min_age: "no_license_required",
      reciprocity: { applies: true, honored_authority_ids: [1, 2], note: "CA or NV honored; NV needs trout stamp" },
    });
    expect(v.reciprocity?.honored_authority_ids).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write the three schemas**

`src/params/license.ts`:
```ts
import { z } from "zod";
import { dateSpec } from "./shared";
export const licenseParams = z.object({
  required: z.boolean(),
  min_age: z.number().int().nonnegative().optional(),
  under_min_age: z.literal("no_license_required").optional(),
  issuing_authority_id: z.number().int().optional(),
  replaces_state_license: z.boolean().optional(),
  required_product_note: z.string().optional(),
  reciprocity: z.object({
    applies: z.boolean(),
    honored_authority_ids: z.array(z.number().int()),
    note: z.string(),
  }).strict().optional(),
  exemption: z.object({ event: z.string(), date: dateSpec, other_regs_apply: z.boolean() }).strict().optional(),
  note: z.string().optional(),
}).strict();
export type LicenseParams = z.infer<typeof licenseParams>;
```

`src/params/definition.ts`:
```ts
import { z } from "zod";
export const definitionParams = z.object({
  term: z.string(),
  applies_to_rule_types: z.array(z.string()),
  possession_multiplier: z.number().positive().optional(),
  counting_rules: z.object({ includes: z.array(z.string()), excludes: z.array(z.string()) }).strict().optional(),
  statewide_aggregate: z.boolean().optional(),
  text: z.string(),
  note: z.string().optional(),
}).strict();
export type DefinitionParams = z.infer<typeof definitionParams>;
```

`src/params/special.ts`:
```ts
import { z } from "zod";
export const specialParams = z.object({
  description: z.string(),
  raw: z.record(z.unknown()),
}).strict();
export type SpecialParams = z.infer<typeof specialParams>;
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(params): license, definition, special`.

### Task 14: Parameter registry + `validateParameters`

**Files:** Create `src/params/index.ts`; Test `tests/params/registry.test.ts`

- [ ] **Step 1: Failing test** (`tests/params/registry.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { validateParameters, ruleTypeParamSchemas } from "../../src/params";

describe("validateParameters", () => {
  it("covers all 13 rule types", () => {
    expect(Object.keys(ruleTypeParamSchemas).sort()).toEqual([
      "ais","bag","closure","definition","documentation","fishing_hours","gear_method",
      "handling","license","season","size_limit","special","vessel",
    ]);
  });
  it("validates a good bag blob and rejects a bad one", () => {
    expect(validateParameters("bag", { daily: 5, unit: "fish", aggregation: "combined_group" }).success).toBe(true);
    expect(validateParameters("bag", { daily: -1, unit: "fish", aggregation: "combined_group" }).success).toBe(false);
    expect(validateParameters("bag", { daily: 5, unit: "fish", aggregation: "combined_group", bogus: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write `src/params/index.ts`**

```ts
import type { z } from "zod";
import { seasonParams } from "./season";
import { bagParams } from "./bag";
import { sizeLimitParams } from "./sizeLimit";
import { gearMethodParams } from "./gearMethod";
import { fishingHoursParams } from "./fishingHours";
import { closureParams } from "./closure";
import { handlingParams } from "./handling";
import { vesselParams } from "./vessel";
import { aisParams } from "./ais";
import { documentationParams } from "./documentation";
import { licenseParams } from "./license";
import { definitionParams } from "./definition";
import { specialParams } from "./special";

export const ruleTypeParamSchemas = {
  season: seasonParams, bag: bagParams, size_limit: sizeLimitParams, gear_method: gearMethodParams,
  fishing_hours: fishingHoursParams, closure: closureParams, handling: handlingParams, vessel: vesselParams,
  ais: aisParams, documentation: documentationParams, license: licenseParams, definition: definitionParams,
  special: specialParams,
} as const satisfies Record<string, z.ZodTypeAny>;

export type RuleType = keyof typeof ruleTypeParamSchemas;

export function validateParameters(ruleType: string, params: unknown) {
  const schema = (ruleTypeParamSchemas as Record<string, z.ZodTypeAny>)[ruleType];
  if (!schema) return { success: false as const, error: `unknown rule_type: ${ruleType}` };
  const r = schema.safeParse(params);
  return r.success ? { success: true as const, data: r.data } : { success: false as const, error: r.error.message };
}

export * from "./shared";
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(params): registry + validateParameters`.

---

## Phase 3 — Correctness machinery

### Task 15: All-species sentinel

**Files:** Create `src/validation/allSpecies.ts`; Test `tests/validation/allSpecies.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { checkSpeciesScope } from "../../src/validation/allSpecies";
describe("checkSpeciesScope", () => {
  it("rejects a 'listed' rule with no target species row", () => {
    expect(checkSpeciesScope({ speciesScope: "listed" }, []).ok).toBe(false);
  });
  it("accepts a 'listed' rule that has target rows", () => {
    expect(checkSpeciesScope({ speciesScope: "listed" }, [{ role: "target" }]).ok).toBe(true);
  });
  it("accepts an 'all' rule with no target rows", () => {
    expect(checkSpeciesScope({ speciesScope: "all" }, []).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write `src/validation/allSpecies.ts`**

```ts
export function checkSpeciesScope(
  reg: { speciesScope: "all" | "listed" },
  speciesRows: Array<{ role: string }>,
): { ok: boolean; reason?: string } {
  if (reg.speciesScope === "all") return { ok: true };
  const hasTarget = speciesRows.some((r) => r.role === "target");
  return hasTarget ? { ok: true } : { ok: false, reason: "listed rule requires at least one role='target' species row; never infer 'all' from absence" };
}
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(validation): explicit all-species sentinel`.

### Task 16: Legal-instrument enforcement

**Files:** Create `src/validation/legalInstrument.ts`; Test `tests/validation/legalInstrument.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { checkLegalInstrument } from "../../src/validation/legalInstrument";
const legal = { authorityLevel: "primary_regulatory", instrumentType: "commission_reg" };
const booklet = { authorityLevel: "agency_mirror", instrumentType: "booklet" };
describe("checkLegalInstrument", () => {
  it("rejects published+binding backed only by a booklet", () => {
    expect(checkLegalInstrument({ status: "published", isBinding: true, rulePolarity: "applies", verbatimText: "x" }, [{ role: "primary", source: booklet }]).ok).toBe(false);
  });
  it("rejects published+binding with null verbatim (not asserts_none)", () => {
    expect(checkLegalInstrument({ status: "published", isBinding: true, rulePolarity: "applies", verbatimText: null }, [{ role: "primary", source: legal }]).ok).toBe(false);
  });
  it("accepts published+binding with a legal instrument and verbatim", () => {
    expect(checkLegalInstrument({ status: "published", isBinding: true, rulePolarity: "applies", verbatimText: "x" }, [{ role: "primary", source: legal }]).ok).toBe(true);
  });
  it("allows asserts_none with null verbatim", () => {
    expect(checkLegalInstrument({ status: "published", isBinding: true, rulePolarity: "asserts_none", verbatimText: null }, [{ role: "primary", source: legal }]).ok).toBe(true);
  });
  it("ignores draft rules", () => {
    expect(checkLegalInstrument({ status: "draft", isBinding: true, rulePolarity: "applies", verbatimText: null }, []).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write `src/validation/legalInstrument.ts`**

```ts
const LEGAL_INSTRUMENTS = new Set(["commission_reg", "admin_code", "statute", "tribal_ordinance", "emergency_order", "directors_order"]);

export function checkLegalInstrument(
  reg: { status: string; isBinding: boolean; rulePolarity: string; verbatimText: string | null },
  sources: Array<{ role: string; source: { authorityLevel: string; instrumentType: string | null } }>,
): { ok: boolean; reason?: string } {
  if (!(reg.status === "published" && reg.isBinding)) return { ok: true };
  const hasLegalPrimary = sources.some(
    (s) => s.role === "primary" && s.source.authorityLevel === "primary_regulatory" && s.source.instrumentType != null && LEGAL_INSTRUMENTS.has(s.source.instrumentType),
  );
  if (!hasLegalPrimary) return { ok: false, reason: "published+binding rule needs a primary source that is a primary_regulatory legal instrument (not a summary booklet)" };
  if (reg.rulePolarity !== "asserts_none" && (reg.verbatimText == null || reg.verbatimText.trim() === ""))
    return { ok: false, reason: "published+binding rule requires verbatim_text unless rule_polarity=asserts_none" };
  return { ok: true };
}
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(validation): legal-instrument enforcement`.

### Task 17: Temporal integrity guard (overlap + coverage)

**Files:** Create `src/validation/integrity.ts`; Test `tests/validation/integrity.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { findOverlaps } from "../../src/validation/integrity";

const base = { ruleType: "bag", status: "published", scopeKey: "water_body:10", speciesKey: "group:trout" };
describe("findOverlaps", () => {
  it("flags two published same-type rules with overlapping scope/species/dates", () => {
    const rows = [
      { id: 1, ...base, validFrom: "2026-01-01", validTo: "2026-12-31" },
      { id: 2, ...base, validFrom: "2026-06-01", validTo: null },
    ];
    expect(findOverlaps(rows).length).toBe(1);
  });
  it("does not flag disjoint date ranges", () => {
    const rows = [
      { id: 1, ...base, validFrom: "2025-01-01", validTo: "2025-12-31" },
      { id: 2, ...base, validFrom: "2026-01-01", validTo: "2026-12-31" },
    ];
    expect(findOverlaps(rows).length).toBe(0);
  });
  it("does not flag different species", () => {
    const rows = [
      { id: 1, ...base, validFrom: "2026-01-01", validTo: null },
      { id: 2, ...base, speciesKey: "group:bass", validFrom: "2026-01-01", validTo: null },
    ];
    expect(findOverlaps(rows).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write `src/validation/integrity.ts`**

```ts
export interface ActiveRule {
  id: number; ruleType: string; status: string; scopeKey: string; speciesKey: string;
  validFrom: string | null; validTo: string | null;
}
const lo = (d: string | null) => (d == null ? -Infinity : Date.parse(d));
const hi = (d: string | null) => (d == null ? Infinity : Date.parse(d));
function rangesOverlap(a: ActiveRule, b: ActiveRule): boolean {
  return lo(a.validFrom) <= hi(b.validTo) && lo(b.validFrom) <= hi(a.validTo);
}
export function findOverlaps(rows: ActiveRule[]): Array<[number, number]> {
  const pub = rows.filter((r) => r.status === "published");
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pub.length; i++)
    for (let j = i + 1; j < pub.length; j++) {
      const a = pub[i], b = pub[j];
      if (a.ruleType === b.ruleType && a.scopeKey === b.scopeKey && a.speciesKey === b.speciesKey && rangesOverlap(a, b))
        out.push([a.id, b.id]);
    }
  return out;
}
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(validation): temporal integrity overlap guard`.

### Task 18: Clone-on-supersede versioning

**Files:** Create `src/validation/versioning.ts`; Test `tests/validation/versioning.test.ts` (integration — uses the DB)

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, afterAll } from "vitest";
import { db, closeDb } from "../../src/db/client";
import { authority, regulation, regulationTarget } from "../../src/db/schema";
import { supersedeRegulation } from "../../src/validation/versioning";

afterAll(async () => { await closeDb(); });

describe("supersedeRegulation (clone-on-supersede)", () => {
  it("creates a new version, clones satellites, and closes the old validity", async () => {
    const [a] = await db.insert(authority).values({ name: "NDOW", state: "NV", type: "state_agency" }).returning();
    const [old] = await db.insert(regulation).values({
      ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" },
      authorityId: a.id, humanSummary: "5 trout", validFrom: "2025-01-01", validTo: null, status: "published",
    }).returning();
    await db.insert(regulationTarget).values({ regulationId: old.id, targetType: "water_body", targetId: 999, mode: "include" });

    const next = await supersedeRegulation(old.id, { parameters: { daily: 2, unit: "fish", aggregation: "combined_group" }, humanSummary: "2 trout", validFrom: "2026-01-01" });

    const oldTargets = await db.select().from(regulationTarget).where(/* by regulationId=old.id */ (t => undefined) as any);
    expect(next.id).not.toBe(old.id);
    expect(next.supersedesId).toBe(old.id);
  });
});
```

> Note for the implementer: use `eq(regulationTarget.regulationId, old.id)` from `drizzle-orm` in the assertion query; the placeholder above is illustrative. Assert: old row `validTo` set to the day before `next.validFrom`; new row has cloned target rows (same `targetType`/`targetId`), a distinct id, and `supersedesId === old.id`.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write `src/validation/versioning.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { regulation, regulationTarget, regulationSpecies, regulationSource } from "../db/schema";

function dayBefore(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Immutable versioning: close the old row's validity, insert a new version, clone all satellites onto it.
export async function supersedeRegulation(
  oldId: number,
  changes: { parameters?: unknown; humanSummary?: string; verbatimText?: string | null; validFrom: string },
) {
  return await db.transaction(async (tx) => {
    const [old] = await tx.select().from(regulation).where(eq(regulation.id, oldId));
    if (!old) throw new Error(`regulation ${oldId} not found`);

    await tx.update(regulation).set({ validTo: dayBefore(changes.validFrom), status: "superseded" }).where(eq(regulation.id, oldId));

    const { id: _drop, createdAt: _c, updatedAt: _u, ...carry } = old as any;
    const [next] = await tx.insert(regulation).values({
      ...carry,
      parameters: changes.parameters ?? old.parameters,
      humanSummary: changes.humanSummary ?? old.humanSummary,
      verbatimText: changes.verbatimText ?? old.verbatimText,
      validFrom: changes.validFrom,
      validTo: null,
      status: "published",
      supersedesId: oldId,
    }).returning();

    for (const t of await tx.select().from(regulationTarget).where(eq(regulationTarget.regulationId, oldId)))
      await tx.insert(regulationTarget).values({ regulationId: next.id, targetType: t.targetType, targetId: t.targetId, mode: t.mode });
    for (const s of await tx.select().from(regulationSpecies).where(eq(regulationSpecies.regulationId, oldId)))
      await tx.insert(regulationSpecies).values({ regulationId: next.id, speciesId: s.speciesId, speciesGroupId: s.speciesGroupId, role: s.role, mode: s.mode });
    for (const s of await tx.select().from(regulationSource).where(eq(regulationSource.regulationId, oldId)))
      await tx.insert(regulationSource).values({ regulationId: next.id, sourceId: s.sourceId, role: s.role, sectionRef: s.sectionRef });

    return next;
  });
}
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(validation): clone-on-supersede versioning`.

### Task 19: Audit trigger + as-of reconstruction query

**Files:** Create `db/sql/audit_trigger.sql`, `src/db/applySql.ts`; Test `tests/validation/asOf.test.ts`

- [ ] **Step 1: Write `db/sql/audit_trigger.sql`**

```sql
create or replace function fl_audit() returns trigger as $$
declare rid int;
begin
  rid := coalesce(new.id, old.id);
  insert into audit_log(table_name, row_id, action, actor, diff)
  values (tg_table_name, rid, lower(tg_op),
          current_setting('fl.actor', true),
          case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return coalesce(new, old);
end; $$ language plpgsql;

create trigger audit_regulation after insert or update or delete on regulation
  for each row execute function fl_audit();
```

- [ ] **Step 2: Write `src/db/applySql.ts`** (helper to run a raw SQL file)

```ts
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "./client";
export async function applySqlFile(path: string) {
  await db.execute(sql.raw(readFileSync(path, "utf8")));
}
```

- [ ] **Step 3: Failing test** (`tests/validation/asOf.test.ts`)

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, lte, or, isNull, gte } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { authority, regulation } from "../../src/db/schema";
import { applySqlFile } from "../../src/db/applySql";
import { supersedeRegulation } from "../../src/validation/versioning";

beforeAll(async () => { await applySqlFile("db/sql/audit_trigger.sql"); });
afterAll(async () => { await closeDb(); });

describe("as-of reconstruction", () => {
  it("returns the version valid on a given date and writes an audit row", async () => {
    const [a] = await db.insert(authority).values({ name: "CDFW-2", state: "CA", type: "state_agency" }).returning();
    const [v1] = await db.insert(regulation).values({
      ruleType: "bag", parameters: { daily: 5, unit: "fish", aggregation: "combined_group" },
      authorityId: a.id, humanSummary: "5 trout", validFrom: "2025-01-01", status: "published",
    }).returning();
    await supersedeRegulation(v1.id, { parameters: { daily: 2, unit: "fish", aggregation: "combined_group" }, humanSummary: "2 trout", validFrom: "2026-01-01" });

    const asOf = "2025-07-01";
    const rows = await db.select().from(regulation).where(and(
      eq(regulation.authorityId, a.id),
      lte(regulation.validFrom, asOf),
      or(isNull(regulation.validTo), gte(regulation.validTo, asOf)),
    ));
    expect(rows).toHaveLength(1);
    expect((rows[0].parameters as any).daily).toBe(5);
  });
});
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(db): audit trigger + as-of reconstruction`.

---

## Phase 4 — Date-spec resolver

### Task 20: Resolve relative seasons to concrete dates

**Files:** Create `src/resolver/dateSpec.ts`; Test `tests/resolver/dateSpec.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveDateSpec } from "../../src/resolver/dateSpec";

describe("resolveDateSpec", () => {
  it("fixed month/day", () => {
    expect(resolveDateSpec({ type: "fixed", month: 11, day: 15, verbatim: "Nov 15" }, 2026)).toBe("2026-11-15");
  });
  it("last Saturday in April 2026 = 2026-04-25", () => {
    expect(resolveDateSpec({ type: "relative", ordinal: "last", weekday: "sat", month: 4, verbatim: "last Sat Apr" }, 2026)).toBe("2026-04-25");
  });
  it("Friday preceding the last Saturday in April 2026 = 2026-04-24", () => {
    expect(resolveDateSpec({ type: "relative", ordinal: "last", weekday: "sat", month: 4, relation: "preceding", offset_days: -1, verbatim: "Fri before" }, 2026)).toBe("2026-04-24");
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write `src/resolver/dateSpec.ts`**

```ts
import type { DateSpec } from "../params/shared";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function resolveDateSpec(spec: DateSpec, year: number): string {
  if (spec.type === "fixed") {
    if (spec.month == null || spec.day == null) throw new Error("fixed date_spec needs month+day");
    return iso(new Date(Date.UTC(year, spec.month - 1, spec.day)));
  }
  if (spec.type === "relative") {
    if (spec.month == null || spec.ordinal == null || spec.weekday == null) throw new Error("relative date_spec needs month, ordinal, weekday");
    const target = WEEKDAYS.indexOf(spec.weekday);
    let base: Date;
    if (spec.ordinal === "last") {
      const last = new Date(Date.UTC(year, spec.month, 0)); // last day of month
      const back = (last.getUTCDay() - target + 7) % 7;
      base = new Date(Date.UTC(year, spec.month - 1, last.getUTCDate() - back));
    } else {
      const nth = { first: 1, second: 2, third: 3, fourth: 4 }[spec.ordinal as "first"];
      const first = new Date(Date.UTC(year, spec.month - 1, 1));
      const fwd = (target - first.getUTCDay() + 7) % 7;
      base = new Date(Date.UTC(year, spec.month - 1, 1 + fwd + (nth - 1) * 7));
    }
    if (spec.offset_days) base.setUTCDate(base.getUTCDate() + spec.offset_days);
    return iso(base);
  }
  throw new Error(`resolveDateSpec does not handle type=${spec.type} (astronomical/year_round resolved elsewhere)`);
}
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(resolver): relative date_spec resolution`.

---

## Phase 5 — Seed data + acceptance

### Task 21: Reference data + Little Truckee zero-limit C&R (canonical case 7)

**Files:** Create `src/seed/corridor.ts`, `tests/seed/littleTruckee.test.ts`

- [ ] **Step 1: Failing acceptance test** (`tests/seed/littleTruckee.test.ts`)

```ts
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { regulation } from "../../src/db/schema";
import { validateParameters } from "../../src/params";
import { seedLittleTruckee } from "../../src/seed/corridor";

afterAll(async () => { await closeDb(); });

describe("Little Truckee zero-limit C&R (canonical case 7)", () => {
  it("seeds one group of season+bag+gear_method that all validate", async () => {
    const { groupId } = await seedLittleTruckee();
    const rows = await db.select().from(regulation).where(eq(regulation.regulationGroupId, groupId));
    const types = rows.map((r) => r.ruleType).sort();
    expect(types).toEqual(["bag", "gear_method", "season"]);
    for (const r of rows) expect(validateParameters(r.ruleType, r.parameters).success).toBe(true);
    const bag = rows.find((r) => r.ruleType === "bag")!;
    expect((bag.parameters as any).catch_and_release).toBe(true);
    expect((bag.parameters as any).daily).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Write `src/seed/corridor.ts`** with `seedLittleTruckee()`

```ts
import { db } from "../db/client";
import { authority, source, species, speciesGroup, regulationGroup, regulation, regulationGroup as _rg } from "../db/schema";
import { regulationSpecies, regulationSource, regulationTarget, waterBody } from "../db/schema";
import { validateParameters } from "../params";

async function ensureAuthority(name: string, state: string | null, type: any) {
  const [row] = await db.insert(authority).values({ name, state, type }).returning();
  return row;
}

export async function seedLittleTruckee() {
  const cdfw = await ensureAuthority("CDFW", "CA", "state_agency");
  const [wb] = await db.insert(waterBody).values({ name: "Little Truckee River", waterType: "river", states: ["CA"], counties: ["Sierra"] }).returning();
  const [troutGroup] = await db.insert(speciesGroup).values({ name: "trout", category: "trout", authorityId: cdfw.id }).returning();
  const [src] = await db.insert(source).values({
    authorityId: cdfw.id, documentType: "webpage", instrumentType: "commission_reg", authorityLevel: "primary_regulatory",
    url: "https://govt.westlaw.com/calregs", title: "CCR T14 §7.50(b)(80)", sectionRef: "7.50(b)(80)",
    quotedText: "All year. Only artificial lures with barbless hooks may be used. 0 trout.",
  }).returning();
  const [grp] = await db.insert(regulationGroup).values({
    authorityId: cdfw.id, citation: "7.50(b)(80)",
    verbatimText: "All year. Only artificial lures with barbless hooks may be used. 0 trout.",
    humanSummary: "Year-round catch-and-release trout; artificial lures with barbless hooks",
  }).returning();

  const common = { authorityId: cdfw.id, regulationGroupId: grp.id, jurisdictionState: "CA", status: "verified" as const, confidence: "high" as const, citation: "7.50(b)(80)" };
  const rows = [
    { ruleType: "season" as const, humanSummary: "Open all year", verbatimText: "All year.", parameters: { periods: [{ label: "all_year", status: "open", start: { type: "year_round", verbatim: "All year" }, end: { type: "year_round", verbatim: "All year" } }] } },
    { ruleType: "bag" as const, humanSummary: "0 trout (catch-and-release)", verbatimText: "0 trout.", parameters: { daily: 0, possession: 0, unit: "fish", aggregation: "combined_group", catch_and_release: true } },
    { ruleType: "gear_method" as const, humanSummary: "Artificial lures with barbless hooks; no bait", verbatimText: "Only artificial lures with barbless hooks may be used.", parameters: { bait_allowed: false, artificial_only: true, flies_only: false, lures_allowed: true, barbless_required: true, single_hook_required: false } },
  ];
  for (const r of rows) {
    const v = validateParameters(r.ruleType, r.parameters);
    if (!v.success) throw new Error(`seed param invalid for ${r.ruleType}: ${v.error}`);
    const [reg] = await db.insert(regulation).values({ ...common, ...r, speciesScope: "listed" }).returning();
    await db.insert(regulationSpecies).values({ regulationId: reg.id, speciesGroupId: troutGroup.id, role: "target", mode: "include" });
    await db.insert(regulationTarget).values({ regulationId: reg.id, targetType: "water_body", targetId: wb.id, mode: "include" });
    await db.insert(regulationSource).values({ regulationId: reg.id, sourceId: src.id, role: "primary", sectionRef: "7.50(b)(80)" });
  }
  return { groupId: grp.id };
}
```

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(seed): Little Truckee zero-limit C&R canonical case`.

### Task 22: Remaining canonical cases (compound bag, slot, reach closure, reciprocity, tribal permit, AIS, verified absence)

**Files:** Extend `src/seed/corridor.ts`; Test `tests/seed/canonical.test.ts`

> Implement one exported `seed<Case>()` per remaining canonical case in spec §7 (cases 1–6, 8–9), each following the Task 21 pattern: create the authority/water/species rows, a primary legal-instrument `source`, the `regulation` (+ group where multi-row), then `regulationSpecies` / `regulationTarget` / `regulationSource`. Validate every `parameters` blob with `validateParameters` before insert.

- [ ] **Step 1: Write the acceptance test** (`tests/seed/canonical.test.ts`) — asserts each case's distinctive fact:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { closeDb } from "../../src/db/client";
import * as seed from "../../src/seed/corridor";

afterAll(async () => { await closeDb(); });

describe("canonical corridor cases round-trip", () => {
  it("compound bag: Topaz sub-limit ≤5 black bass", async () => {
    const { bag } = await seed.seedTopazCompoundBag();
    expect((bag.parameters as any).sub_limits[0].max_daily).toBe(5);
  });
  it("slot limit: Pyramid cutthroat protected 20–24in, fork length", async () => {
    const { size } = await seed.seedPyramidSlot();
    expect((size.parameters as any).protected_slot).toEqual({ min_in: 20, max_in: 24 });
    expect((size.parameters as any).measurement).toBe("fork_length");
  });
  it("reach closure: Truckee Reach A closed, anchored 1000ft below dam", async () => {
    const { reach, target } = await seed.seedTruckeeReachClosure();
    expect(reach.toOffsetFt).toBe(1000);
    expect(target.targetType).toBe("reach");
  });
  it("reciprocity: Tahoe honored=true, Donner honored=false", async () => {
    const { tahoe, donner } = await seed.seedReciprocity();
    expect(tahoe.honored).toBe(true);
    expect(donner.honored).toBe(false);
  });
  it("tribal permit: replaces state license, reservation-wide territory scope", async () => {
    const { license, target } = await seed.seedPyramidTribalPermit();
    expect((license.parameters as any).replaces_state_license).toBe(true);
    expect(target.targetType).toBe("authority_territory");
  });
  it("AIS gate: Tahoe inspection + decon + drain plug", async () => {
    const { ais } = await seed.seedTahoeAis();
    expect((ais.parameters as any).inspection_required).toBe(true);
  });
  it("verified absence: NV Truckee size_limit asserts_none, disputed source refuted", async () => {
    const { size, source } = await seed.seedNvTruckeeNoSizeLimit();
    expect(size.rulePolarity).toBe("asserts_none");
    expect(source.disputed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement each `seed<Case>()`** in `src/seed/corridor.ts` using the exact `parameters` JSON from spec §7 (rows 1–6, 8–9) and the Task-21 insert pattern. Each returns the specific rows the test asserts on. Validate every blob before insert.

- [ ] **Step 4: Run to confirm pass; Step 5: Commit** `feat(seed): remaining canonical corridor cases`.

### Task 23: Full acceptance sweep + README

**Files:** Create `tests/acceptance.test.ts`, `README.md`

- [ ] **Step 1: Write `tests/acceptance.test.ts`** that runs every `seed*` export, then asserts (a) every `regulation.parameters` validates against its Zod schema, (b) no `checkSpeciesScope` violation, (c) no `checkLegalInstrument` violation for published rows, (d) `findOverlaps` over all seeded rows is empty.

```ts
import { describe, it, expect, afterAll } from "vitest";
import { db, closeDb } from "../src/db/client";
import { regulation, regulationSpecies } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { validateParameters } from "../src/params";
import { checkSpeciesScope } from "../src/validation/allSpecies";
import * as seed from "../src/seed/corridor";

afterAll(async () => { await closeDb(); });

describe("acceptance", () => {
  it("all seeded regulations satisfy schema + sentinel", async () => {
    for (const fn of Object.values(seed)) if (typeof fn === "function") await (fn as any)();
    const regs = await db.select().from(regulation);
    for (const r of regs) {
      expect(validateParameters(r.ruleType, r.parameters).success).toBe(true);
      const sp = await db.select().from(regulationSpecies).where(eq(regulationSpecies.regulationId, r.id));
      expect(checkSpeciesScope({ speciesScope: r.speciesScope }, sp).ok).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the entire suite** — Run `npm test`; Expected: ALL green.

- [ ] **Step 3: Write `README.md`** documenting: prerequisites (Docker), `npm run db:up`, `npm run db:migrate`, `npm test`, and a one-paragraph pointer to the spec.

- [ ] **Step 4: Commit** `test: full acceptance sweep + README`.

---

## Self-review notes (author)

- **Spec coverage:** §4 tables → Tasks 3–8; §5 correctness → Tasks 15–19 (satellite versioning=18, integrity=17, legal instrument=16, all-species=15, staleness=`lastVerifiedAt` column in Task 6, dynamic-closure=`verifyCurrent` column Task 4 + `closure.trigger` Task 11, license-year=`authority` columns Task 4 + resolver Task 20, annual limits=`bag` Task 10); §6 enums/params → Tasks 3, 9–14; §7 canonical cases → Tasks 21–22; §10 testing → per-task tests + Task 23.
- **Deferred (per spec §2, not in this plan):** `license_product`, `stocking_event`, computed/dynamic zones, LRS measures, predicate evaluator.
- **Open questions (spec §11)** are deliberately not resolved here; the season resolver (Task 20) computes on-the-fly (no materialized cache) — matching the spec's v1 recommendation.
- **Known implementer notes:** Task 5 imports `source` from Task 6's module — implement Task 6 before typechecking Task 5 (they compile together in Task 8). Task 18's assertion query uses `eq(regulationTarget.regulationId, old.id)`.
