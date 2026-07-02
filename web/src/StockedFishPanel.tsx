import { useEffect, useState } from "react";
import {
  fetchStockedSpecies,
  fetchStockedWaters,
  type StockedSpeciesRow,
  type StockedWaterRow,
} from "./api";
import { CloseIcon, RetryIcon } from "./icons";

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m]} ${d}, ${y}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  activeFilter: string | null;
  onFilter: (species: string | null) => void;
  onPickWater: (water: StockedWaterRow) => void;
}

/** Ledger-styled browser for source-backed stocking records: species list -> waters stocked
 *  with the selected species. Selecting a species also filters the map via onFilter. */
export function StockedFishPanel({ open, onClose, activeFilter, onFilter, onPickWater }: Props) {
  const [species, setSpecies] = useState<StockedSpeciesRow[] | null>(null);
  const [waters, setWaters] = useState<StockedWaterRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || species) return;
    const ac = new AbortController();
    fetchStockedSpecies(ac.signal)
      .then((rows) => { setSpecies(rows); setError(false); })
      .catch(() => { if (!ac.signal.aborted) setError(true); });
    return () => ac.abort();
  }, [open, species]);

  useEffect(() => {
    if (!activeFilter) { setWaters(null); return; }
    const ac = new AbortController();
    setWaters(null);
    fetchStockedWaters(activeFilter, ac.signal)
      .then((rows) => setWaters(rows))
      .catch(() => { if (!ac.signal.aborted) setError(true); });
    return () => ac.abort();
  }, [activeFilter]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <section className="stocked-panel" role="dialog" aria-modal="false" aria-label="Stocked fish browser">
      <div className="stocked-head">
        <h2 className="stocked-title">Stocked fish</h2>
        <button className="sheet-close stocked-close" aria-label="Close" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>

      {error && (
        <div className="stocked-error" role="alert">
          <span>Couldn’t load stocking data.</span>
          <button className="btn-retry" onClick={() => { setError(false); setSpecies(null); }}>
            <RetryIcon size={15} /> Retry
          </button>
        </div>
      )}

      {!activeFilter && species && (
        <ul className="stocked-list">
          {species.map((s) => (
            <li key={s.commonName}>
              <button className="stocked-row" onClick={() => onFilter(s.commonName)}>
                <span className="stocked-species-name">{s.commonName}</span>
                <span className="stocked-meta">
                  {s.watersCount} water{s.watersCount === 1 ? "" : "s"}
                  {s.lastStockedOn ? ` · last ${formatDate(s.lastStockedOn)}` : ""}
                </span>
              </button>
            </li>
          ))}
          {species.length === 0 && <li className="stocked-empty">No stocking records yet.</li>}
        </ul>
      )}

      {activeFilter && (
        <>
          <button className="stocked-back" onClick={() => onFilter(null)}>
            ← All species
          </button>
          <p className="stocked-filter-note">
            Showing waters stocked with <strong>{activeFilter}</strong>
          </p>
          <ul className="stocked-list">
            {(waters ?? []).map((w) => (
              <li key={w.id}>
                <button className="stocked-row" onClick={() => onPickWater(w)}>
                  <span className="stocked-species-name">{w.name}</span>
                  <span className="stocked-meta">
                    {w.states.join("·")}
                    {w.lastStockedOn ? ` · last ${formatDate(w.lastStockedOn)}` : " · scheduled"}
                  </span>
                </button>
              </li>
            ))}
            {waters === null && !error && <li className="stocked-empty">Loading…</li>}
          </ul>
        </>
      )}

      {!activeFilter && species === null && !error && <p className="stocked-empty">Loading…</p>}
    </section>
  );
}
