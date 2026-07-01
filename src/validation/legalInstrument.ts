const LEGAL_INSTRUMENTS = new Set(["commission_reg", "admin_code", "statute", "tribal_ordinance", "emergency_order", "directors_order"]);

export function checkLegalInstrument(
  reg: { status: string; isBinding: boolean; rulePolarity: string; verbatimText: string | null },
  sources: Array<{ role: string; source: { authorityLevel: string; instrumentType: string | null } }>,
): { ok: boolean; reason?: string } {
  if (!(reg.status === "published" && reg.isBinding)) return { ok: true };
  const hasLegalPrimary = sources.some(
    (s) => s.role === "primary" && s.source.authorityLevel === "primary_regulatory" && s.source.instrumentType != null && LEGAL_INSTRUMENTS.has(s.source.instrumentType),
  );
  if (!hasLegalPrimary) return { ok: false, reason: "published+binding rule needs a primary source that is a primary_regulatory legal instrument (not a summary booklet)" };
  if (reg.rulePolarity !== "asserts_none" && (reg.verbatimText == null || reg.verbatimText.trim() === ""))
    return { ok: false, reason: "published+binding rule requires verbatim_text unless rule_polarity=asserts_none" };
  return { ok: true };
}
