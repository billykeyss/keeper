import { describe, expect, test } from "vitest";
import { buildReport, renderMarkdown, exitCodeFor } from "../../src/verify/report";
import type { Finding } from "../../src/verify/report";

const finding = (over: Partial<Finding> = {}): Finding => ({
  file: "data/corridor/battle-born-pond.json", waterName: "Battle Born Pond",
  key: "s_cr2516", url: "https://www.ndow.org/cr-25-16.pdf", title: "CR 25-16",
  instrumentType: "commission_reg", role: "primary", cls: "MISSING", severity: "HIGH",
  citations: ["NBWC CR 25-16"], quotedText: "Daily: 3 game fish.",
  snippet: "daily: 5 game fish", docChanged: true, ...over,
});

describe("buildReport", () => {
  test("counts findings by class and by severity", () => {
    const r = buildReport([
      finding(),
      finding({ key: "b", cls: "EXACT", severity: "NONE" }),
      finding({ key: "c", cls: "EXACT", severity: "NONE" }),
      finding({ key: "d", cls: "UNREACHABLE", severity: "MEDIUM", role: "corroborating" }),
    ], { files: 1, uniqueUrls: 4 });
    expect(r.counts.byClass).toMatchObject({ MISSING: 1, EXACT: 2, UNREACHABLE: 1 });
    expect(r.counts.bySeverity).toMatchObject({ HIGH: 1, MEDIUM: 1 });
  });

  test("records the totals it was given", () => {
    const r = buildReport([finding()], { files: 776, uniqueUrls: 1370 });
    expect(r.totals).toMatchObject({ files: 776, uniqueUrls: 1370, sources: 1 });
  });

  test("orders findings HIGH first, then MEDIUM, then LOW", () => {
    const r = buildReport([
      finding({ key: "low", severity: "LOW" }),
      finding({ key: "high", severity: "HIGH" }),
      finding({ key: "med", severity: "MEDIUM" }),
    ], { files: 1, uniqueUrls: 3 });
    expect(r.findings.map((f) => f.key)).toEqual(["high", "med", "low"]);
  });

  test("omits healthy sources from findings — only actionable ones are listed", () => {
    const r = buildReport([finding(), finding({ key: "ok", cls: "EXACT", severity: "NONE" })],
      { files: 1, uniqueUrls: 2 });
    expect(r.findings.map((f) => f.key)).toEqual(["s_cr2516"]);
  });
});

describe("renderMarkdown", () => {
  test("groups findings under their water and shows url, key, citation, quote and snippet", () => {
    const md = renderMarkdown(buildReport([finding()], { files: 1, uniqueUrls: 1 }));
    expect(md).toContain("Battle Born Pond");
    expect(md).toContain("https://www.ndow.org/cr-25-16.pdf");
    expect(md).toContain("s_cr2516");
    expect(md).toContain("NBWC CR 25-16");
    expect(md).toContain("Daily: 3 game fish.");
    expect(md).toContain("daily: 5 game fish");
  });

  test("states plainly when nothing is actionable", () => {
    const md = renderMarkdown(buildReport([finding({ cls: "EXACT", severity: "NONE" })],
      { files: 1, uniqueUrls: 1 }));
    expect(md).toMatch(/no actionable findings/i);
  });
});

describe("exitCodeFor", () => {
  test("clean run exits 0", () => {
    expect(exitCodeFor(buildReport([finding({ cls: "EXACT", severity: "NONE" })], { files: 1, uniqueUrls: 1 }))).toBe(0);
  });

  test("LOW-only run exits 0 — volatile webpages must not fail the run", () => {
    expect(exitCodeFor(buildReport([finding({ severity: "LOW" })], { files: 1, uniqueUrls: 1 }))).toBe(0);
  });

  test("any MEDIUM exits 2", () => {
    expect(exitCodeFor(buildReport([finding({ severity: "MEDIUM" })], { files: 1, uniqueUrls: 1 }))).toBe(2);
  });

  test("any HIGH exits 2", () => {
    expect(exitCodeFor(buildReport([finding()], { files: 1, uniqueUrls: 1 }))).toBe(2);
  });
});
