export type AnalysisRecord = Record<string, unknown>;
const CALL_TYPES = new Set(['cold_call','capture_email','reengagement','sales','other']);
const OUTCOMES = new Set(['rejected','gatekeeper','conversation','email_captured','follow_up','meeting_booked','sold','unknown']);
const SCORE_KEYS = ['opening','rapport','discovery','listening','objection_handling','clarity','close','overall'];

function object(value: unknown, name: string): AnalysisRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as AnalysisRecord;
}
function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new Error(`${name} must be a string array`);
  return value;
}
function evidence(value: unknown, name: string): void {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  value.forEach((entry, index) => {
    const row = object(entry, `${name}[${index}]`);
    if (typeof row.quote !== 'string' || typeof row.timestamp !== 'string') throw new Error(`${name}[${index}] requires quote and timestamp`);
  });
}

function normalizeConfidence(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const percent = trimmed.endsWith('%');
    const parsed = Number(percent ? trimmed.slice(0, -1) : trimmed);
    if (Number.isFinite(parsed)) value = percent ? parsed / 100 : parsed;
  }
  if (typeof value === 'number' && value > 1 && value <= 100) return value / 100;
  return value;
}

export function validateCallAnalysis(input: unknown): AnalysisRecord {
  const a = object(input, 'analysis');
  if (typeof a.call_summary !== 'string' || typeof a.prospect_situation !== 'string') throw new Error('summary and prospect_situation are required');
  if (!CALL_TYPES.has(String(a.call_type)) || !OUTCOMES.has(String(a.outcome))) throw new Error('invalid call_type or outcome');
  // Models occasionally express confidence as a percentage despite the
  // schema's 0..1 contract. Normalize that deterministic representation
  // before validation; values outside both accepted representations fail.
  a.outcome_confidence = normalizeConfidence(a.outcome_confidence);
  if (typeof a.outcome_confidence !== 'number' || a.outcome_confidence < 0 || a.outcome_confidence > 1) throw new Error('outcome_confidence must be 0..1');
  strings(a.stated_needs, 'stated_needs');
  strings(a.what_shaun_did_well, 'what_shaun_did_well');
  strings(a.missed_follow_up_questions, 'missed_follow_up_questions');
  for (const key of ['inferred_needs','objections','buying_signals','benefits_discussed','improvements','important_quotes']) {
    if (!Array.isArray(a[key])) throw new Error(`${key} must be an array`);
  }
  for (const [group, rows] of [['inferred_needs', a.inferred_needs], ['objections', a.objections], ['buying_signals', a.buying_signals], ['benefits_discussed', a.benefits_discussed]] as const) {
    (rows as unknown[]).forEach((row, i) => evidence(object(row, `${group}[${i}]`).evidence, `${group}[${i}].evidence`));
  }
  for (const row of a.inferred_needs as AnalysisRecord[]) {
    row.confidence = normalizeConfidence(row.confidence);
    if (typeof row.confidence !== 'number' || row.confidence < 0 || row.confidence > 1) throw new Error('inferred_needs confidence must be 0..1');
  }
  const scores = object(a.scores, 'scores');
  for (const key of SCORE_KEYS) {
    const value = scores[key];
    if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100)) throw new Error(`scores.${key} must be null or integer 0..100`);
  }
  for (const key of ['recommended_next_action','recommended_follow_up_message']) if (typeof a[key] !== 'string') throw new Error(`${key} must be a string`);
  return a;
}
