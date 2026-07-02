import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { db, closeDb } from "../db/client";
import { waterDataset } from "./datasetSchema";
import { loadDatasets } from "./load";

// Every immediate subdirectory of data/ is a dataset group (data/corridor, data/california, ...).
const dataRoot = "data";
const dirs = readdirSync(dataRoot).filter((f) => statSync(join(dataRoot, f)).isDirectory()).sort();

let fileCount = 0;
const datasets = dirs.flatMap((sub) => {
  const dir = join(dataRoot, sub);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  fileCount += files.length;
  return files.map((f) => {
    try { return waterDataset.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))); }
    catch (e) { throw new Error(`${sub}/${f}: ${e instanceof Error ? e.message : e}`); }
  });
});
const res = await loadDatasets(db, datasets);
console.log(`Loaded ${res.waters} waters, ${res.regulations} regulations from ${fileCount} files across ${dirs.length} dataset group(s) (${dirs.join(", ")}).`);
await closeDb();
