import type { ScopeStatus } from "./api";

const LABELS: Record<ScopeStatus, string> = {
  open: "Open",
  catch_and_release: "Catch & release",
  closed: "Closed",
  unknown: "Check regs",
};

/** Filled status-color pill with a dot icon and white text. */
export function StatusPill({
  status,
  label,
  size = "md",
}: {
  status: ScopeStatus;
  label?: string;
  size?: "sm" | "md";
}) {
  return (
    <span className={`status-pill status-pill--${size}`} data-status={status}>
      <span className="status-dot" aria-hidden="true" />
      {label ?? LABELS[status]}
    </span>
  );
}

export function statusLabel(status: ScopeStatus): string {
  return LABELS[status];
}
