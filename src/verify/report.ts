import type { FindingClass, Severity, SourceRole } from "./severity";

export interface Finding {
  file: string;
  waterName: string;
  key: string;
  url: string;
  title: string;
  instrumentType: string;
  role: SourceRole;
  cls: FindingClass;
  severity: Severity;
  citations: string[];
  quotedText: string | null;
  /** Closest passage in the current document, for MISSING findings. */
  snippet?: string;
  /** True when the document's content hash moved since the last run. */
  docChanged?: boolean;
  /** Set for UNREACHABLE: the network or HTTP error. */
  errorText?: string;
}

export interface Totals { files: number; uniqueUrls: number; sources: number }

export interface Report {
  generatedAt: string;
  totals: Totals;
  counts: { byClass: Record<string, number>; bySeverity: Record<string, number> };
  /** Actionable findings only, most severe first. */
  findings: Finding[];
}

const RANK: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };

export function buildReport(all: Finding[], totals: Omit<Totals, "sources">): Report {
  const byClass: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const f of all) {
    byClass[f.cls] = (byClass[f.cls] ?? 0) + 1;
    if (f.severity !== "NONE") bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  }
  const findings = all
    .filter((f) => f.severity !== "NONE")
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.waterName.localeCompare(b.waterName));

  return {
    generatedAt: new Date().toISOString(),
    totals: { ...totals, sources: all.length },
    counts: { byClass, bySeverity },
    findings,
  };
}

/** 0 when clean or LOW only, 2 when anything HIGH or MEDIUM needs a human. */
export function exitCodeFor(report: Report): number {
  const { HIGH = 0, MEDIUM = 0 } = report.counts.bySeverity;
  return HIGH + MEDIUM > 0 ? 2 : 0;
}

export function renderMarkdown(report: Report): string {
  const { totals, counts, findings } = report;
  const out: string[] = [
    "# Source verification report",
    "",
    `Generated ${report.generatedAt}`,
    "",
    `- Files: ${totals.files}`,
    `- Sources checked: ${totals.sources}`,
    `- Unique URLs fetched: ${totals.uniqueUrls}`,
    "",
    "## Counts",
    "",
    "| Class | Count |",
    "| --- | --- |",
    ...Object.entries(counts.byClass).sort().map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "| Severity | Count |",
    "| --- | --- |",
    ...(["HIGH", "MEDIUM", "LOW"] as const).map((s) => `| ${s} | ${counts.bySeverity[s] ?? 0} |`),
    "",
  ];

  if (findings.length === 0) {
    out.push("No actionable findings.", "");
    return out.join("\n");
  }

  out.push("## Findings", "");
  let water = "";
  for (const f of findings) {
    if (f.waterName !== water) {
      water = f.waterName;
      out.push(`### ${water}`, "", `\`${f.file}\``, "");
    }
    out.push(
      `- **${f.severity} / ${f.cls}** - \`${f.key}\` (${f.role}, ${f.instrumentType})${f.docChanged ? " - document changed since last run" : ""}`,
      `  - URL: ${f.url}`,
      `  - Regulations: ${f.citations.length ? f.citations.join("; ") : "(none)"}`,
    );
    if (f.quotedText !== null) out.push(`  - Recorded quote: ${f.quotedText}`);
    if (f.snippet) out.push(`  - Closest text now: ${f.snippet}`);
    if (f.errorText) out.push(`  - Error: ${f.errorText}`);
    out.push("");
  }
  return out.join("\n");
}
