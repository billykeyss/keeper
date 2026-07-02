import type { StockingEventRow, StockingScheduleRow } from "./api";
import { ExternalIcon } from "./icons";

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  seasonal: "Seasonal",
  annual: "Annual",
  as_available: "As available",
};

function seasonWindow(start: number | null, end: number | null): string | null {
  if (start == null || end == null) return null;
  return `${MONTH_ABBR[start]}–${MONTH_ABBR[end]}`;
}

function formatEventDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m]} ${d}, ${y}`;
}

/** "Stocking" section for the rules sheet — recurring schedule (if the agency states one) plus
 *  recent logged events, newest first. Renders nothing when there's no stocking data on record;
 *  Keeper never fabricates a stocking claim, so an empty result here is a valid, honest outcome. */
export function StockingSection({ events, schedule }: { events: StockingEventRow[]; schedule: StockingScheduleRow[] }) {
  if (events.length === 0 && schedule.length === 0) return null;

  return (
    <section className="scope">
      <div className="scope-head">
        <h3 className="scope-name">Stocking</h3>
      </div>

      {schedule.length > 0 && (
        <ul className="stocking-schedule">
          {schedule.map((s, i) => (
            <li className="stocking-schedule-row" key={i}>
              <div className="stocking-schedule-head">
                <span className="stocking-species">{s.species}</span>
                <span className="chip">{FREQUENCY_LABEL[s.frequency] ?? s.frequency}</span>
                {seasonWindow(s.seasonStartMonth, s.seasonEndMonth) && (
                  <span className="chip">{seasonWindow(s.seasonStartMonth, s.seasonEndMonth)}</span>
                )}
              </div>
              {s.note && <p className="rule-summary">{s.note}</p>}
              {s.sourceUrl && (
                <div className="rule-source">
                  <a className="rule-link" href={s.sourceUrl} target="_blank" rel="noreferrer noopener">
                    Source <ExternalIcon />
                  </a>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {events.length > 0 && (
        <ul className="stocking-events">
          {events.map((e, i) => (
            <li className="stocking-event-row" key={i}>
              <span className="stocking-event-date">{formatEventDate(e.date)}</span>
              <span className="stocking-species">{e.species}</span>
              <span className="stocking-event-detail">
                {e.quantity != null ? `${e.quantity.toLocaleString()}` : ""}
                {e.sizeNote ? ` (${e.sizeNote})` : ""}
              </span>
              {e.sourceUrl && (
                <a className="rule-link stocking-event-link" href={e.sourceUrl} target="_blank" rel="noreferrer noopener">
                  Source <ExternalIcon />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
