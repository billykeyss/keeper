// Shareable app state <-> URL query string. Kept tiny and pure so App can round-trip a view
// (selected water, highlighted river section, fish filter, land overlays) through the address bar
// for deep links. `section` is only meaningful with `water`; `mode` only with `fish`.

export type FishFilterMode = "stocked" | "all";

export interface UrlState {
  water: number | null;
  section: number | null;
  fish: string | null;
  mode: FishFilterMode;
  forest: boolean;
  blm: boolean;
  /** The full-screen stocking-history feed is open. */
  stock: boolean;
  /** Species filter within the stocking feed (only meaningful with `stock`). */
  stockFish: string | null;
}

function posInt(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Parse the current query string into shareable state. Unknown/garbage params degrade to defaults. */
export function parseUrlState(search: string): UrlState {
  const p = new URLSearchParams(search);
  const water = posInt(p.get("water"));
  const stock = p.get("stock") === "1";
  return {
    water,
    // A section without a water makes no sense — drop it.
    section: water != null ? posInt(p.get("section")) : null,
    fish: p.get("fish")?.trim() || null,
    mode: p.get("mode") === "all" ? "all" : "stocked",
    forest: p.get("forest") === "1",
    blm: p.get("blm") === "1",
    stock,
    stockFish: stock ? (p.get("stockfish")?.trim() || null) : null,
  };
}

/** Serialize shareable state to a query string (leading "?"), or "/" when nothing is set. */
export function serializeUrlState(s: UrlState): string {
  const p = new URLSearchParams();
  if (s.water != null) {
    p.set("water", String(s.water));
    if (s.section != null) p.set("section", String(s.section));
  }
  if (s.fish) {
    p.set("fish", s.fish);
    if (s.mode === "all") p.set("mode", "all"); // "stocked" is the default, omit it
  }
  if (s.forest) p.set("forest", "1");
  if (s.blm) p.set("blm", "1");
  if (s.stock) {
    p.set("stock", "1");
    if (s.stockFish) p.set("stockfish", s.stockFish);
  }
  const qs = p.toString();
  return qs ? `?${qs}` : "/";
}
