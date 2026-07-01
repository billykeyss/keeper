import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://fl:fl@localhost:5433/fishing_law";
export const queryClient = postgres(url, { max: 5 });
export const db = drizzle(queryClient);
export async function closeDb() { await queryClient.end({ timeout: 5 }); }
