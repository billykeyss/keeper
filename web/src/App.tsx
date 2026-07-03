import { useCallback, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { MapView } from "./Map";
import { PasswordGate } from "./PasswordGate";
import { RulesSheet } from "./RulesSheet";
import { StockedFishPanel } from "./StockedFishPanel";
import { WaterSearch } from "./WaterSearch";
import { ChatIcon, FishIcon, MountainIcon, SearchIcon, TreesIcon } from "./icons";
import type { WaterPin, ScopeStatus, StockedWaterRow, WaterSearchRow } from "./api";

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Exactly one of these floating panels is open at a time — panel pile-ups were the
// main source of mobile overlap. "search" is only reachable from the mobile dock
// (the desktop search box is always inline in the overlay-chips row).
type OpenPanel = null | "search" | "stocked" | "chat";

export function App() {
  const [selected, setSelected] = useState<WaterPin | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<ScopeStatus | null>(null);
  const [focusScope, setFocusScope] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [stockedFilter, setStockedFilter] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number } | null>(null);
  const [forestLands, setForestLands] = useState(false);
  const [blmLands, setBlmLands] = useState(false);

  const togglePanel = useCallback((panel: OpenPanel) => {
    setOpenPanel((p) => (p === panel ? null : panel));
  }, []);

  const handleSelect = useCallback((pin: WaterPin, scope?: string) => {
    setSelected(pin);
    setSelectedStatus(null); // reset until rules resolve
    setFocusScope(scope ?? null);
    // Diving into a water: clear panel clutter. On desktop, an open chat stays
    // (it floats beside the sheet); on mobile everything yields to the rules sheet.
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    setOpenPanel((p) => (isDesktop && p === "chat" ? p : null));
  }, []);

  const handleStatus = useCallback((_id: number, status: ScopeStatus) => {
    // RulesSheet aborts superseded fetches, so any status that arrives is current.
    setSelectedStatus(status);
  }, []);

  const handleClose = useCallback(() => {
    setSelected(null);
    setSelectedStatus(null);
  }, []);

  // Shared fly-to-and-open flow for anything that hands us a water with coordinates
  // (stocked-fish panel rows, name-search results).
  const handlePickWater = useCallback((w: StockedWaterRow | WaterSearchRow) => {
    setFlyTo({ lon: w.lon, lat: w.lat });
    setOpenPanel(null);
    handleSelect({
      id: w.id, name: w.name, waterType: w.waterType, states: w.states,
      lon: w.lon, lat: w.lat, verifyCurrent: false, ruleCount: 0,
    });
  }, [handleSelect]);

  const sheetOpen = selected != null;

  return (
    <PasswordGate>
      <div className="app">
        <MapView
          selectedId={selected?.id ?? null}
          selectedStatus={selectedStatus}
          onSelect={handleSelect}
          stockedFilter={stockedFilter}
          flyTo={flyTo}
          forestLands={forestLands}
          blmLands={blmLands}
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
            className="stocked-chip"
            onClick={() => togglePanel("stocked")}
            aria-expanded={openPanel === "stocked"}
          >
            Stocked fish
          </button>
          <span className="lands-group" role="group" aria-label="Land layers">
            <span className="lands-label">Land</span>
            <button
              className={`stocked-chip${forestLands ? " stocked-chip--active" : ""}`}
              onClick={() => setForestLands((v) => !v)}
              aria-pressed={forestLands}
              title="USDA national forest lands (green)"
            >
              Forests
            </button>
            <button
              className={`stocked-chip${blmLands ? " stocked-chip--blm" : ""}`}
              onClick={() => setBlmLands((v) => !v)}
              aria-pressed={blmLands}
              title="BLM-managed lands (yellow)"
            >
              BLM
            </button>
          </span>
          {stockedFilter && (
            <button
              className="stocked-chip stocked-chip--active"
              onClick={() => setStockedFilter(null)}
              aria-label={`Clear stocked filter: ${stockedFilter}`}
            >
              {stockedFilter} ×
            </button>
          )}
        </div>

        {openPanel === "search" && (
          <WaterSearch asSheet onPick={handlePickWater} onClose={() => setOpenPanel(null)} />
        )}

        <StockedFishPanel
          open={openPanel === "stocked"}
          onClose={() => setOpenPanel(null)}
          activeFilter={stockedFilter}
          onFilter={setStockedFilter}
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
        <ChatPanel open={openPanel === "chat"} onClose={() => setOpenPanel(null)} />

        {/* Mobile dock (hidden on desktop). Yields entirely to an open rules sheet. */}
        <nav className="dock" data-hidden={sheetOpen} aria-label="Map tools">
          <button className="dock-btn" data-active={openPanel === "search"} onClick={() => togglePanel("search")}>
            <SearchIcon size={19} />
            Search
          </button>
          <button className="dock-btn" data-active={openPanel === "stocked" || stockedFilter != null} onClick={() => togglePanel("stocked")}>
            <FishIcon size={19} />
            {stockedFilter ? "Stocked •" : "Stocked"}
          </button>
          <button className="dock-btn" data-active={forestLands} onClick={() => setForestLands((v) => !v)}>
            <TreesIcon size={19} />
            Forest
          </button>
          <button className="dock-btn" data-active={blmLands} onClick={() => setBlmLands((v) => !v)}>
            <MountainIcon size={19} />
            BLM
          </button>
          <button className="dock-btn" data-active={openPanel === "chat"} onClick={() => togglePanel("chat")}>
            <ChatIcon size={19} />
            Ask
          </button>
        </nav>

        <RulesSheet pin={selected} focusScope={focusScope} onClose={handleClose} onStatus={handleStatus} />
      </div>
    </PasswordGate>
  );
}
