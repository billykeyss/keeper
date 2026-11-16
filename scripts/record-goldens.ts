// Records golden answers from Keeper's rules API for Foray's parity tests.
// Usage: ./node_modules/.bin/tsx scripts/record-goldens.ts
// Ingests every data/<group>/*.json into the scratch DB `fishing_law_goldens` (never the live or
// test DBs), calls GET /api/waters/:id/rules?on= in-process, and writes goldens/rules-goldens.json.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const ADMIN_URL = "postgres://fl:fl@localhost:5433/fishing_law";
const SCRATCH_DB = "fishing_law_goldens";
const SCRATCH_URL = `postgres://fl:fl@localhost:5433/${SCRATCH_DB}`;
const DATES = ["2026-01-15", "2026-04-25", "2026-07-01", "2026-11-15"];
type ScopeStatus = "open" | "catch_and_release" | "closed" | "unknown";

// Create the scratch DB (admin connection only runs CREATE DATABASE), then migrate it.
const admin = postgres(ADMIN_URL, { max: 1 });
if ((await admin`select 1 from pg_database where datname = ${SCRATCH_DB}`).length === 0) {
  await admin.unsafe(`create database ${SCRATCH_DB}`);
}
await admin.end({ timeout: 5 });
const scratch = postgres(SCRATCH_URL, { max: 1 });
await scratch.unsafe(`create extension if not exists postgis`);
await migrate(drizzle(scratch), { migrationsFolder: "migrations" });
await scratch.end({ timeout: 5 });

// Everything below must see the scratch URL, so import the db-touching modules only now.
process.env.DATABASE_URL = SCRATCH_URL;
const { db, closeDb } = await import("../src/db/client");
const { waterDataset } = await import("../src/ingest/datasetSchema");
const { loadDatasets } = await import("../src/ingest/load");
const { app } = await import("../src/api/server");
const { sql } = await import("drizzle-orm");

type Entry = { slug: string; dir: string; ds: ReturnType<typeof waterDataset.parse> };
const dirs = readdirSync("data", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const entries: Entry[] = dirs.flatMap((dir) =>
  readdirSync(join("data", dir)).filter((f) => f.endsWith(".json")).sort().map((f) => ({
    slug: f.replace(/\.json$/, ""), dir,
    ds: waterDataset.parse(JSON.parse(readFileSync(join("data", dir, f), "utf8"))),
  })));
// Datasets load in the same dir/file order the CLI uses.
const res = await loadDatasets(db, entries.map((e) => e.ds));
console.log(`Loaded ${res.waters} waters, ${res.regulations} regulations`);

// Slugs colliding across groups (same file name) get "@<dir>" so every case key is unique.
const slugCount = new Map<string, number>();
for (const e of entries) slugCount.set(e.slug, (slugCount.get(e.slug) ?? 0) + 1);
const keyOf = (e: Entry) => (slugCount.get(e.slug)! > 1 ? `${e.slug}@${e.dir}` : e.slug);
// Deterministic order: by slug, then dir.
const sorted = [...entries].sort((a, b) => a.slug.localeCompare(b.slug, "en") || a.dir.localeCompare(b.dir));

// Resolve each file to its water id by name + coordinates (names alone are not unique).
const rows = await db.execute<{ id: number; name: string; lon: number; lat: number }>(
  sql`select id, name, st_x(geom::geometry) as lon, st_y(geom::geometry) as lat from water_body`);
const idOf = (e: Entry): number => {
  const m = [...rows].filter((r) => r.name === e.ds.water.name
    && Math.abs(Number(r.lon) - e.ds.water.lon) < 1e-6 && Math.abs(Number(r.lat) - e.ds.water.lat) < 1e-6);
  if (m.length !== 1) throw new Error(`cannot uniquely resolve ${e.dir}/${e.slug}: ${m.length} matches`);
  return Number(m[0].id);
};

async function rulesFor(e: Entry, on: string) {
  const r = await app.request(`/api/waters/${idOf(e)}/rules?on=${on}`);
  if (r.status !== 200) throw new Error(`${keyOf(e)} ${on}: HTTP ${r.status}`);
  return (await r.json()) as {
    status: { overall: ScopeStatus }; scopes: Array<{ scope: string; status: ScopeStatus }>; licenses: unknown[];
  };
}

const chosen: Entry[] = sorted.filter((e) => e.dir === "corridor");
const chosenKeys = new Set(chosen.map(keyOf));
const pick = async (label: string, n: number, pred: (e: Entry) => boolean | Promise<boolean>) => {
  let got = 0;
  for (const e of sorted) {
    if (got >= n) break;
    if (chosenKeys.has(keyOf(e)) || !(await pred(e))) continue;
    chosen.push(e); chosenKeys.add(keyOf(e)); got++;
  }
  if (got < n) throw new Error(`only found ${got}/${n} for ${label}`);
};
await pick("verifyCurrent", 6, (e) => e.ds.water.verifyCurrent);
await pick("reach-scoped", 6, (e) => e.ds.reaches.length > 0);
await pick("NV", 3, (e) => e.ds.water.states.includes("NV"));
await pick("unknown on 2026-07-01", 3, async (e) => (await rulesFor(e, "2026-07-01")).status.overall === "unknown");
// Deviation from the brief: the four sets above never yield an overall `closed` case, but the
// parity oracle needs one, so add the first water that is overall closed on 2026-01-15.
await pick("closed on 2026-01-15", 1, async (e) => (await rulesFor(e, "2026-01-15")).status.overall === "closed");

const cases: Array<{ slug: string; on: string; overall: ScopeStatus; scopes: Array<{ scope: string; status: ScopeStatus }>; licenseCount: number }> = [];
for (const e of chosen) {
  for (const on of DATES) {
    const j = await rulesFor(e, on);
    cases.push({
      slug: keyOf(e), on, overall: j.status.overall,
      scopes: j.scopes.map((s) => ({ scope: s.scope, status: s.status })), licenseCount: j.licenses.length,
    });
  }
}

const counts: Record<string, number> = {};
for (const c of cases) counts[c.overall] = (counts[c.overall] ?? 0) + 1;
console.log(`${chosen.length} waters, ${cases.length} cases; overall counts:`, counts);
const missing = (["closed", "catch_and_release", "open", "unknown"] as const).filter((s) => !counts[s]);
if (missing.length) { console.error(`missing statuses: ${missing.join(", ")}`); await closeDb(); process.exit(1); }

const keeperSha = execSync("git rev-parse HEAD").toString().trim();
mkdirSync("goldens", { recursive: true });
writeFileSync("goldens/rules-goldens.json", JSON.stringify({ keeperSha, recordedAt: new Date().toISOString(), cases }, null, 2) + "\n");
await closeDb();
