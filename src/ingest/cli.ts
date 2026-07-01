import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db, closeDb } from "../db/client";
import { waterDataset } from "./datasetSchema";
import { loadDatasets } from "./load";

const dir = "data/corridor";
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const datasets = files.map((f) => {
  try { return waterDataset.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))); }
  catch (e) { throw new Error(`${f}: ${e instanceof Error ? e.message : e}`); }
});
const res = await loadDatasets(db, datasets);
console.log(`Loaded ${res.waters} waters, ${res.regulations} regulations from ${files.length} files.`);
await closeDb();
