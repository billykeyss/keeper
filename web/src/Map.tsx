import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { renderToStaticMarkup } from "react-dom/server";
import { fetchWaters, type WaterPin, type ReachPin, type ScopeStatus } from "./api";
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

function buildPinElement(pin: WaterPin, onSelect: (p: WaterPin, focusScope?: string) => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.className = "pin";
  el.type = "button";
  el.setAttribute(
    "aria-label",
    `${pin.name}${pin.verifyCurrent ? ", verify current conditions" : ""}, ${pin.ruleCount} rule${pin.ruleCount === 1 ? "" : "s"}`,
  );
  el.dataset.verify = String(pin.verifyCurrent);
  el.dataset.status = "pine";
  if (FLOWING_TYPES.has(pin.waterType)) el.style.setProperty("--water-hue", hueForWaterId(pin.id));
  el.innerHTML = `<span class="pin-body">${glyphHtml(pin.waterType)}</span>`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(pin);
  });
  return el;
}

// Reach pins are smaller satellite markers plotted along a multi-reach water (e.g. a river's
// distinct regulated sections) so it doesn't collapse into one ambiguous pin. Used as a fallback
// for reaches with no traced path geometry (line === null) — reaches WITH a line render as an
// actual path on the map instead (see REACH_LINES_* below). Clicking either opens the parent
// water's sheet scrolled to that reach.
function buildReachPinElement(
  reach: ReachPin,
  onSelect: (p: WaterPin, focusScope?: string) => void,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.className = "pin pin-reach";
  el.type = "button";
  el.setAttribute("aria-label", reachAriaLabel(reach));
  el.dataset.status = "pine";
  el.style.setProperty("--water-hue", hueForWaterId(reach.waterBodyId));
  el.innerHTML = `<span class="pin-body pin-body--reach"></span>`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(reachToWaterPin(reach), reach.name ?? undefined);
  });
  return el;
}

interface MapProps {
  selectedId: number | null;
  selectedStatus: ScopeStatus | null;
  onSelect: (pin: WaterPin, focusScope?: string) => void;
  /** When set, only waters stocked with this species (and their reaches) are shown —
   *  with one deliberate exception: the currently selected water's pin is never removed
   *  while its sheet is open (the map-wide keep-selected-visible rule), even if the
   *  filter excludes it. */
  stockedFilter: string | null;
  /** When set, only waters where this species is present are shown (same keep-selected rule). */
  speciesFilter: string | null;
  /** One-shot fly request (e.g. picking a water from the layers/search panels). */
  flyTo: { lon: number; lat: number } | null;
  /** USDA national-forest lands overlay (green). */
  forestLands: boolean;
  /** BLM-managed lands overlay (yellow). */
  blmLands: boolean;
}

type MarkerEntry = { marker: maplibregl.Marker; el: HTMLButtonElement; pin: WaterPin };
type ReachMarkerEntry = { marker: maplibregl.Marker; el: HTMLButtonElement; reach: ReachPin };

const REACH_LINES_SOURCE = "reach-lines";
const REACH_LINES_CASING_LAYER = "reach-lines-casing";
const REACH_LINES_LAYER = "reach-lines-line";

// USDA Forest Service proclaimed National Forest/Grassland lands (public domain).
// The EDW MapServers publish no XYZ tile cache, so this uses MapLibre's export-based
// raster source: each tile is a live 256px render from the ArcGIS export endpoint
// (layers 3+0 = filled proclaimed-forest polygons + grassland units). The fill pixels
// come back fully opaque — blending with the basemap happens via raster-opacity.
// Zoom range is capped so panning doesn't hammer the (uncached, government) server;
// past maxzoom MapLibre overzooms the last tiles, which is fine for coarse boundaries.
const FOREST_SOURCE = "usfs-forests";
const FOREST_LAYER = "usfs-forests-fill";
const FOREST_TILES_URL =
  "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ProclaimedForestsAndGrasslands_01/MapServer/export" +
  "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&layers=show:3,0";

// BLM-managed surface estate (public domain, BLM Enterprise GIS). Unlike the USFS
// service this one has a real pre-rendered tile cache (fast), populated through z14 —
// maxzoom lets MapLibre overzoom beyond that instead of requesting 404 tiles. Renders
// BLM parcels as pale yellow (254,230,121), everything else transparent — visually
// distinct from the USFS pale green so both can show at once under one toggle.
const BLM_SOURCE = "blm-lands";
const BLM_LAYER = "blm-lands-fill";
const BLM_TILES_URL =
  "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_BLM_Only/MapServer/tile/{z}/{y}/{x}";

