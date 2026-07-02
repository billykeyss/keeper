import { useCallback, useState } from "react";
import { MapView } from "./Map";
import { RulesSheet } from "./RulesSheet";
import { StockedFishPanel } from "./StockedFishPanel";
import type { WaterPin, ScopeStatus, StockedWaterRow } from "./api";

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function App() {
  const [selected, setSelected] = useState<WaterPin | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<ScopeStatus | null>(null);
  const [focusScope, setFocusScope] = useState<string | null>(null);
  const [stockedOpen, setStockedOpen] = useState(false);
  const [stockedFilter, setStockedFilter] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number } | null>(null);

  const handleSelect = useCallback((pin: WaterPin, scope?: string) => {
    setSelected(pin);
    setSelectedStatus(null); // reset until rules resolve
    setFocusScope(scope ?? null);
  }, []);

  const handleStatus = useCallback((_id: number, status: ScopeStatus) => {
    // RulesSheet aborts superseded fetches, so any status that arrives is current.
    setSelectedStatus(status);
  }, []);

  const handleClose = useCallback(() => {
    setSelected(null);
    setSelectedStatus(null);
  }, []);

  const handlePickStockedWater = useCallback((w: StockedWaterRow) => {
    setFlyTo({ lon: w.lon, lat: w.lat });
    setStockedOpen(false);
    handleSelect({
      id: w.id, name: w.name, waterType: w.waterType, states: w.states,
      lon: w.lon, lat: w.lat, verifyCurrent: false, ruleCount: 0,
    });
  }, [handleSelect]);

  return (
    <div className="app">
      <MapView
        selectedId={selected?.id ?? null}
        selectedStatus={selectedStatus}
        onSelect={handleSelect}
        stockedFilter={stockedFilter}
        flyTo={flyTo}
      />

      <div className="brand-chip">
        <span className="brand-wordmark">
          Keeper
          <span className="brand-seal" aria-hidden="true" />
        </span>
        <span className="brand-sub">CA·NV fishing rules — {todayLabel()}</span>
      </div>

      <div className="overlay-chips">
        <button className="stocked-chip" onClick={() => setStockedOpen((v) => !v)} aria-expanded={stockedOpen}>
          Stocked fish
        </button>
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

      <StockedFishPanel
        open={stockedOpen}
        onClose={() => setStockedOpen(false)}
        activeFilter={stockedFilter}
        onFilter={setStockedFilter}
        onPickWater={handlePickStockedWater}
      />

      <RulesSheet pin={selected} focusScope={focusScope} onClose={handleClose} onStatus={handleStatus} />
    </div>
  );
}
