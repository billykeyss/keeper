import { useCallback, useState } from "react";
import { MapView } from "./Map";
import { RulesSheet } from "./RulesSheet";
import type { WaterPin, ScopeStatus } from "./api";

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

  return (
    <div className="app">
      <MapView
        selectedId={selected?.id ?? null}
        selectedStatus={selectedStatus}
        onSelect={handleSelect}
      />

      <div className="brand-chip">
        <span className="brand-wordmark">
          Keeper
          <span className="brand-seal" aria-hidden="true" />
        </span>
        <span className="brand-sub">CA·NV fishing rules — {todayLabel()}</span>
      </div>

      <RulesSheet pin={selected} focusScope={focusScope} onClose={handleClose} onStatus={handleStatus} />
    </div>
  );
}
