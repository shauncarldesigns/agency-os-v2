// Single source of truth for tier pricing strings + recurring-revenue math.
// Before this module landed, the same numbers + label copy were duplicated
// across 8 files (4 price strings + 4 TIER_MRR constants). Tier 1/2 pricing
// rev'd twice in v2.2 → v2.3 and the strings drifted out of sync, which is
// what motivated the consolidation.

export type Tier = 1 | 2 | 3;

// Monthly recurring revenue per tier. Drives every MRR rollup on the Sites
// tab + header. T1 is $0 because Tier 1 is a one-time-fee handoff with no
// ongoing service.
export const TIER_MRR: Record<Tier, number> = { 1: 0, 2: 79, 3: 499 };

// Display label for tier pickers + project headers.
export const TIER_LABEL: Record<Tier, string> = {
  1: 'Tier 1 · Foundation',
  2: 'Tier 2 · Managed',
  3: 'Tier 3 · SEO Program',
};

// Short price string for tier-picker cards. Note the qualify modal historically
// appended ", free build" to the T3 form — that variation is preserved inline
// at the call site rather than baked into this helper (see QualifyLeadModal).
export function tierPriceShort(t: Tier): string {
  if (t === 1) return '$950 one-time';
  if (t === 2) return '$799 build + $79/mo';
  return '$499/mo';
}

// "X each" sublabel used on the pipeline tier-prospect tiles to remind the
// operator what each prospect at that tier is worth.
export function tierSdeltaSublabel(t: Tier): string {
  if (t === 1) return '$950 one-time each';
  if (t === 2) return '$799 + $79/mo each';
  return '$499/mo each potential';
}

// Full pitch sentence shown in the LeadModal call-prep pane. Different shape
// from the picker copy — these are written as spoken sales lines, not
// summaries.
export function tierPitchBlurb(t: Tier): string {
  if (t === 1) {
    return '$950 one-time, no contract. Quick foundation site — 5 pages, complete handoff.';
  }
  if (t === 2) {
    return '$799 build + $79/mo. Hosting + edits handled. 5 pages, no contract beyond month-to-month.';
  }
  return '$499/mo, free build, 6-month commitment. 8-10 pages at launch + 3 SEO service-area pages every month.';
}
