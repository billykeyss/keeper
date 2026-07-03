import { useEffect, useRef, useState } from "react";
import { searchWatersByName, type WaterSearchRow } from "./api";

const WATER_TYPE_LABEL: Record<string, string> = {
  lake: "Lake", reservoir: "Reservoir", river: "River", stream: "Stream",
  creek: "Creek", pond: "Pond", marina: "Marina", impoundment: "Impoundment",
};

interface Props {
  onPick: (water: WaterSearchRow) => void;
}

/** Debounced name/alias/county search box for the map overlay. Picking a result
 *  clears the box and hands the water to the app (fly-to + open its rules sheet). */
export function WaterSearch({ onPick }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<WaterSearchRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults(null); setOpen(false); return; }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      searchWatersByName(query, ac.signal)
        .then((rows) => { setResults(rows); setOpen(true); })
        .catch(() => { if (!ac.signal.aborted) { setResults([]); setOpen(true); } });
    }, 250);
    return () => { window.clearTimeout(t); ac.abort(); };
  }, [q]);

  // Close the dropdown on outside click or Escape (without stealing Escape from other overlays
  // when the dropdown is already closed).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (w: WaterSearchRow) => {
    setQ("");
    setResults(null);
    setOpen(false);
    onPick(w);
  };

  return (
    <div className="water-search" ref={rootRef}>
      <input
        className="water-search-input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (results) setOpen(true); }}
        placeholder="Find a lake or creek…"
        aria-label="Search waters by name"
        autoComplete="off"
        spellCheck={false}
      />
      {open && results && (
        <ul className="water-search-results" role="listbox">
          {results.map((w) => (
            <li key={w.id}>
              <button className="stocked-row" role="option" onClick={() => pick(w)}>
                <span className="stocked-species-name">{w.name}</span>
                <span className="stocked-meta">
                  {WATER_TYPE_LABEL[w.waterType] ?? w.waterType} · {w.counties[0] ?? w.states.join("·")}
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="stocked-empty">No waters match — Keeper covers CA/NV waters with special regulations.</li>
          )}
        </ul>
      )}
    </div>
  );
}
