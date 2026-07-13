// Playbook types — mirror agency-os-backend/src/services/playbook.ts.
// Kept in a separate module from lib/types.ts because the calling cockpit
// in Phase 4b will pull heavily from this surface.

export type ObjectionCategory = 'standard' | 'deep-dive' | 'closing';
export type DiscoverySummaryField =
  | 'lead_source'
  | 'customer_next_step'
  | 'customer_looks_for'
  | 'missing_information'
  | 'repeated_questions'
  | 'current_process_assessment';

export interface ObjectionVariant {
  label: string;
  rebuttal: string;
}

export interface SimpleObjection {
  id: string;
  label: string;
  category: ObjectionCategory;
  type: 'simple';
  order: number;
  rebuttal: string;
  variants?: ObjectionVariant[];
  note?: string;
}

export interface BranchingPath {
  id: string;
  label: string;
  short_label: string;
  rebuttal: string;
  note?: string;
  drop_ask_to?: string;
  follow_up_note?: string;
  sets_followup_days?: number;
}

export interface BranchingObjection {
  id: string;
  label: string;
  category: ObjectionCategory;
  type: 'branching';
  order: number;
  diagnostic: { prompt: string };
  paths: BranchingPath[];
}

export type Objection = SimpleObjection | BranchingObjection;

export type ObjectionsByCategory = Record<ObjectionCategory, Objection[]>;

// Answer chip on a Question-oriented stage. Absent on No-oriented stages.
export interface StageAnswer {
  id: string;
  label: string;
  next_stage_id?: string;
  objection_id?: string;
  qualification_tag?: string;
  summary_field?: DiscoverySummaryField;
  summary_value?: string;
}

export interface Stage {
  id: string;
  label: string;
  short_label: string;
  body: string;
  note?: string;
  branch?: boolean;
  answers?: StageAnswer[];
  selection_mode?: 'single' | 'multiple';
  continue_stage_id?: string;
  reveal_solution?: boolean;
}

export interface QuestionCallAnswer {
  stageId: string;
  stageLabel: string;
  answerId: string;
  answerLabel: string;
  qualificationTag?: string;
  summaryField?: DiscoverySummaryField;
  summaryValue?: string;
  timestamp: string;
}

export interface Script {
  id: string;
  label: string;
  method?: string;
  default?: boolean;
  fallback?: string;
  use_when?: string;
  stages: Stage[];
}

export interface ScriptSummary {
  id: string;
  label: string;
  method?: string;
  default?: boolean;
  stage_count: number;
}

export interface FollowUpTouch {
  id: string;
  label: string;
  short_label: string;
  body: string;
  note?: string;
}

export interface FollowUpSequence {
  id: string;
  label: string;
  description?: string;
  touches: FollowUpTouch[];
}

export interface LeadContext {
  company: string;
  contact_name?: string;
  city?: string;
  state?: string;
  trade?: string;
  signals?: string[];
  scores?: {
    reviews?: string;
    gbp?: string;
    website?: string;
    opportunity?: string;
  };
}

// === Generate-rebuttal request/response ===

export interface GenerateRebuttalRequest {
  objection_id: string;
  lead_id?: number;
  lead_context: LeadContext;
  current_stage?: string;
  call_duration_seconds?: number;
  free_text_notes?: string;
  stock_rebuttal_already_tried: string;
  why_it_didnt_land?: string;
}

export interface RebuttalVariant {
  angle: string;
  rebuttal: string;
}

export interface GenerateRebuttalResponse {
  generation_id: number;
  variants: RebuttalVariant[];
  generated_at: string;
  model: string;
}

// === Operator-side objection-hit log (sent with the outcome) ===

export interface ObjectionHit {
  objection_id: string;
  path_id?: string;
  variant_label?: string;         // for SimpleObjection variants — which angle was used
  handled: boolean | null;
  timestamp_s: number;
  generation_id?: number | null;
}

// === Token interpolation (mirrors agency-os-backend/services/playbook.ts) ===

const TOKEN_RE = /\[(Company Name|Name|city|state|their trade|review_count|review_avg|reviews)\]/g;

// scores.reviews is the combined "41 · 4.9★" display string; tokens
// [review_count] / [review_avg] parse the two numbers out for separate
// use inside dialogue. [reviews] returns the combined format unchanged.
function parseReviewsField(raw: string | undefined, want: 'count' | 'avg' | 'combined'): string {
  if (!raw) return '';
  if (want === 'combined') return raw;
  const m = raw.match(/^\s*(\d+)\s*[·•]\s*([\d.]+)/);
  if (m) return want === 'count' ? m[1] : m[2];
  if (want === 'count') return raw.replace(/[^\d]/g, '');
  return '';
}

export function interpolate(text: string, ctx: LeadContext): string {
  return text.replace(TOKEN_RE, (_, token) => {
    switch (token) {
      case 'Company Name': return ctx.company || '';
      case 'Name': return ctx.contact_name || 'there';
      case 'city': return ctx.city || '';
      case 'state': return ctx.state || '';
      case 'their trade': return ctx.trade || 'your trade';
      case 'review_count': return parseReviewsField(ctx.scores?.reviews, 'count');
      case 'review_avg': return parseReviewsField(ctx.scores?.reviews, 'avg');
      case 'reviews': return parseReviewsField(ctx.scores?.reviews, 'combined');
      default: return `[${token}]`;
    }
  });
}

// Normalizes Google Places primaryType strings into something readable
// inside a sentence. "plumber" → "plumber", "roofing_contractor" → "roofing
// contractor", "general_contractor" → "general contractor", etc.
export function tradeLabel(industry: string | null | undefined): string {
  if (!industry) return '';
  return industry.replace(/_/g, ' ').toLowerCase().trim();
}
