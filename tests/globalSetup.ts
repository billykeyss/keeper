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
