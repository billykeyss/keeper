import { waterDataset } from "../ingest/datasetSchema";
import type { SourceRole } from "./severity";

export interface SourceEntry {
  /** Repo-relative path of the water file this source was declared in. */
  file: string;
  waterName: string;
  key: string;
  url: string;
  title: string;
  documentType: string;
  instrumentType: string;
  authorityLevel: string;
  authorityKey: string;
  retrievedDate: string;
  quotedText: string | null;
  role: SourceRole;
  /** Citations of the regulations that cite this source, for the report. */
  citations: string[];
}

export interface IndexResult {
  entries: SourceEntry[];
  /** Set when the file does not satisfy `waterDataset`; itself a finding. */
  error?: string;
  /** authorityKeys referenced but absent from the file's `authorities` array. */
  undeclaredAuthorityKeys: string[];
}

/**
 * Turn one parsed water file into per-source entries, using the same
 * `waterDataset` schema the ingest path uses. Pure: no fs, no network.
 */
export function indexWaterFile(file: string, raw: unknown): IndexResult {
  const parsed = waterDataset.safeParse(raw);
  if (!parsed.success) {
    return { entries: [], error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), undeclaredAuthorityKeys: [] };
  }
  const data = parsed.data;

  const roles = new Map<string, SourceRole>();
  const citations = new Map<string, string[]>();
  const note = (key: string, role: SourceRole, citation: string) => {
    // primary outranks corroborating when a source is cited both ways.
    if (role === "primary" || !roles.has(key)) roles.set(key, role);
    const list = citations.get(key) ?? [];
    if (!list.includes(citation)) list.push(citation);
    citations.set(key, list);
  };

  for (const reg of data.regulations) {
    note(reg.sourceKeys.primary, "primary", reg.citation);
    for (const k of reg.sourceKeys.corroborating) note(k, "corroborating", reg.citation);
  }

  const declared = new Set(data.authorities.map((a) => a.key));
  const undeclared = new Set<string>();
  for (const s of data.sources) if (!declared.has(s.authorityKey)) undeclared.add(s.authorityKey);
  for (const r of data.regulations) if (!declared.has(r.authorityKey)) undeclared.add(r.authorityKey);

  const entries: SourceEntry[] = data.sources.map((s) => ({
    file,
    waterName: data.water.name,
    key: s.key, url: s.url, title: s.title,
    documentType: s.documentType, instrumentType: s.instrumentType,
    authorityLevel: s.authorityLevel, authorityKey: s.authorityKey,
    retrievedDate: s.retrievedDate, quotedText: s.quotedText,
    role: roles.get(s.key) ?? "unreferenced",
    citations: citations.get(s.key) ?? [],
  }));

  return { entries, undeclaredAuthorityKeys: [...undeclared] };
}
