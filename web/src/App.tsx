// Task 7 scaffold shell. The map + rules bottom sheet land in Task 8, which
// replaces the boot placeholder with <Map/> and <RulesSheet/>.

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function App() {
  return (
    <div className="app">
      <div className="brand-chip">
        <span className="brand-name">CA/NV Fishing Rules</span>
        <span className="brand-date">{todayLabel()}</span>
      </div>
      <div className="boot" role="status">
        Loading map…
      </div>
    </div>
  );
}
