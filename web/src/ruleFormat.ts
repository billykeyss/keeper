import type { Rule } from "./api";

type Detail = Record<string, unknown>;

/** Human label for a rule type. */
const RULE_LABELS: Record<string, string> = {
  season: "Season",
  bag: "Bag limit",
  size_limit: "Size limit",
  gear_method: "Gear & method",
  fishing_hours: "Fishing hours",
  closure: "Closure",
  vessel: "Vessel",
  ais: "Invasive-species check",
  license: "License & permit",
  documentation: "Documentation",
  handling: "Handling",
  special: "Special",
  definition: "Definition",
};

export function ruleTypeLabel(type: string): string {
  return RULE_LABELS[type] ?? type.replace(/_/g, " ");
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

export interface KeyFigure {
  value: string;
  caption: string;
}

/** The oversized headline number for a rule card, when one reads clearly.
 *  Bag and size limits get a big figure; most other types rely on chips. */
export function keyFigure(rule: Rule): KeyFigure | null {
  const d = rule.detail as Detail;
  if (rule.polarity === "asserts_none") return null; // rendered as a "confirmed none" card

  if (rule.ruleType === "bag") {
    const daily = num(d.daily);
    if (bool(d.catch_and_release) && (daily === 0 || daily === null)) {
      return { value: "C&R", caption: "catch & release" };
    }
    if (daily !== null) return { value: `${daily}`, caption: "per day" };
    return null;
  }

  if (rule.ruleType === "size_limit") {
    const min = num(d.min_length_in);
    const max = num(d.max_length_in);
    const slot = d.protected_slot as { min_in?: number; max_in?: number } | undefined;
    if (min !== null && slot?.min_in != null) {
      return { value: `${min}–${slot.min_in}″`, caption: "keep slot (inches)" };
    }
    if (min !== null) return { value: `${min}″+`, caption: "minimum length" };
    if (max !== null) return { value: `≤${max}″`, caption: "maximum length" };
    return null;
  }

  return null;
}

/** Short boolean/enum chips summarizing detail-heavy rule types. */
export function detailChips(rule: Rule): string[] {
  const d = rule.detail as Detail;
  const chips: string[] = [];
  const push = (c: string) => chips.push(c);

  switch (rule.ruleType) {
    case "gear_method": {
      if (bool(d.bait_allowed) === false) push("No bait");
      if (bool(d.artificial_only)) push("Artificial only");
      if (bool(d.flies_only)) push("Flies only");
      if (bool(d.barbless_required)) push("Barbless");
      if (bool(d.single_hook_required)) push("Single hook");
      { const n = num(d.max_hooks); if (n !== null) push(`≤ ${n} hooks`); }
      { const n = num(d.max_rods); if (n !== null) push(`≤ ${n} rods`); }
      if (bool(d.chumming_allowed) === false) push("No chumming");
      if (bool(d.snagging_allowed) === false) push("No snagging");
      break;
    }
    case "vessel": {
      if (bool(d.gas_motor_allowed) === false) push("No gas motor");
      else if (bool(d.gas_motor_allowed)) push("Gas motor OK");
      if (bool(d.electric_motor_allowed)) push("Electric OK");
      if (bool(d.non_motorized_allowed)) push("Non-motorized OK");
      if (bool(d.paddleboard_allowed)) push("Paddleboard OK");
      if (bool(d.outside_boats_allowed) === false) push("No outside boats");
      break;
    }
    case "ais": {
      if (bool(d.inspection_required)) push("Inspection required");
      if (bool(d.decontamination_required)) push("Decontamination");
      if (bool(d.seal_or_sticker_required)) push("Seal/sticker");
      if (bool(d.drain_plug_out_required)) push("Drain plug out");
      break;
    }
    case "license": {
      if (bool(d.required)) push("Permit required");
      { const n = num(d.min_age); if (n !== null) push(`Age ${n}+`); }
      if (bool(d.replaces_state_license)) push("Replaces state license");
      break;
    }
    case "fishing_hours": {
      const from = typeof d.allowed_from === "string" ? d.allowed_from : null;
      const to = typeof d.allowed_to === "string" ? d.allowed_to : null;
      if (from && to) push(`${from} – ${to}`);
      break;
    }
    case "handling": {
      if (bool(d.must_release_unharmed)) push("Release unharmed");
      if (bool(d.keep_in_water)) push("Keep in water");
      break;
    }
    case "bag": {
      const poss = num(d.possession);
      if (poss !== null) push(`Possession ${poss}`);
      break;
    }
    case "closure": {
      const kind = typeof d.closure_kind === "string" ? d.closure_kind.replace(/_/g, " ") : null;
      if (kind) push(kind);
      break;
    }
  }
  return chips;
}
