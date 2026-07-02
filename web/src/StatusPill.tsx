import type { ScopeStatus } from "./api";

const LABELS: Record<ScopeStatus, string> = {
  open: "Open",
  catch_and_release: "Catch & release",
  closed: "Closed",
  unknown: "Check regs",
};

/** A rubber-stamp status: letterspaced uppercase text inside an inked border in
 *  the status color. `thunk` plays the one-shot "stamp thunk" on mount (the
 *  caller remounts it per water via `key`); it's disabled under reduced motion. */
export function StatusPill({
  status,
  label,
  size = "md",
  thunk = false,
}: {
  status: ScopeStatus;
  label?: string;
  size?: "sm" | "md";
  thunk?: boolean;
}) {
  return (
    <span
      className={`status-stamp status-stamp--${size}${thunk ? " status-stamp--thunk" : ""}`}
      data-status={status}
    >
      {label ?? LABELS[status]}
    </span>
  );
}

export function statusLabel(status: ScopeStatus): string {
  return LABELS[status];
}
