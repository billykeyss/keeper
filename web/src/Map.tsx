import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { renderToStaticMarkup } from "react-dom/server";
import { fetchWaters, type WaterPin, type ScopeStatus } from "./api";
import { WaterGlyph, RetryIcon } from "./icons";

const INITIAL_CENTER: [number, number] = [-120.0, 39.35];
const INITIAL_ZOOM = 9;
const MOVE_DEBOUNCE_MS = 250;

const RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// Water-type glyph markup is static — render once per type to a string.
const GLYPH_CACHE = new Map<string, string>();
function glyphHtml(waterType: string): string {
  let html = GLYPH_CACHE.get(waterType);
  if (!html) {
    html = renderToStaticMarkup(<WaterGlyph waterType={waterType} size={15} />);
    GLYPH_CACHE.set(waterType, html);
  }
  return html;
}

function buildPinElement(pin: WaterPin, onSelect: (p: WaterPin) => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.className = "pin";
  el.type = "button";
  el.setAttribute(
    "aria-label",
    `${pin.name}${pin.verifyCurrent ? ", verify current conditions" : ""}, ${pin.ruleCount} rule${pin.ruleCount === 1 ? "" : "s"}`,
  );
  el.dataset.verify = String(pin.verifyCurrent);
  el.dataset.status = "pine";
  el.innerHTML = `<span class="pin-body">${glyphHtml(pin.waterType)}</span>`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(pin);
  });
  return el;
}

interface MapProps {
  selectedId: number | null;
  selectedStatus: ScopeStatus | null;
  onSelect: (pin: WaterPin) => void;
}

type MarkerEntry = { marker: maplibregl.Marker; el: HTMLButtonElement; pin: WaterPin };

export function MapView({ selectedId, selectedStatus, onSelect }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<number, MarkerEntry>>(new Map());
  const debounceRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  // Live refs so the once-created map closures never read stale props.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedIdRef = useRef<number | null>(selectedId);
  selectedIdRef.current = selectedId;
  const applySelectionRef = useRef<() => void>(() => {});
  const refreshRef = useRef<() => void>(() => {});

  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  // Recolor the selected pin by its resolved status; all others stay pine.
  applySelectionRef.current = () => {
    for (const [id, entry] of markersRef.current) {
      const isSel = id === selectedId;
      entry.el.dataset.selected = String(isSel);
      entry.el.dataset.status = isSel && selectedStatus ? selectedStatus : "pine";
    }
  };

  // --- create the map once ---
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: RASTER_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;

    const diffMarkers = (pins: WaterPin[]) => {
      const existing = markersRef.current;
      const next = new Map(pins.map((p) => [p.id, p]));
      // remove markers no longer in view (but keep the selected one visible)
      for (const [id, entry] of existing) {
        if (!next.has(id) && id !== selectedIdRef.current) {
          entry.marker.remove();
          existing.delete(id);
        }
      }
      for (const pin of pins) {
        const cur = existing.get(pin.id);
        if (cur) {
          cur.pin = pin;
          cur.el.dataset.verify = String(pin.verifyCurrent);
          cur.marker.setLngLat([pin.lon, pin.lat]);
        } else {
          const el = buildPinElement(pin, (p) => onSelectRef.current(p));
          const marker = new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([pin.lon, pin.lat])
            .addTo(map);
          existing.set(pin.id, { marker, el, pin });
        }
      }
      setEmpty(pins.length === 0);
      applySelectionRef.current();
    };

    const refresh = () => {
      const b = map.getBounds();
      const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      fetchWaters(bbox, ac.signal)
        .then((pins) => {
          setError(false);
          setLoading(false);
          diffMarkers(pins);
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          setLoading(false);
          setError(true);
          void err;
        });
    };
    refreshRef.current = refresh;

    map.on("load", refresh);
    map.on("moveend", () => {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(refresh, MOVE_DEBOUNCE_MS);
    });

    return () => {
      window.clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      for (const { marker } of markersRef.current.values()) marker.remove();
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Restyle selection + gently reveal a pin the sheet would otherwise cover.
  useEffect(() => {
    applySelectionRef.current();
    const map = mapRef.current;
    const entry = selectedId != null ? markersRef.current.get(selectedId) : null;
    if (map && entry && !window.matchMedia("(min-width: 768px)").matches) {
      const pt = map.project(entry.marker.getLngLat());
      const h = map.getContainer().clientHeight;
      if (pt.y > h * 0.5) {
        map.easeTo({ center: entry.marker.getLngLat(), offset: [0, -h * 0.22], duration: 500 });
      }
    }
  }, [selectedId, selectedStatus]);

  return (
    <>
      <div ref={containerRef} className="map-root" aria-label="Map of fishing waters" role="application" />
      {loading && <div className="map-loading" aria-hidden="true" />}
      {empty && !error && (
        <div className="map-hint" role="status">
          No mapped waters here yet — scroll toward the Tahoe–Reno corridor.
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          <span>Couldn’t load waters.</span>
          <button className="toast-retry" onClick={() => refreshRef.current()}>
            <RetryIcon size={15} /> Retry
          </button>
        </div>
      )}
    </>
  );
}
