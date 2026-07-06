import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { MapView } from "./Map";
import { RulesSheet } from "./RulesSheet";
import { LayersPanel, type FishMode, type PickedWater } from "./LayersPanel";
import { StockingPage } from "./StockingPage";
import { WaterSearch } from "./WaterSearch";
import { ChatIcon, FishIcon, LayersIcon, SearchIcon } from "./icons";
import { fetchRules, getWaterById, searchWatersByName, type WaterPin, type ScopeStatus, type WaterSearchRow } from "./api";
import { parseUrlState, serializeUrlState } from "./urlState";

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// One floating panel open at a time — panel pile-ups were the main source of overlap.
// "search" is only reachable from the mobile dock (desktop search is inline).
// "stock" is the full-screen statewide stocking-history feed.
type OpenPanel = null | "search" | "layers" | "chat" | "stock";

export function App() {
  const [selected, setSelected] = useState<WaterPin | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<ScopeStatus | null>(null);
  const [focusScope, setFocusScope] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number } | null>(null);
  // A river section (reach) the user tapped in the rules sheet — highlighted + zoomed on the map.
  const [highlightReach, setHighlightReach] = useState<
    { id: number; line: [number, number][] | null; point: [number, number] | null } | null
  >(null);

  // Map layers (all live in the Layers panel now).
  const [forestLands, setForestLands] = useState(false);
  const [blmLands, setBlmLands] = useState(false);
  const [fishMode, setFishMode] = useState<FishMode>("stocked");
  const [fishFilter, setFishFilter] = useState<string | null>(null);
  // Species filter inside the full-screen stocking feed (null = all species).
  const [stockSpecies, setStockSpecies] = useState<string | null>(null);

  const togglePanel = useCallback((panel: OpenPanel) => {
    setOpenPanel((p) => (p === panel ? null : panel));
  }, []);

  const handleSelect = useCallback((pin: WaterPin, scope?: string) => {
    setSelected(pin);
    setSelectedStatus(null); // reset until rules resolve
    setFocusScope(scope ?? null);
    setHighlightReach(null); // a new water clears any prior section highlight
    // Diving into a water clears panel clutter; on desktop an open chat stays (it floats
    // beside the sheet), on mobile everything yields to the rules sheet.
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    setOpenPanel((p) => (isDesktop && p === "chat" ? p : null));
  }, []);

  const handleStatus = useCallback((_id: number, status: ScopeStatus) => {
    setSelectedStatus(status);
  }, []);

  const handleClose = useCallback(() => {
    setSelected(null);
    setSelectedStatus(null);
    setHighlightReach(null);
  }, []);

  // Tapping a river section toggles its highlight; tapping the same one again clears it.
  const handleSelectReach = useCallback(
    (reachId: number, geom: { line: [number, number][] | null; point: [number, number] | null }) => {
      setHighlightReach((cur) => (cur?.id === reachId ? null : { id: reachId, ...geom }));
    },
    [],
  );

  const handlePickWater = useCallback((w: PickedWater | WaterSearchRow) => {
    setFlyTo({ lon: w.lon, lat: w.lat });
    setOpenPanel(null);
    handleSelect({
      id: w.id, name: w.name, waterType: w.waterType, states: w.states,
      lon: w.lon, lat: w.lat, verifyCurrent: false, ruleCount: 0,
    });
  }, [handleSelect]);

  // Chat cards fly-to by name (the card data doesn't carry coordinates) — resolve the exact
  // water via search, then fly + open its rules sheet.
  const handleOpenWaterByName = useCallback(async (name: string) => {
    try {
      const rows = await searchWatersByName(name);
      const hit = rows.find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? rows[0];
      if (hit) handlePickWater(hit);
    } catch {
      /* best-effort: a failed lookup just doesn't navigate */
    }
  }, [handlePickWater]);

  // Gates the URL-sync effect so it never overwrites the incoming deep link before restore runs.
  const didInitRef = useRef(false);

  // Restore shareable state from the URL on first load (deep link → view).
  useEffect(() => {
    const s = parseUrlState(window.location.search);
    if (s.forest) setForestLands(true);
    if (s.blm) setBlmLands(true);
    if (s.fish) { setFishMode(s.mode); setFishFilter(s.fish); }
    if (s.stock) { setStockSpecies(s.stockFish); setOpenPanel("stock"); }
    if (s.water == null) { didInitRef.current = true; return; }
    const waterId = s.water;
    const sectionId = s.section;
    let cancelled = false;
    void (async () => {
      try {
        const pin = await getWaterById(waterId);
        if (cancelled || !pin) return;
        handlePickWater(pin); // opens the rules sheet + centres the map
        if (sectionId != null) {
          const rules = await fetchRules(waterId, todayISO());
          if (cancelled) return;
          const sc = rules.scopes.find(
            (sp) => sp.reachId === sectionId && (((sp.line?.length ?? 0) > 0) || sp.point != null),
          );
          if (sc) setHighlightReach({ id: sectionId, line: sc.line, point: sc.point });
        }
      } catch {
        /* stale/invalid link — degrade gracefully */
      } finally {
        if (!cancelled) didInitRef.current = true;
      }
    })();
    return () => { cancelled = true; };
    // Mount-only restore; handlePickWater is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL in sync with the view so every state is a shareable link.
  useEffect(() => {
    if (!didInitRef.current) return;
    const url = serializeUrlState({
      water: selected?.id ?? null,
      section: highlightReach?.id ?? null,
      fish: fishFilter,
      mode: fishMode,
      forest: forestLands,
      blm: blmLands,
      stock: openPanel === "stock",
      stockFish: stockSpecies,
    });
    window.history.replaceState(null, "", url);
  }, [selected, highlightReach, fishFilter, fishMode, forestLands, blmLands, openPanel, stockSpecies]);

  const sheetOpen = selected != null;
  const layersActive = forestLands || blmLands || fishFilter != null;
  // The map takes both filters; only the active-mode one is non-null.
  const stockedFilter = fishMode === "stocked" ? fishFilter : null;
  const speciesFilter = fishMode === "all" ? fishFilter : null;

  return (
    <div className="app">
        <MapView
          selectedId={selected?.id ?? null}
          selectedStatus={selectedStatus}
          onSelect={handleSelect}
          stockedFilter={stockedFilter}
          speciesFilter={speciesFilter}
          flyTo={flyTo}
          forestLands={forestLands}
          blmLands={blmLands}
          highlightReach={highlightReach}
        />

        <div className="brand-chip">
          <span className="brand-wordmark">
            Keeper
            <span className="brand-seal" aria-hidden="true" />
          </span>
          <span className="brand-sub">CA·NV fishing rules — {todayLabel()}</span>
        </div>

        {/* Desktop control row (hidden on mobile — the dock takes over there). */}
        <div className="overlay-chips">
          <WaterSearch onPick={handlePickWater} />
          <button
            className={`stocked-chip${layersActive ? " stocked-chip--active" : ""}`}
            onClick={() => togglePanel("layers")}
            aria-expanded={openPanel === "layers"}
          >
            Layers
          </button>
          <button
            className={`stocked-chip${openPanel === "stock" ? " stocked-chip--active" : ""}`}
            onClick={() => togglePanel("stock")}
            aria-expanded={openPanel === "stock"}
          >
            Stocking
          </button>
          {fishFilter && (
            <button
              className="stocked-chip stocked-chip--active"
              onClick={() => setFishFilter(null)}
              aria-label={`Clear fish filter: ${fishFilter}`}
            >
              {fishFilter} ×
            </button>
          )}
        </div>

        {openPanel === "search" && (
          <WaterSearch asSheet onPick={handlePickWater} onClose={() => setOpenPanel(null)} />
        )}

        <LayersPanel
          open={openPanel === "layers"}
          onClose={() => setOpenPanel(null)}
          forestLands={forestLands}
          blmLands={blmLands}
          onToggleForest={() => setForestLands((v) => !v)}
          onToggleBlm={() => setBlmLands((v) => !v)}
          fishMode={fishMode}
          onFishMode={setFishMode}
          fishFilter={fishFilter}
          onFishFilter={setFishFilter}
          onPickWater={handlePickWater}
        />

        <button
          className="chat-fab"
          onClick={() => togglePanel("chat")}
          aria-expanded={openPanel === "chat"}
          aria-label="Open regulations chat"
        >
          Ask
        </button>
        <ChatPanel open={openPanel === "chat"} onClose={() => setOpenPanel(null)} onOpenWater={handleOpenWaterByName} />

        <StockingPage
          open={openPanel === "stock"}
          onClose={() => setOpenPanel(null)}
          species={stockSpecies}
          onSpeciesChange={setStockSpecies}
          onOpenWater={handlePickWater}
        />

        {/* Mobile dock (hidden on desktop). Yields entirely to an open rules sheet. */}
        <nav className="dock" data-hidden={sheetOpen} aria-label="Map tools">
          <button className="dock-btn" data-active={openPanel === "search"} onClick={() => togglePanel("search")}>
            <SearchIcon size={19} />
            Search
          </button>
          <button
            className="dock-btn"
            data-active={openPanel === "layers" || layersActive}
            onClick={() => togglePanel("layers")}
          >
            <LayersIcon size={19} />
            Layers
          </button>
          <button className="dock-btn" data-active={openPanel === "stock"} onClick={() => togglePanel("stock")}>
            <FishIcon size={19} />
            Stock
          </button>
          <button className="dock-btn" data-active={openPanel === "chat"} onClick={() => togglePanel("chat")}>
            <ChatIcon size={19} />
            Ask
          </button>
        </nav>

        <RulesSheet
          pin={selected}
          focusScope={focusScope}
          onClose={handleClose}
          onStatus={handleStatus}
          onSelectReach={handleSelectReach}
          selectedReachId={highlightReach?.id ?? null}
        />
      </div>
  );
}
