#!/usr/bin/env tsx
/**
 * verify:sources — re-check every cited source against its live document.
 *
 * Deterministic and model-free: it fetches, extracts, normalizes and compares,
 * then writes a report. It never edits data files, never touches a database,
 * and never bumps retrievedDate on a passing source.
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { indexWaterFile, type SourceEntry } from "./load";
import { planFetches } from "./plan";
import { fetchDocument } from "./fetch";
import { readCache, writeCache } from "./cache";
import { classifyQuote } from "./match";
import { severityFor } from "./severity";
import { buildReport, renderMarkdown, exitCodeFor, type Finding } from "./report";

const DATA_DIRS = ["data/corridor", "data/california", "data/nevada"];
const DELAY_MS = 1200; // between requests to the same host

interface Args { only?: string; host?: string; limit?: number; out: string; dump?: string }

function parseArgs(argv: string[]): Args {
  const args: Args = { out: "verify-out" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") args.only = argv[++i];
    else if (a === "--host") args.host = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--dump") args.dump = argv[++i];
  }
  return args;
}

async function jsonFilesUnder(target: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = join(dir, it.name);
      if (it.isDirectory()) await walk(p);
      else if (it.name.endsWith(".json")) out.push(p);
    }
  };
  if (target.endsWith(".json")) out.push(target); else await walk(target);
  return out.sort();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  // --dump lets a bot read a source's current text without curl or pdftotext.
  if (args.dump) {
    const cached = await readCache(args.dump);
    const res = await fetchDocument(args.dump, { cached });
    if (!res.ok) { process.stderr.write(`UNREACHABLE: ${res.error}\n`); return 1; }
    process.stdout.write(res.text + "\n");
    return 0;
  }

  const targets = args.only ? [args.only] : DATA_DIRS;
  const files: string[] = [];
  for (const t of targets) files.push(...await jsonFilesUnder(t));

  const entries: SourceEntry[] = [];
  const schemaFindings: Finding[] = [];
  for (const file of files) {
    const rel = relative(process.cwd(), file);
    let raw: unknown;
    try { raw = JSON.parse(await readFile(file, "utf8")); }
    catch (e) { schemaFindings.push(schemaFinding(rel, `unparseable JSON: ${String(e)}`)); continue; }

    const { entries: es, error, undeclaredAuthorityKeys } = indexWaterFile(rel, raw);
    if (error) { schemaFindings.push(schemaFinding(rel, `schema: ${error}`)); continue; }
    for (const k of undeclaredAuthorityKeys) {
      schemaFindings.push(schemaFinding(rel, `authorityKey "${k}" is referenced but not declared in this file's authorities array`));
    }
    entries.push(...es);
  }

  const plan = planFetches(entries, { host: args.host, limit: args.limit });
  process.stderr.write(`${files.length} files, ${entries.length} sources, ${plan.urls.length} unique URLs across ${plan.byHost.size} hosts\n`);

  const results = new Map<string, Awaited<ReturnType<typeof fetchDocument>> & { changed?: boolean }>();
  let done = 0;
  // Hosts in parallel, URLs within a host strictly serial with a delay.
  await Promise.all([...plan.byHost.entries()].map(async ([, urls]) => {
    for (const url of urls) {
      const cached = await readCache(url);
      const res = await fetchDocument(url, { cached });
      results.set(url, res);
      if (res.ok) await writeCache(url, { hash: res.hash, text: res.text });
      if (++done % 25 === 0) process.stderr.write(`  fetched ${done}/${plan.urls.length}\n`);
      await sleep(DELAY_MS);
    }
  }));

  const findings: Finding[] = [...schemaFindings];
  for (const [url, res] of results) {
    for (const e of plan.entriesByUrl.get(url) ?? []) {
      const base = {
        file: e.file, waterName: e.waterName, key: e.key, url: e.url, title: e.title,
        instrumentType: e.instrumentType, role: e.role, citations: e.citations,
        quotedText: e.quotedText,
      };
      if (!res.ok) {
        findings.push({ ...base, cls: "UNREACHABLE", errorText: res.error,
          severity: severityFor({ cls: "UNREACHABLE", instrumentType: e.instrumentType, role: e.role, authorityLevel: e.authorityLevel }) });
        continue;
      }
      const m = classifyQuote(e.quotedText, res.text);
      findings.push({ ...base, cls: m.cls, snippet: m.snippet, docChanged: res.changed,
        severity: severityFor({ cls: m.cls, instrumentType: e.instrumentType, role: e.role, authorityLevel: e.authorityLevel }) });
    }
  }

  const report = buildReport(findings, { files: files.length, uniqueUrls: plan.urls.length });
  await mkdir(args.out, { recursive: true });
  await writeFile(join(args.out, "report.json"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(join(args.out, "report.md"), renderMarkdown(report), "utf8");
  process.stderr.write(`\nreport: ${join(args.out, "report.md")}\n`);
  return exitCodeFor(report);
}

function schemaFinding(file: string, message: string): Finding {
  return {
    file, waterName: file, key: "(file)", url: "", title: "dataset file",
    instrumentType: "commission_reg", role: "primary", cls: "MISSING",
    severity: "HIGH", citations: [], quotedText: null, errorText: message,
  };
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`verify:sources crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
