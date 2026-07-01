import { useCallback, useState } from "react";
import { MapView } from "./Map";
import { RulesSheet } from "./RulesSheet";
import type { WaterPin, ScopeStatus } from "./api";

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function App() {
  const [selected, setSelected] = useState<WaterPin | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<ScopeStatus | null>(null);

  const handleSelect = useCallback((pin: WaterPin) => {
    setSelected(pin);
    setSelectedStatus(null); // reset until rules resolve
  }, []);

  const handleStatus = useCallback((_id: number, status: ScopeStatus) => {
    // RulesSheet aborts superseded fetches, so any status that arrives is current.
    setSelectedStatus(status);
  }, []);

  const handleClose = useCallback(() => {
    setSelected(null);
    setSelectedStatus(null);
  }, []);

  return (
    <div className="app">
      <MapView
        selectedId={selected?.id ?? null}
        selectedStatus={selectedStatus}
        onSelect={handleSelect}
      />

      <div className="brand-chip">
        <span className="brand-name">CA/NV Fishing Rules</span>
        <span className="brand-date">{todayLabel()}</span>
      </div>

      <RulesSheet pin={selected} onClose={handleClose} onStatus={handleStatus} />
    </div>
  );
}
