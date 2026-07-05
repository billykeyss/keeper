import type { ChatCard as ChatCardData } from "./api";
import { ExternalIcon } from "./icons";

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m]} ${d}, ${y}`;
}

/** Only ever render http(s) links — tool/web data is untrusted, so a javascript:/data:
 *  URL must never reach an href (defense in depth with the backend's own filter). */
function safeHref(url: string | null | undefined): string | null {
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

function SourceLink({ url }: { url: string | null }) {
  const href = safeHref(url);
  if (!href) return null;
  return (
    <a className="rule-link cc-src" href={href} target="_blank" rel="noreferrer noopener">
      Source <ExternalIcon />
    </a>
  );
}

interface CardProps {
  card: ChatCardData;
  /** Fly the map to a water by name and open its rules sheet. */
  onOpenWater: (name: string) => void;
}

/** Renders one streamed tool-result card. Unknown tools render nothing (forward-compatible). */
export function ChatCard({ card, onOpenWater }: CardProps) {
  switch (card.tool) {
    case "search_waters":
      return <WatersCard data={card.data} onOpenWater={onOpenWater} />;
    case "get_water_rules":
      return <RulesCard data={card.data} onOpenWater={onOpenWater} />;
    case "get_stocking_history":
      return <StockingCard data={card.data} onOpenWater={onOpenWater} />;
    case "search_regulations":
      return <RegulationsCard data={card.data} onOpenWater={onOpenWater} />;
    case "WebSearch":
      return <WebCard data={card.data} />;
    default:
      return null;
  }
}

function CardShell({ kind, title, action, children }: { kind: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`cc cc--${kind}`}>
      <div className="cc-head">
        <span className="cc-title">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

type WaterRow = { id: number; name: string; waterType: string; states: string[]; counties: string[] };
function WatersCard({ data, onOpenWater }: { data: unknown; onOpenWater: (n: string) => void }) {
  const rows = (data as WaterRow[]) ?? [];
  if (!rows.length) return <CardShell kind="waters" title="No matching waters">{null}</CardShell>;
  return (
    <CardShell kind="waters" title={`Waters found (${rows.length})`}>
      <div className="cc-chips">
        {rows.map((w) => (
          <button key={w.id} className="cc-chip" onClick={() => onOpenWater(w.name)}>
            {w.name}
            <span className="cc-chip-sub">{w.states.join("·")}{w.counties[0] ? ` · ${w.counties[0]}` : ""}</span>
          </button>
        ))}
      </div>
    </CardShell>
  );
}

type RulesData = {
  water: { name: string; states: string[]; counties: string[] };
  status: { label: string; overall: string };
  scopes: Array<{ scope: string; status: string; rules: Array<{ ruleType: string; summary: string; sourceUrl: string | null }> }>;
  licenses?: Array<{ summary: string; sourceUrl: string | null; authority?: string | null }>;
};
function RulesCard({ data, onOpenWater }: { data: unknown; onOpenWater: (n: string) => void }) {
  const d = data as RulesData;
  if (!d?.water) return null;
  const waterScope = d.scopes?.find((s) => s.scope === "water") ?? d.scopes?.[0];
  return (
    <CardShell
      kind="rules"
      title={d.water.name}
      action={<button className="cc-open" onClick={() => onOpenWater(d.water.name)}>Open on map →</button>}
    >
      <div className="cc-statusrow">
        <span className={`cc-status cc-status--${d.status.overall}`}>{d.status.label}</span>
        <span className="cc-sub">{d.water.states.join("·")}{d.water.counties?.[0] ? ` · ${d.water.counties[0]}` : ""}</span>
      </div>
      <ul className="cc-rules">
        {(waterScope?.rules ?? []).slice(0, 6).map((r, i) => (
          <li key={i} className="cc-rule">
            <span className="cc-rule-type">{r.ruleType.replace(/_/g, " ")}</span>
            <span className="cc-rule-sum">{r.summary}</span>
            <SourceLink url={r.sourceUrl} />
          </li>
        ))}
        {(d.licenses ?? []).slice(0, 2).map((l, i) => (
          <li key={`lic${i}`} className="cc-rule">
            <span className="cc-rule-type">license</span>
            <span className="cc-rule-sum">{l.summary}</span>
            <SourceLink url={l.sourceUrl} />
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

type StockingData = {
  waterName: string;
  events: Array<{ species: string; quantity: number | null; sizeNote: string | null; date: string; sourceUrl: string | null }>;
  schedule: Array<{ species: string; frequency: string; note: string | null; sourceUrl: string | null }>;
};
function StockingCard({ data, onOpenWater }: { data: unknown; onOpenWater: (n: string) => void }) {
  const d = data as StockingData;
  if (!d?.waterName) return null;
  const total = (d.events?.length ?? 0) + (d.schedule?.length ?? 0);
  return (
    <CardShell
      kind="stocking"
      title={`Stocking history — ${d.waterName}`}
      action={<button className="cc-open" onClick={() => onOpenWater(d.waterName)}>Open on map →</button>}
    >
      {total === 0 && <p className="cc-empty">No stocking records on file.</p>}
      {d.schedule?.length > 0 && (
        <ul className="cc-sched">
          {d.schedule.map((s, i) => (
            <li key={`s${i}`}>
              <span className="cc-fish">{s.species}</span>
              <span className="cc-chip-sub">{s.frequency}</span>
              {s.note && <span className="cc-sub">{s.note}</span>}
              <SourceLink url={s.sourceUrl} />
            </li>
          ))}
        </ul>
      )}
      {d.events?.length > 0 && (
        <table className="cc-table">
          <tbody>
            {d.events.map((e, i) => (
              <tr key={`e${i}`}>
                <td className="cc-td-date">{fmtDate(e.date)}</td>
                <td className="cc-td-fish">{e.species}</td>
                <td className="cc-td-qty">{e.quantity != null ? e.quantity.toLocaleString() : ""}{e.sizeNote ? ` · ${e.sizeNote}` : ""}</td>
                <td className="cc-td-src"><SourceLink url={e.sourceUrl} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CardShell>
  );
}

type RegRow = { waterId: number; waterName: string; ruleType: string; citation: string | null; humanSummary: string; sourceUrl: string | null };
function RegulationsCard({ data, onOpenWater }: { data: unknown; onOpenWater: (n: string) => void }) {
  const rows = (data as RegRow[]) ?? [];
  if (!rows.length) return <CardShell kind="regs" title="No matching regulations">{null}</CardShell>;
  return (
    <CardShell kind="regs" title={`Regulation matches (${rows.length})`}>
      <ul className="cc-reglist">
        {rows.slice(0, 10).map((r, i) => (
          <li key={i} className="cc-reg">
            <button className="cc-reg-water" onClick={() => onOpenWater(r.waterName)}>{r.waterName}</button>
            <span className="cc-rule-sum">{r.humanSummary}</span>
            <span className="cc-cite">{r.citation}</span>
            <SourceLink url={r.sourceUrl} />
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function WebCard({ data }: { data: unknown }) {
  const results = ((data as { results?: Array<{ title: string; url: string }> })?.results) ?? [];
  if (!results.length) return null;
  return (
    <CardShell kind="web" title="From the web · not Keeper-verified">
      <ul className="cc-weblist">
        {results.map((r) => ({ r, href: safeHref(r.url) })).filter((x) => x.href).slice(0, 8).map(({ r, href }, i) => (
          <li key={i}>
            <a className="cc-weblink" href={href!} target="_blank" rel="noreferrer noopener">
              {r.title} <ExternalIcon />
            </a>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
