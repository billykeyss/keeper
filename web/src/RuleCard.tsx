import type { Rule } from "./api";
import { RuleIcon, ExternalIcon, CheckIcon } from "./icons";
import { keyFigure, detailChips, ruleTypeLabel } from "./ruleFormat";

const PERIOD_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  closed: "Closed",
  open_catch_release: "Catch & release",
};

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A tape-measure strip for size limits: colored keep / protected-slot / over
 *  zones with mono numerals. Renders only when a slot or a minimum length is
 *  present; the rule's own values set the axis range. Pure CSS, decorative —
 *  the summary + key figure carry the same information for screen readers. */
function SizeRuler({ detail }: { detail: Record<string, unknown> }) {
  const min = n(detail.min_length_in);
  const max = n(detail.max_length_in);
  const slot = (detail.protected_slot ?? null) as { min_in?: unknown; max_in?: unknown } | null;
  const slotMin = n(slot?.min_in);
  const slotMax = n(slot?.max_in);
  const over = (detail.over_slot_retention ?? null) as { max_daily?: unknown; min_in?: unknown } | null;
  const overMax = n(over?.max_daily);
  const overMin = n(over?.min_in) ?? slotMax;
  const hasOver = overMax != null && overMax > 0 && overMin != null;
  const hasSlot = slotMin != null && slotMax != null;

  if (!hasSlot && min == null) return null;

  const evenFloor = (v: number) => Math.max(0, Math.floor(v / 2) * 2);
  const evenCeil = (v: number) => Math.ceil(v / 2) * 2;

  type Zone = { from: number; to: number; kind: "release" | "keep" | "protected" | "over"; label?: string };
  const zones: Zone[] = [];
  const marks: number[] = [];
  let lo: number;
  let hi: number;

  if (hasSlot) {
    const keepFrom = min ?? slotMin! - 3;
    lo = evenFloor(keepFrom - 3);
    hi = hasOver ? evenCeil(overMin! + 4) : evenCeil(slotMax! + 4);
    if (keepFrom > lo) zones.push({ from: lo, to: keepFrom, kind: "release" });
    zones.push({ from: keepFrom, to: slotMin!, kind: "keep", label: "keep" });
    zones.push({ from: slotMin!, to: slotMax!, kind: "protected", label: "release" });
    zones.push({ from: slotMax!, to: hi, kind: "over", label: hasOver ? `${overMax} allowed` : "keep" });
    if (min != null) marks.push(min);
    marks.push(slotMin!, slotMax!);
  } else if (min != null && max != null) {
    lo = evenFloor(min - 3);
    hi = evenCeil(max + 3);
    zones.push({ from: lo, to: min, kind: "release", label: "release" });
    zones.push({ from: min, to: max, kind: "keep", label: "keep" });
    zones.push({ from: max, to: hi, kind: "release" });
    marks.push(min, max);
  } else {
    lo = evenFloor(min! - 4);
    hi = evenCeil(min! + 6);
    zones.push({ from: lo, to: min!, kind: "release", label: "release" });
    zones.push({ from: min!, to: hi, kind: "keep", label: "keep" });
    marks.push(min!);
  }

  const span = hi - lo || 1;
  const pct = (v: number) => ((v - lo) / span) * 100;
  const markSet = new Set(marks);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 0.001; t += 1) ticks.push(Math.round(t));

  return (
    <div className="ruler" aria-hidden="true">
      <div className="ruler-band">
        {zones.map((z, i) => (
          <div
            key={i}
            className={`ruler-zone ruler-zone--${z.kind}`}
            style={{ left: `${pct(z.from)}%`, width: `${Math.max(0, pct(z.to) - pct(z.from))}%` }}
          >
            {z.label && <span className="ruler-zone-label">{z.label}</span>}
          </div>
        ))}
        {marks.map((m) => (
          <span key={`m${m}`} className="ruler-mark" style={{ left: `${pct(m)}%` }} />
        ))}
      </div>
      <div className="ruler-scale">
        {ticks.map((t) => (
          <span
            key={t}
            className={`ruler-tick${t % 2 === 0 ? " ruler-tick--major" : ""}${markSet.has(t) ? " ruler-tick--mark" : ""}`}
            style={{ left: `${pct(t)}%` }}
          >
            {(t % 2 === 0 || markSet.has(t)) && <span className="ruler-num">{t}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Quiet citation + source-link row shown under a rule. */
function SourceRow({ citation, sourceUrl }: { citation: string | null; sourceUrl: string | null }) {
  if (!citation && !sourceUrl) return null;
  return (
    <div className="rule-source">
      {citation && <span className="rule-citation">{citation}</span>}
      {sourceUrl && (
        <a className="rule-link" href={sourceUrl} target="_blank" rel="noreferrer noopener">
          Source <ExternalIcon />
        </a>
      )}
    </div>
  );
}

/** Everything inside a rule card except the outer wrapper — shared by the standalone `RuleCard`
 *  and by `SpeciesLimitCard`'s two stacked subsections. `hideSpecies` skips the species chip in
 *  the head when a parent card already names the species once for both subsections. */
function RuleBody({ rule, hideSpecies }: { rule: Rule; hideSpecies?: boolean }) {
  const isNone = rule.polarity === "asserts_none";
  const big = keyFigure(rule);
  const chips = detailChips(rule);
  const label = ruleTypeLabel(rule.ruleType);
  const lowConfidence = rule.confidence !== "high";

  // "none on record" — an outlined ledger entry sealed with a brass check.
  if (isNone) {
    return (
      <>
        <div className="rule-head">
          <span className="rule-seal">
            <CheckIcon size={16} />
          </span>
          <span className="rule-type">No {label.toLowerCase()}</span>
          <span className="rule-none-tag">None on record</span>
          {!hideSpecies && rule.species.length > 0 && <span className="rule-species">{rule.species.join(", ")}</span>}
          {lowConfidence && <span className="chip chip--unverified">Unverified</span>}
        </div>
        <p className="rule-summary">{rule.summary}</p>
        <SourceRow citation={rule.citation} sourceUrl={rule.sourceUrl} />
      </>
    );
  }

  return (
    <>
      <div className="rule-head">
        <span className="rule-icon">
          <RuleIcon type={rule.ruleType} size={17} />
        </span>
        <span className="rule-type">{label}</span>
        {!hideSpecies && rule.species.length > 0 && (
          <span className="rule-species">{rule.species.join(", ")}</span>
        )}
        {lowConfidence && <span className="chip chip--unverified">Unverified</span>}
      </div>

      {big && (
        <div className="rule-figure">
          <span className="rule-figure-value">{big.value}</span>
          <span className="rule-figure-caption">{big.caption}</span>
        </div>
      )}

      {rule.ruleType === "size_limit" && <SizeRuler detail={rule.detail} />}

      <p className="rule-summary">{rule.summary}</p>

      {chips.length > 0 && (
        <div className="rule-chips">
          {chips.map((c) => (
            <span className="chip" key={c}>
              {c}
            </span>
          ))}
        </div>
      )}

      {rule.periods && rule.periods.length > 0 && (
        <ul className="rule-periods">
          {rule.periods.map((p, i) => (
            <li key={i} className={p.activeNow ? "period period--now" : "period"}>
              <span className="period-label">{p.label}</span>
              <span className="period-status" data-pstatus={p.status}>
                {PERIOD_STATUS_LABEL[p.status] ?? p.status}
                {p.activeNow && <span className="period-now">now</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <SourceRow citation={rule.citation} sourceUrl={rule.sourceUrl} />
    </>
  );
}

export function RuleCard({ rule }: { rule: Rule }) {
  const isNone = rule.polarity === "asserts_none";
  return (
    <article className={isNone ? "rule-card rule-card--none" : "rule-card"}>
      <RuleBody rule={rule} />
    </article>
  );
}

/** A fish's bag limit and size limit shown together as one card (instead of two disconnected
 *  ones) — only used where a scope has exactly one bag and one size_limit rule for that species,
 *  see `groupBagAndSize`. */
export function SpeciesLimitCard({ species, bag, size }: { species: string; bag: Rule; size: Rule }) {
  return (
    <article className="rule-card-merged">
      <div className="rule-card-species-head">
        <span className="rule-card-species-name">{species}</span>
      </div>
      <div className="rule-subsection">
        <RuleBody rule={bag} hideSpecies />
      </div>
      <div className="rule-subsection">
        <RuleBody rule={size} hideSpecies />
      </div>
    </article>
  );
}
