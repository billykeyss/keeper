import { useEffect, useRef, useState } from "react";
import { searchWatersByName, type WaterSearchRow } from "./api";
import { CloseIcon } from "./icons";

const WATER_TYPE_LABEL: Record<string, string> = {
  lake: "Lake", reservoir: "Reservoir", river: "River", stream: "Stream",
  creek: "Creek", pond: "Pond", marina: "Marina", impoundment: "Impoundment",
};

interface Props {
  onPick: (water: WaterSearchRow) => void;
  /** Mobile bottom-sheet variant (rendered from the dock): inline results, own header/close. */
  asSheet?: boolean;
  onClose?: () => void;
}

/** Debounced name/alias/county search. Desktop: overlay input with a dropdown.
 *  Mobile (asSheet): a bottom sheet with the input up top and inline results.
 *  Picking a result clears the box and hands the water to the app (fly-to + rules sheet). */
export function WaterSearch({ onPick, asSheet = false, onClose }: Props) {
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

  // Overlay variant: close the dropdown on outside click or Escape. Sheet variant:
  // Escape closes the whole sheet via onClose.
  useEffect(() => {
    if (asSheet) {
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
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
  }, [open, asSheet, onClose]);

  const pick = (w: WaterSearchRow) => {
    setQ("");
    setResults(null);
    setOpen(false);
    onPick(w);
  };

  const resultsList = (rows: WaterSearchRow[]) => (
    <ul className={asSheet ? "search-sheet-results" : "water-search-results"} role="listbox">
      {rows.map((w) => (
        <li key={w.id}>
          <button className="stocked-row" role="option" onClick={() => pick(w)}>
            <span className="stocked-species-name">{w.name}</span>
            <span className="stocked-meta">
              {WATER_TYPE_LABEL[w.waterType] ?? w.waterType} · {w.counties[0] ?? w.states.join("·")}
            </span>
          </button>
        </li>
      ))}
      {rows.length === 0 && (
        <li className="stocked-empty">No waters match — Keeper covers CA/NV waters with special regulations.</li>
      )}
    </ul>
  );

  if (asSheet) {
    return (
      <section className="search-sheet" role="dialog" aria-modal="false" aria-label="Search waters">
        <div className="stocked-head">
          <h2 className="stocked-title">Find a water</h2>
          <button className="sheet-close stocked-close" aria-label="Close search" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>
        <input
          className="water-search-input search-sheet-input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Lake, creek, or county…"
          aria-label="Search waters by name"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        {results ? resultsList(results) : (
          <p className="stocked-empty">Type at least two letters to search by name, alias, or county.</p>
        )}
      </section>
    );
  }

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
      {open && results && resultsList(results)}
    </div>
  );
}
