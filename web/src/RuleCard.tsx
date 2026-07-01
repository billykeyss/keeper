import type { Rule } from "./api";
import { RuleIcon, ExternalIcon, CheckIcon } from "./icons";
import { keyFigure, detailChips, ruleTypeLabel } from "./ruleFormat";

const PERIOD_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  closed: "Closed",
  open_catch_release: "Catch & release",
};

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

export function RuleCard({ rule }: { rule: Rule }) {
  const isNone = rule.polarity === "asserts_none";
  const big = keyFigure(rule);
  const chips = detailChips(rule);
  const label = ruleTypeLabel(rule.ruleType);
  const lowConfidence = rule.confidence !== "high";

  // "confirmed: none" — a distinct outline card with a check icon.
  if (isNone) {
    return (
      <article className="rule-card rule-card--none">
        <div className="rule-head">
          <span className="rule-icon rule-icon--none">
            <CheckIcon size={18} />
          </span>
          <span className="rule-type">No {label.toLowerCase()}</span>
          <span className="rule-confirm">confirmed</span>
          {lowConfidence && <span className="chip chip--unverified">unverified</span>}
        </div>
        <p className="rule-summary">{rule.summary}</p>
        <SourceRow citation={rule.citation} sourceUrl={rule.sourceUrl} />
      </article>
    );
  }

  return (
    <article className="rule-card">
      <div className="rule-head">
        <span className="rule-icon">
          <RuleIcon type={rule.ruleType} size={18} />
        </span>
        <span className="rule-type">{label}</span>
        {rule.species.length > 0 && (
          <span className="rule-species">{rule.species.join(", ")}</span>
        )}
        {lowConfidence && <span className="chip chip--unverified">unverified</span>}
      </div>

      {big && (
        <div className="rule-figure">
          <span className="rule-figure-value">{big.value}</span>
          <span className="rule-figure-caption">{big.caption}</span>
        </div>
      )}

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
    </article>
  );
}
