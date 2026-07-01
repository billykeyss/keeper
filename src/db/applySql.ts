import { readFileSync } from "node:fs";
import { queryClient } from "./client";

// Run a raw SQL file that may contain multiple `;`-separated statements.
// drizzle's db.execute()/sql.raw() uses the extended (prepared) protocol, which
// only permits a single statement per call. postgres.js `unsafe()` with no
// parameters uses the simple query protocol, which executes every statement in
// the file, so we route multi-statement DDL files (functions + triggers) here.
export async function applySqlFile(path: string) {
  await queryClient.unsafe(readFileSync(path, "utf8"));
}
