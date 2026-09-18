import type { SourceEntry } from "./load";

export interface PlanOptions {
  /** Restrict the run to a single host. */
  host?: string;
  /** Cap the number of unique URLs fetched. */
  limit?: number;
}

export interface FetchPlan {
  /** Unique URLs to fetch, in stable order. */
  urls: string[];
  /** URLs grouped by host, so each host is fetched serially and politely. */
  byHost: Map<string, string[]>;
  /** Every source entry citing a given URL. */
  entriesByUrl: Map<string, SourceEntry[]>;
}

const hostOf = (url: string): string => {
  try { return new URL(url).host; } catch { return "invalid"; }
};

/**
 * Collapse 5,006 source entries onto their ~1,370 unique URLs.
 *
 * Fetching per unique URL rather than per source is the difference between a
 * polite weekly run and hammering NDOW with the same PDF a dozen times.
 */
export function planFetches(entries: SourceEntry[], { host, limit }: PlanOptions): FetchPlan {
  const entriesByUrl = new Map<string, SourceEntry[]>();
  for (const e of entries) {
    if (host && hostOf(e.url) !== host) continue;
    const list = entriesByUrl.get(e.url) ?? [];
    list.push(e);
    entriesByUrl.set(e.url, list);
  }

  let urls = [...entriesByUrl.keys()];
  if (limit !== undefined && limit >= 0) {
    urls = urls.slice(0, limit);
    for (const u of [...entriesByUrl.keys()]) if (!urls.includes(u)) entriesByUrl.delete(u);
  }

  const byHost = new Map<string, string[]>();
  for (const u of urls) {
    const h = hostOf(u);
    const list = byHost.get(h) ?? [];
    list.push(u);
    byHost.set(h, list);
  }

  return { urls, byHost, entriesByUrl };
}
