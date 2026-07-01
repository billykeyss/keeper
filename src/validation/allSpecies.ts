export function checkSpeciesScope(
  reg: { speciesScope: "all" | "listed" },
  speciesRows: Array<{ role: string }>,
): { ok: boolean; reason?: string } {
  if (reg.speciesScope === "all") return { ok: true };
  const hasTarget = speciesRows.some((r) => r.role === "target");
  return hasTarget ? { ok: true } : { ok: false, reason: "listed rule requires at least one role='target' species row; never infer 'all' from absence" };
}