function reachToWaterPin(reach: ReachPin): WaterPin {
  return {
    id: reach.waterBodyId,
    name: reach.waterName,
    waterType: "river",
    states: [],
    lon: reach.lon,
    lat: reach.lat,
    verifyCurrent: false,
    ruleCount: 0,
  };
}

function reachAriaLabel(reach: ReachPin): string {
  const label = reach.name ?? `${reach.waterName} reach`;
  return `${reach.waterName} — ${label}${reach.sublabel ? `, ${reach.sublabel}` : ""}`;
}

const FLOWING_TYPES = new Set(["river", "stream", "creek"]);

// A small fixed categorical palette (validated for CVD-safe separation — all-pairs, not just
// adjacent, since any two waters can be map-neighbors — chroma floor, and contrast per the
// design system's color rules) used ONLY as a secondary, unselected-state identity hint for
// flowing waters (rivers/streams/creeks), so a cluster of nearby reaches/pins reads as "these
// belong to the same water" at a glance. Hues are picked clear of the app's reserved status
// colors (open/catch-release/closed/unknown) so the two systems never get confused. Selecting a
// pin/reach always overrides this with the true status color — identity hue never substitutes
// for status. 6 slots (not more) — validation showed the remaining hue-wheel room between the
// reserved status bands couldn't fit further hues without failing CVD separation.
const WATER_HUES = ["#7432ae", "#08918d", "#b5305d", "#599130", "#4e7dda", "#b8890c"];

// Deterministic (same id → same hue, every render) — Knuth multiplicative hash for a decent
// bit-mix on small sequential ids, so adjacent water_body rows don't just cycle 0,1,2,3,0,1,2,3.
function hueForWaterId(id: number): string {
  const h = (Math.imul(id, 2654435761) >>> 0) % WATER_HUES.length;
  return WATER_HUES[h];
}

