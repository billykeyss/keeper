import { useEffect, useState } from "react";
import {
  fetchAllSpecies,
  fetchSpeciesWaters,
  fetchStockedSpecies,
  fetchStockedWaters,
  type SpeciesWaterRow,
  type StockedWaterRow,
} from "./api";
import { CloseIcon, RetryIcon } from "./icons";

export type FishMode = "stocked" | "all";
/** A water handed up to the app on pick — the shared subset both filters return. */
export type PickedWater = { id: number; name: string; waterType: string; states: string[]; lon: number; lat: number };

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m]} ${d}, ${y}`;
}

interface SpeciesItem { commonName: string; count: number; meta: string }
interface WaterItem { id: number; name: string; waterType: string; states: string[]; lon: number; lat: number; sub: string }

interface Props {
  open: boolean;
  onClose: () => void;
  forestLands: boolean;
  blmLands: boolean;
  onToggleForest: () => void;
  onToggleBlm: () => void;
  fishMode: FishMode;
  onFishMode: (m: FishMode) => void;
  fishFilter: string | null;
  onFishFilter: (species: string | null) => void;
  onPickWater: (w: PickedWater) => void;
}

/** Unified map-layers control: land overlays (National Forest, BLM) + a fish filter that
 *  restricts pins to waters stocked-with / holding a species. One panel, one place. */
export function LayersPanel({
  open, onClose, forestLands, blmLands, onToggleForest, onToggleBlm,
  fishMode, onFishMode, fishFilter, onFishFilter, onPickWater,
}: Props) {
  const [species, setSpecies] = useState<SpeciesItem[] | null>(null);
  const [waters, setWaters] = useState<WaterItem[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  // Species list — reloads when the panel opens, the mode flips, or Retry is hit.
  useEffect(() => {
    if (!open || fishFilter) return;
    const ac = new AbortController();
    setSpecies(null);
    const load = fishMode === "stocked"
      ? fetchStockedSpecies(ac.signal).then((rows): SpeciesItem[] =>
          rows.map((s) => ({ commonName: s.commonName, count: s.watersCount,
            meta: `${s.watersCount} water${s.watersCount === 1 ? "" : "s"}${s.lastStockedOn ? ` · last ${formatDate(s.lastStockedOn)}` : ""}` })))
      : fetchAllSpecies(ac.signal).then((rows): SpeciesItem[] =>
          rows.map((s) => ({ commonName: s.commonName, count: s.waterCount,
            meta: `${s.waterCount} water${s.waterCount === 1 ? "" : "s"}${s.stockedCount ? ` · ${s.stockedCount} stocked` : ""}` })));
    load.then((rows) => { setSpecies(rows); setError(false); }).catch(() => { if (!ac.signal.aborted) setError(true); });
    return () => ac.abort();
  }, [open, fishMode, fishFilter, retry]);

  // Water list for the selected species.
  useEffect(() => {
    if (!fishFilter) { setWaters(null); return; }
    const ac = new AbortController();
    setWaters(null);
    const load = fishMode === "stocked"
      ? fetchStockedWaters(fishFilter, ac.signal).then((rows): WaterItem[] =>
          rows.map((w: StockedWaterRow) => ({ ...w, sub: w.lastStockedOn ? `last ${formatDate(w.lastStockedOn)}` : "scheduled" })))
      : fetchSpeciesWaters(fishFilter, ac.signal).then((rows): WaterItem[] =>
          rows.map((w: SpeciesWaterRow) => ({ ...w, sub: w.stocked ? "stocked here" : "present" })));
    load.then((rows) => { setWaters(rows); setError(false); }).catch(() => { if (!ac.signal.aborted) setError(true); });
    return () => ac.abort();
  }, [fishFilter, fishMode, retry]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <section className="stocked-panel layers-panel" role="dialog" aria-modal="false" aria-label="Map layers">
      <div className="stocked-head">
        <h2 className="stocked-title">Map layers</h2>
        <button className="sheet-close stocked-close" aria-label="Close" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>

      {/* --- public-land overlays --- */}
      <div className="layer-toggles">
        <button className="layer-row" role="switch" aria-checked={forestLands} onClick={onToggleForest}>
          <span className="layer-swatch layer-swatch--forest" aria-hidden="true" />
          <span className="layer-name">National forest</span>
          <span className={`layer-switch${forestLands ? " on" : ""}`} aria-hidden="true" />
        </button>
        <button className="layer-row" role="switch" aria-checked={blmLands} onClick={onToggleBlm}>
          <span className="layer-swatch layer-swatch--blm" aria-hidden="true" />
          <span className="layer-name">BLM land</span>
          <span className={`layer-switch${blmLands ? " on" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {/* --- fish filter --- */}
      <div className="layer-section-head">
        <h3 className="layer-section-title">Filter by fish</h3>
        <div className="seg" role="tablist" aria-label="Fish filter mode">
          <button role="tab" aria-selected={fishMode === "stocked"} className={`seg-btn${fishMode === "stocked" ? " on" : ""}`}
            onClick={() => { onFishMode("stocked"); onFishFilter(null); }}>Stocked</button>
          <button role="tab" aria-selected={fishMode === "all"} className={`seg-btn${fishMode === "all" ? " on" : ""}`}
            onClick={() => { onFishMode("all"); onFishFilter(null); }}>All present</button>
        </div>
      </div>

      {error && (
        <div className="stocked-error" role="alert">
          <span>Couldn’t load species.</span>
          <button className="btn-retry" onClick={() => { setError(false); setRetry((n) => n + 1); }}>
            <RetryIcon size={15} /> Retry
          </button>
        </div>
      )}

      {!fishFilter && species && (
        <ul className="stocked-list">
          {species.map((s) => (
            <li key={s.commonName}>
              <button className="stocked-row" onClick={() => onFishFilter(s.commonName)}>
                <span className="stocked-species-name">{s.commonName}</span>
                <span className="stocked-meta">{s.meta}</span>
              </button>
            </li>
          ))}
          {species.length === 0 && <li className="stocked-empty">No species recorded yet.</li>}
        </ul>
      )}

      {fishFilter && (
        <>
          <button className="stocked-back" onClick={() => onFishFilter(null)}>← All species</button>
          <p className="stocked-filter-note">
            Showing waters {fishMode === "stocked" ? "stocked with" : "that hold"} <strong>{fishFilter}</strong>
          </p>
          <ul className="stocked-list">
            {(waters ?? []).map((w) => (
              <li key={w.id}>
                <button className="stocked-row" onClick={() => onPickWater(w)}>
                  <span className="stocked-species-name">{w.name}</span>
                  <span className="stocked-meta">{w.states.join("·")} · {w.sub}</span>
                </button>
              </li>
            ))}
            {waters === null && !error && <li className="stocked-empty">Loading…</li>}
          </ul>
        </>
      )}

      {!fishFilter && species === null && !error && <p className="stocked-empty">Loading…</p>}
    </section>
  );
}
