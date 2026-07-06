import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchRecentStocking,
  fetchStockedSpecies,
  type RecentStockingRow,
  type StockedSpeciesRow,
} from "./api";
import { CloseIcon, ExternalIcon } from "./icons";

const PAGE = 60;
const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m]} ${d}`;
}
function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m]} ${y}`;
}

/** Only ever hand an http(s) URL to an <a href> (source URLs are data, not fully trusted). */
function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Group a newest-first event list into ordered month buckets (YYYY-MM), preserving order. */
function byMonth(events: RecentStockingRow[]): { ym: string; rows: RecentStockingRow[] }[] {
  const groups: { ym: string; rows: RecentStockingRow[] }[] = [];
  for (const e of events) {
    const ym = e.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.ym === ym) last.rows.push(e);
    else groups.push({ ym, rows: [e] });
  }
  return groups;
}

export interface StockWaterPick {
  id: number;
  name: string;
  waterType: string;
  states: string[];
  lon: number;
  lat: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Species filter (drives the feed + the shareable URL); null = all species. */
  species: string | null;
  onSpeciesChange: (species: string | null) => void;
  /** Open a water's rules sheet (also closes this page). */
  onOpenWater: (w: StockWaterPick) => void;
}

export function StockingPage({ open, onClose, species, onSpeciesChange, onOpenWater }: Props) {
  const [events, setEvents] = useState<RecentStockingRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [speciesOpts, setSpeciesOpts] = useState<StockedSpeciesRow[] | null>(null);

  const eventsRef = useRef<RecentStockingRow[]>([]);
  eventsRef.current = events;
  const loadingRef = useRef(false);

  const load = useCallback(async (reset: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(false);
    const offset = reset ? 0 : eventsRef.current.length;
    try {
      const res = await fetchRecentStocking({ species, limit: PAGE, offset });
      setEvents((prev) => (reset ? res.events : [...prev, ...res.events]));
      setHasMore(res.hasMore);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [species]);

  // (Re)load the first page when the page opens or the species filter changes.
  useEffect(() => {
    if (!open) return;
    void load(true);
  }, [open, load]);

  // Populate the species dropdown once.
  useEffect(() => {
    if (!open || speciesOpts !== null) return;
    const ac = new AbortController();
    fetchStockedSpecies(ac.signal).then(setSpeciesOpts).catch(() => { if (!ac.signal.aborted) setSpeciesOpts([]); });
    return () => ac.abort();
  }, [open, speciesOpts]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const groups = byMonth(events);

  return (
    <section className="stock-screen" role="dialog" aria-modal="true" aria-label="Stocking history">
      <header className="stock-topbar">
        <div className="stock-head-titles">
          <span className="stock-brand">Stocking history</span>
          <span className="stock-sub">CA·NV — most recent first</span>
        </div>
        <button className="stock-x" aria-label="Close stocking history" onClick={onClose}>
          <CloseIcon size={20} />
        </button>
      </header>

      <div className="stock-filterbar">
        <label className="stock-filter">
          <span className="stock-filter-label">Fish</span>
          <select
            className="stock-select"
            value={species ?? ""}
            onChange={(e) => onSpeciesChange(e.target.value || null)}
          >
            <option value="">All species</option>
            {/* Only species with dated events — schedule-only species would yield an empty feed. */}
            {(speciesOpts ?? []).filter((s) => s.eventCount > 0).map((s) => (
              <option key={s.commonName} value={s.commonName}>
                {s.commonName} ({s.eventCount})
              </option>
            ))}
          </select>
        </label>
        {species && (
          <button className="stock-clear" onClick={() => onSpeciesChange(null)}>Clear filter</button>
        )}
      </div>

      <div className="stock-body">
        {error && events.length === 0 && (
          <div className="stock-error" role="alert">
            <span>Couldn’t load stocking history.</span>
            <button className="btn-retry" onClick={() => void load(true)}>Retry</button>
          </div>
        )}

        {groups.map((g) => (
          <div key={g.ym} className="stock-group">
            <h3 className="stock-month">{fmtMonth(g.ym)}</h3>
            <ul className="stock-list">
              {g.rows.map((e) => {
                const href = safeHref(e.sourceUrl);
                return (
                  <li key={e.id} className="stock-row">
                    <button
                      className="stock-row-main"
                      onClick={() => onOpenWater({
                        id: e.waterId, name: e.waterName, waterType: e.waterType,
                        states: e.states, lon: e.lon, lat: e.lat,
                      })}
                      title={`Open ${e.waterName}`}
                    >
                      <span className="stock-date">{fmtDay(e.date)}</span>
                      <span className="stock-water">
                        {e.waterName}
                        {e.states.length > 0 && <span className="stock-states"> {e.states.join("·")}</span>}
                      </span>
                      <span className="stock-species">{e.species}</span>
                      {(e.quantity != null || e.sizeNote) && (
                        <span className="stock-qty">
                          {e.quantity != null ? `~${e.quantity.toLocaleString()}` : ""}
                          {e.quantity != null && e.sizeNote ? " · " : ""}
                          {e.sizeNote ?? ""}
                        </span>
                      )}
                    </button>
                    {href && (
                      <a className="stock-source" href={href} target="_blank" rel="noreferrer noopener">
                        Source <ExternalIcon />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {loading && <div className="stock-loading">Loading…</div>}
        {!loading && !error && events.length === 0 && (
          <p className="stock-empty">No stocking records{species ? ` for ${species}` : ""} yet.</p>
        )}
        {hasMore && !loading && (
          <button className="stock-more" onClick={() => void load(false)}>Load more</button>
        )}
      </div>
    </section>
  );
}