export function MapView({ selectedId, selectedStatus, onSelect, stockedFilter, speciesFilter, flyTo, forestLands, blmLands }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<number, MarkerEntry>>(new Map());
  const reachMarkersRef = useRef<Map<number, ReachMarkerEntry>>(new Map());
  const reachLinesRef = useRef<Map<number, ReachPin>>(new Map());
  const debounceRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  // Live refs so the once-created map closures never read stale props.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedIdRef = useRef<number | null>(selectedId);
  selectedIdRef.current = selectedId;
  const stockedFilterRef = useRef<string | null>(stockedFilter);
  stockedFilterRef.current = stockedFilter;
  const speciesFilterRef = useRef<string | null>(speciesFilter);
  speciesFilterRef.current = speciesFilter;
  const forestLandsRef = useRef(forestLands);
  forestLandsRef.current = forestLands;
  const blmLandsRef = useRef(blmLands);
  blmLandsRef.current = blmLands;
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

    // Reach paths rendered as real GeoJSON lines (a river's actual traced course) rather than a
    // dot — an ink "casing" underneath a slightly narrower colored line, echoing the pins' ink-ring
    // styling. Reaches without known path geometry still fall back to the satellite marker dots.
    map.on("load", () => {
      // Forest overlay sits directly above the basemap so reach lines/pins stay on top.
      map.addSource(FOREST_SOURCE, {
        type: "raster",
        tiles: [FOREST_TILES_URL],
        tileSize: 256,
        minzoom: 6,
        maxzoom: 13,
        attribution: "USDA Forest Service",
      });
      map.addLayer({
        id: FOREST_LAYER,
        type: "raster",
        source: FOREST_SOURCE,
        layout: { visibility: forestLandsRef.current ? "visible" : "none" },
        paint: { "raster-opacity": 0.62 },
      });
      map.addSource(BLM_SOURCE, {
        type: "raster",
        tiles: [BLM_TILES_URL],
        tileSize: 256,
        maxzoom: 14,
        attribution: "Bureau of Land Management",
      });
      map.addLayer({
        id: BLM_LAYER,
        type: "raster",
        source: BLM_SOURCE,
        layout: { visibility: blmLandsRef.current ? "visible" : "none" },
        paint: { "raster-opacity": 0.55 },
      });

      map.addSource(REACH_LINES_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: REACH_LINES_CASING_LAYER, type: "line", source: REACH_LINES_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1a2b22", "line-width": 7, "line-opacity": 0.55 },
      });
      map.addLayer({
        id: REACH_LINES_LAYER, type: "line", source: REACH_LINES_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        // Per-feature identity hue (see WATER_HUES) — same water always gets the same color.
        paint: { "line-color": ["get", "color"], "line-width": 4 },
      });
      map.on("mouseenter", REACH_LINES_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", REACH_LINES_LAYER, () => { map.getCanvas().style.cursor = ""; });
      map.on("click", REACH_LINES_LAYER, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const reach = reachLinesRef.current.get(Number(f.properties?.id));
        if (reach) onSelectRef.current(reachToWaterPin(reach), reach.name ?? undefined);
      });
    });

    const diffMarkers = (pins: WaterPin[], reachPins: ReachPin[]) => {
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
          const el = buildPinElement(pin, (p, focusScope) => onSelectRef.current(p, focusScope));
          const marker = new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([pin.lon, pin.lat])
            .addTo(map);
          // MapLibre's Marker overwrites the element's aria-label with "Map marker" — restore ours.
          el.setAttribute(
            "aria-label",
            `${pin.name}${pin.verifyCurrent ? ", verify current conditions" : ""}, ${pin.ruleCount} rule${pin.ruleCount === 1 ? "" : "s"}`,
          );
          existing.set(pin.id, { marker, el, pin });
        }
      }

      // Reaches with real path geometry render as GeoJSON lines; the rest fall back to dots.
      const lineReaches = reachPins.filter((r) => r.line != null);
      const dotReaches = reachPins.filter((r) => r.line == null);

      const lineSource = map.getSource(REACH_LINES_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (lineSource) {
        reachLinesRef.current = new Map(lineReaches.map((r) => [r.id, r]));
        lineSource.setData({
          type: "FeatureCollection",
          features: lineReaches.map((r) => ({
            type: "Feature",
            properties: { id: r.id, color: hueForWaterId(r.waterBodyId) },
            geometry: { type: "LineString", coordinates: r.line! },
          })),
        });
      }

      const existingReach = reachMarkersRef.current;
      const nextReach = new Map(dotReaches.map((r) => [r.id, r]));
      for (const [id, entry] of existingReach) {
        if (!nextReach.has(id)) {
          entry.marker.remove();
          existingReach.delete(id);
        }
      }
      for (const rp of dotReaches) {
        const cur = existingReach.get(rp.id);
        if (cur) {
          cur.reach = rp;
          cur.marker.setLngLat([rp.lon, rp.lat]);
        } else {
          const el = buildReachPinElement(rp, (p, focusScope) => onSelectRef.current(p, focusScope));
          const marker = new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([rp.lon, rp.lat])
            .addTo(map);
          // MapLibre's Marker overwrites the element's aria-label with "Map marker" — restore ours.
          el.setAttribute("aria-label", reachAriaLabel(rp));
          existingReach.set(rp.id, { marker, el, reach: rp });
        }
      }

      setEmpty(pins.length === 0 && reachPins.length === 0);
      applySelectionRef.current();
    };

    const refresh = () => {
      const b = map.getBounds();
      const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      fetchWaters(bbox, ac.signal, { stocked: stockedFilterRef.current, species: speciesFilterRef.current })
        .then(({ waters, reaches }) => {
          setError(false);
          setLoading(false);
          diffMarkers(waters, reaches);
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
      for (const { marker } of reachMarkersRef.current.values()) marker.remove();
      reachMarkersRef.current.clear();
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

  // Refetch pins when the stocked-species filter changes.
  useEffect(() => {
    refreshRef.current();
  }, [stockedFilter, speciesFilter]);

  // Toggle each land overlay independently (layers exist once the style has loaded;
  // the load handler applies the initial state from the refs for toggles racing map creation).
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer(FOREST_LAYER)) {
      map.setLayoutProperty(FOREST_LAYER, "visibility", forestLands ? "visible" : "none");
    }
  }, [forestLands]);
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer(BLM_LAYER)) {
      map.setLayoutProperty(BLM_LAYER, "visibility", blmLands ? "visible" : "none");
    }
  }, [blmLands]);

  // One-shot fly-to (picking a water from the stocked-fish panel).
  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    mapRef.current.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: 12, duration: 900 });
  }, [flyTo]);

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
