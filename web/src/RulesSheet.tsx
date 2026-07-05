import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  fetchRules,
  type RulesResponse,
  type WaterPin,
  type ScopeStatus,
} from "./api";
import { StatusPill } from "./StatusPill";
import { RuleCard, SpeciesLimitCard } from "./RuleCard";
import { groupBagAndSize } from "./ruleFormat";
import { StockingSection } from "./StockingSection";
import { WarnIcon, RetryIcon, CloseIcon, ExternalIcon } from "./icons";

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The server builds a reach sublabel as "{from} → {to}". Split it back so the two endpoints can
// be styled distinctly with the arrow between them; fall back to the whole string if it isn't a pair.
function splitExtent(sublabel: string): [string, string] | null {
  const parts = sublabel.split(" → ");
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

const WATER_TYPE_LABEL: Record<string, string> = {
  lake: "Lake",
  reservoir: "Reservoir",
  river: "River",
  stream: "Stream",
  creek: "Creek",
  pond: "Pond",
  marina: "Marina",
  impoundment: "Impoundment",
};

interface Props {
  pin: WaterPin | null;
  focusScope?: string | null;
  onClose: () => void;
  onStatus: (id: number, status: ScopeStatus) => void;
  /** Tap a river section → highlight it on the map (toggles). */
  onSelectReach: (reachId: number, geom: { line: [number, number][] | null; point: [number, number] | null }) => void;
  /** The section currently highlighted on the map, if any. */
  selectedReachId: number | null;
}

export function RulesSheet({ pin, focusScope, onClose, onStatus, onSelectReach, selectedReachId }: Props) {
  const open = pin != null;

  const [data, setData] = useState<RulesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"peek" | "expanded">("peek");
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );

  const [sheetHeight, setSheetHeight] = useState(() =>
    typeof window !== "undefined" ? Math.round(window.innerHeight * 0.82) : 600,
  );
  const [peekOffset, setPeekOffset] = useState(() => sheetHeight - 148);
  const [dragY, setDragY] = useState<number | null>(null);

  const sheetRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startY: 0, base: 0, moved: 0 });
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  // --- responsive breakpoint ---
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // --- fetch rules for the selected water ---
  const load = useCallback((water: WaterPin) => {
    const ac = new AbortController();
    setLoading(true);
    setError(false);
    fetchRules(water.id, todayISO(), ac.signal)
      .then((res) => {
        setData(res);
        setLoading(false);
        onStatusRef.current(water.id, res.status.overall);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setLoading(false);
        setError(true);
        void err;
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!pin) return;
    setMode("peek");
    setDragY(null);
    const cancel = load(pin);
    return cancel;
  }, [pin, load]);

  // Reach pins pass down which scope to land on (e.g. a river reach clicked on the map) — once
  // its rules arrive, expand the sheet and scroll that scope's card into view.
  useEffect(() => {
    if (!data || !focusScope) return;
    setMode("expanded");
    const id = window.setTimeout(() => {
      const el = sheetRef.current?.querySelector(`[data-scope="${CSS.escape(focusScope)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60); // let the expand transition/layout settle first
    return () => window.clearTimeout(id);
  }, [data, focusScope]);

  // --- measure sheet + header to derive the peek offset ---
  useLayoutEffect(() => {
    const measure = () => {
      const h = sheetRef.current?.offsetHeight ?? Math.round(window.innerHeight * 0.82);
      const hh = peekRef.current?.offsetHeight ?? 148;
      setSheetHeight(h);
      setPeekOffset(Math.max(0, h - hh));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [data, isDesktop, open]);

  // --- escape to close ---
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // --- drag / tap on the grab area (mobile only) ---
  const base = !open ? sheetHeight + 60 : mode === "expanded" ? 0 : peekOffset;
  const translate = dragY ?? base;

  const onPointerDown = (e: React.PointerEvent) => {
    if (isDesktop) return;
    drag.current = { active: true, startY: e.clientY, base, moved: 0 };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const dy = e.clientY - drag.current.startY;
    drag.current.moved = Math.max(drag.current.moved, Math.abs(dy));
    setDragY(Math.min(sheetHeight + 60, Math.max(0, drag.current.base + dy)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    drag.current.active = false;
    const t = dragY ?? base;
    setDragY(null);
    if (drag.current.moved < 6) {
      // Tap = toggle — but taps on the handle button are handled by its own
      // onClick (which also serves keyboard users); toggling here too would
      // double-fire and net out to a no-op.
      if (!(e.target as HTMLElement).closest("button")) {
        setMode((m) => (m === "expanded" ? "peek" : "expanded"));
      }
      return;
    }
    if (t > peekOffset + 60) onClose();
    else if (t > peekOffset / 2) setMode("peek");
    else setMode("expanded");
  };

  const handleTapReach = useCallback(
    (reachId: number, geom: { line: [number, number][] | null; point: [number, number] | null }) => {
      const willSelect = selectedReachId !== reachId;
      onSelectReach(reachId, geom);
      // On mobile the expanded sheet covers the map — drop to peek so the highlight is visible.
      if (willSelect && !isDesktop) setMode("peek");
    },
    [onSelectReach, selectedReachId, isDesktop],
  );

  const verify = pin?.verifyCurrent || data?.status.verifyCurrent;
  const waterType = data?.water.waterType ?? pin?.waterType ?? "";
  const states = data?.water.states ?? pin?.states ?? [];
  const name = data?.water.name ?? pin?.name ?? "";

  return (
    <>
      {!isDesktop && open && <div className="scrim" onClick={onClose} aria-hidden="true" />}
      <section
        ref={sheetRef}
        className={`sheet${drag.current.active ? " dragging" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-label={name ? `${name} regulations` : "Water regulations"}
        aria-hidden={!open}
        data-open={open}
        data-mode={mode}
        style={isDesktop ? undefined : { transform: `translateY(${translate}px)` }}
      >
        <button className="sheet-close" aria-label="Close" onClick={onClose}>
          <CloseIcon size={18} />
        </button>

        <div className="sheet-peek" ref={peekRef}>
          <div
            className="sheet-grab"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <button
              className="sheet-handle"
              aria-label={mode === "expanded" ? "Collapse details" : "Expand details"}
              aria-expanded={mode === "expanded"}
              onClick={() => setMode((m) => (m === "expanded" ? "peek" : "expanded"))}
            />
          </div>

          <div className="sheet-header">
            <h2 className="sheet-title">{name}</h2>
            <div className="sheet-meta">
              {data ? (
                <StatusPill status={data.status.overall} thunk key={data.water.id} />
              ) : (
                <span className="pill-loading">Checking…</span>
              )}
              {waterType && <span className="chip chip--type">{WATER_TYPE_LABEL[waterType] ?? waterType}</span>}
              {states.map((s) => (
                <span className="chip chip--state" key={s}>
                  {s}
                </span>
              ))}
            </div>
          </div>

          {verify && (
            <div className="verify-banner" role="note">
              <WarnIcon size={17} />
              <span>
                <span className="advisory-tag">Advisory</span>
                Conditions can change — verify current status with the managing agency.
              </span>
            </div>
          )}
        </div>

        <div className="sheet-body">
          {loading && !data && <SheetSkeleton />}
          {error && !data && (
            <div className="sheet-error" role="alert">
              <p>Couldn’t load regulations.</p>
              <button className="btn-retry" onClick={() => pin && load(pin)}>
                <RetryIcon size={15} /> Retry
              </button>
            </div>
          )}
          {data && <RulesBody data={data} onTapReach={handleTapReach} selectedReachId={selectedReachId} />}
        </div>
      </section>
    </>
  );
}

function SheetSkeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      <div className="sk-line sk-lg" />
      <div className="sk-card" />
      <div className="sk-card" />
      <div className="sk-line sk-md" />
      <div className="sk-card" />
    </div>
  );
}

function RulesBody({
  data,
  onTapReach,
  selectedReachId,
}: {
  data: RulesResponse;
  onTapReach: (reachId: number, geom: { line: [number, number][] | null; point: [number, number] | null }) => void;
  selectedReachId: number | null;
}) {
  // A river/stream split into reaches reads as one undifferentiated wall of rows unless each
  // reach is a bounded, numbered block. Count + number them so boundaries are obvious.
  const reachCount = data.scopes.filter((s) => s.kind === "reach").length;
  let reachNum = 0;

  return (
    <div className="stagger">
      {data.scopes.map((scope, i) => {
        const isReach = scope.kind === "reach";
        const n = isReach ? ++reachNum : 0;
        const extent = isReach && scope.sublabel ? splitExtent(scope.sublabel) : null;
        // A reach is selectable if we can place it on the map — its traced line or its point.
        const hasGeom = (!!scope.line && scope.line.length > 0) || scope.point != null;
        const selectable = isReach && scope.reachId != null && hasGeom;
        const isSelected = selectable && scope.reachId === selectedReachId;
        // Overline + title, shared between the interactive (button) and static header variants.
        const titles = (
          <div className="scope-titles">
            {isReach ? (
              <>
                <span className="reach-overline">Section {n} of {reachCount}</span>
                {/* The from → to extent IS the reach's identity; lead with it (the prose
                    name is almost always the same span restated, so don't repeat it). */}
                <span className="scope-name reach-title">
                  {extent ? (
                    <>
                      <span className="reach-endpoint">{extent[0]}</span>
                      <span className="reach-arrow" aria-hidden="true">→</span>
                      <span className="reach-endpoint">{extent[1]}</span>
                    </>
                  ) : (
                    scope.sublabel ?? scope.scope
                  )}
                </span>
              </>
            ) : (
              <h3 className="scope-name">This water</h3>
            )}
          </div>
        );
        return (
          <Fragment key={`${scope.kind}:${scope.scope}:${i}`}>
            {isReach && n === 1 && reachCount > 1 && (
              <p className="scope-overview">
                This water is split into <strong>{reachCount}</strong> regulated sections — tap any
                section to highlight it on the map.
              </p>
            )}
            <section
              className={`scope${isReach ? " scope--reach" : " scope--water"}`}
              data-scope={scope.scope}
              data-selected={isSelected || undefined}
            >
              {selectable ? (
                <button
                  type="button"
                  className="scope-head reach-head"
                  aria-pressed={isSelected}
                  aria-label={`Section ${n} of ${reachCount}${scope.sublabel ? `, ${scope.sublabel}` : ""} — ${isSelected ? "highlighted on the map, tap to clear" : "tap to show on the map"}`}
                  onClick={() => onTapReach(scope.reachId!, { line: scope.line, point: scope.point })}
                >
                  {titles}
                  <span className="reach-head-right">
                    <StatusPill status={scope.status} size="sm" />
                    <span className="reach-map-cue">{isSelected ? "On map ✓" : "Show on map"}</span>
                  </span>
                </button>
              ) : (
                <div className="scope-head">
                  {titles}
                  <StatusPill status={scope.status} size="sm" />
                </div>
              )}
              {scope.rules.length === 0 ? (
                <p className="scope-empty">No specific rules recorded for this scope.</p>
              ) : (
                <div className="rule-list">
                  {groupBagAndSize(scope.rules).map((item, j) =>
                    item.kind === "merged" ? (
                      <SpeciesLimitCard species={item.species} bag={item.bag} size={item.size} key={j} />
                    ) : (
                      <RuleCard rule={item.rule} key={j} />
                    ),
                  )}
                </div>
              )}
            </section>
          </Fragment>
        );
      })}

      {data.licenses.length > 0 && (
        <section className="scope">
          <div className="scope-head">
            <h3 className="scope-name">Licenses &amp; permits</h3>
          </div>
          <div className="rule-list">
            {data.licenses.map((l, i) => (
              <div key={i}>
                {l.authority && <p className="license-authority">{l.authority}</p>}
                <RuleCard rule={l} />
              </div>
            ))}
          </div>
        </section>
      )}

      {data.reciprocity.length > 0 && (
        <section className="scope">
          <div className="scope-head">
            <h3 className="scope-name">License reciprocity</h3>
          </div>
          <ul className="recip-list">
            {data.reciprocity.map((r, i) => (
              <li key={i} className="recip-row">
                <span className={`recip-dot ${r.honored ? "yes" : "no"}`} aria-hidden="true" />
                <span>
                  {r.honoringAuthority}{" "}
                  {r.honored ? "honors" : "does not honor"}{" "}
                  {r.honoredAuthority ?? "other licenses"}
                  {r.replacesStateLicense ? " — replaces the state license here." : "."}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.species.length > 0 && (
        <section className="scope">
          <div className="scope-head">
            <h3 className="scope-name">Species present</h3>
          </div>
          <div className="species-chips">
            {data.species.map((s, i) => (
              <span className="species-chip" key={i} title={s.scientificName ?? undefined}>
                {s.commonName}
                <span className="species-presence">{s.presence}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <StockingSection events={data.stocking.events} schedule={data.stocking.schedule} />

      <footer className="sheet-foot">
        Regulations resolved for <span className="asof">{data.asOf}</span>. This is a convenience
        summary — always confirm with the managing agency before you fish.
        {data.licenses[0]?.sourceUrl && (
          <>
            {" "}
            <a href={data.licenses[0].sourceUrl} target="_blank" rel="noreferrer noopener">
              Official source <ExternalIcon />
            </a>
          </>
        )}
      </footer>
    </div>
  );
}
