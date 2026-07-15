// Playbook runtime — loads, parses, and caches all script / objection /
// follow-up markdown files. Bundled at build time via wrangler.toml
// [[rules]] type="Text" — Workers have no runtime fs.

import { parse as parseYaml } from 'yaml';

import coldCallMd from '../playbook/scripts/cold-call-no-oriented.md';
import coldCallQuestionMd from '../playbook/scripts/cold-call-question-oriented.md';
import coldCallQuickMd from '../playbook/scripts/cold-call-quick-oriented.md';
import demoTier3Md from '../playbook/scripts/demo-tier3-primary.md';
import demoTier2Md from '../playbook/scripts/demo-tier2-primary.md';

import wordOfMouthMd from '../playbook/objections/word-of-mouth.md';
import facebookPageMd from '../playbook/objections/facebook-page.md';
import cantAffordMd from '../playbook/objections/cant-afford.md';
import badExperienceMd from '../playbook/objections/bad-experience.md';
import tooBusySimpleMd from '../playbook/objections/too-busy-simple.md';
import talkToPartnerMd from '../playbook/objections/talk-to-partner.md';
import tooBusyMd from '../playbook/objections/too-busy.md';
import sendEmailMd from '../playbook/objections/send-email.md';
import busyPlusEmailMd from '../playbook/objections/busy-plus-email.md';
import whyNeedWebsiteMd from '../playbook/objections/why-need-website.md';
import whyNeedWebsiteDirectMd from '../playbook/objections/why-need-website-direct.md';
import builtWithoutAskingMd from '../playbook/objections/built-without-asking.md';
import quickImBusyMd from '../playbook/objections/quick-im-busy.md';
import quickTooBusyMd from '../playbook/objections/quick-too-busy.md';
import quickWebsiteCallsMd from '../playbook/objections/quick-website-calls.md';
import quickFacebookPageMd from '../playbook/objections/quick-facebook-page.md';
import quickWhyWebsiteMd from '../playbook/objections/quick-why-website.md';
import quickCostMd from '../playbook/objections/quick-cost.md';
import quickWordOfMouthMd from '../playbook/objections/quick-word-of-mouth.md';
import quickPushbackMd from '../playbook/objections/quick-pushback.md';
import angryDisarmMd from '../playbook/objections/angry-disarm.md';
import totalBrushOffMd from '../playbook/objections/total-brush-off.md';
import whyAreYouAskingMd from '../playbook/objections/why-are-you-asking.md';
import earlyNotInterestedMd from '../playbook/objections/early-not-interested.md';

import emailSequenceMd from '../playbook/follow-ups/email-sequence.md';

// ============================================================================
// TYPES
// ============================================================================

export type ObjectionCategory = 'standard' | 'deep-dive' | 'closing';
export type ObjectionType = 'simple' | 'branching';
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
  rebuttal: string;                      // default / canonical line
  variants?: ObjectionVariant[];         // optional alternative angles; UI shows a chip row
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

// Answer choice attached to a Stage. Used by Question-oriented mode: the
// operator taps a chip corresponding to what the prospect said, which
// records a note, may set legacy qualification tags / summary metadata, and
// either advances to the next stage or opens an objection. Absent on the
// No-oriented script; that flow just uses linear Advance / Back.
export interface StageAnswer {
  id: string;
  label: string;
  next_stage_id?: string;
  objection_id?: string;
  qualification_tag?: string;
  summary_field?: DiscoverySummaryField;
  summary_value?: string;
  free_text?: boolean;
  free_text_label?: string;
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
  // Marks the point in a Question-oriented script where the solution may
  // be revealed. Any stage from this one on unlocks website-specific
  // objections and lets the operator mention what Shaun does.
  reveal_solution?: boolean;
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

// ============================================================================
// PARSER INTERNALS
// ============================================================================

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function splitFrontmatter(raw: string): { fm: any; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  const m = FRONTMATTER_RE.exec(normalized);
  if (!m) throw new Error('Invalid playbook markdown: missing YAML frontmatter');
  const fm = parseYaml(m[1]) ?? {};
  const body = m[2] ?? '';
  return { fm, body };
}

// Lines that start with `>` get pulled into the note; everything else
// stays in the body. Collapses runs of blank lines.
function extractNote(raw: string): { body: string; note: string } {
  const bodyLines: string[] = [];
  const noteLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (/^\s*>/.test(line)) {
      noteLines.push(line.replace(/^\s*>\s?/, ''));
    } else {
      bodyLines.push(line);
    }
  }
  return {
    body: bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    note: noteLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

// Split body by "## {prefix}: {id}" headers (Stage / Path / Touch).
// Map<id, {body, note}>.
function splitSections(body: string, prefix: string): Map<string, { body: string; note: string }> {
  const out = new Map<string, { body: string; note: string }>();
  const re = new RegExp(`^##\\s+${prefix}:\\s+(.+)$`, 'gm');
  const matches = Array.from(body.matchAll(re));
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : body.length;
    const raw = body.slice(start, end).trim();
    out.set(id, extractNote(raw));
  }
  return out;
}

function parseScript(raw: string): Script {
  const { fm, body } = splitFrontmatter(raw);
  const sections = splitSections(body, 'Stage');
  const stages: Stage[] = ((fm.stages as any[]) ?? []).map((s) => {
    const sec = sections.get(s.id);
    if (!sec) throw new Error(`Script ${fm.id}: missing "## Stage: ${s.id}" body`);
    const rawAnswers = Array.isArray(s.answers) ? s.answers : null;
    const answers: StageAnswer[] | undefined = rawAnswers?.length
      ? rawAnswers
          .filter((a: any) => a && typeof a.id === 'string' && typeof a.label === 'string')
          .map((a: any): StageAnswer => ({
            id: a.id,
            label: a.label,
            next_stage_id: typeof a.next_stage_id === 'string' ? a.next_stage_id : undefined,
            objection_id: typeof a.objection_id === 'string' ? a.objection_id : undefined,
            qualification_tag: typeof a.qualification_tag === 'string' ? a.qualification_tag : undefined,
            summary_field: isDiscoverySummaryField(a.summary_field) ? a.summary_field : undefined,
            summary_value: typeof a.summary_value === 'string' ? a.summary_value : undefined,
            free_text: a.free_text === true ? true : undefined,
            free_text_label: typeof a.free_text_label === 'string' ? a.free_text_label : undefined,
          }))
      : undefined;
    return {
      id: s.id,
      label: s.label,
      short_label: s.short_label,
      branch: s.branch,
      body: sec.body,
      note: sec.note || undefined,
      answers,
      selection_mode: s.selection_mode === 'multiple' ? 'multiple' : undefined,
      continue_stage_id: typeof s.continue_stage_id === 'string' ? s.continue_stage_id : undefined,
      reveal_solution: s.reveal_solution === true ? true : undefined,
    };
  });
  return {
    id: fm.id,
    label: fm.label,
    method: fm.method,
    default: fm.default,
    fallback: fm.fallback,
    use_when: fm.use_when,
    stages,
  };
}

function isDiscoverySummaryField(value: unknown): value is DiscoverySummaryField {
  return value === 'lead_source'
    || value === 'customer_next_step'
    || value === 'customer_looks_for'
    || value === 'missing_information'
    || value === 'repeated_questions'
    || value === 'current_process_assessment';
}

function parseObjection(raw: string): Objection {
  const { fm, body } = splitFrontmatter(raw);
  if (fm.type === 'branching') {
    const sections = splitSections(body, 'Path');
    const paths: BranchingPath[] = ((fm.paths as any[]) ?? []).map((p) => {
      const sec = sections.get(p.id);
      if (!sec) throw new Error(`Objection ${fm.id}: missing "## Path: ${p.id}" body`);
      return {
        id: p.id,
        label: p.label,
        short_label: p.short_label,
        rebuttal: sec.body,
        note: sec.note || undefined,
        drop_ask_to: p.drop_ask_to,
        follow_up_note: p.follow_up_note,
        sets_followup_days: p.sets_followup_days,
      };
    });
    if (!fm.diagnostic?.prompt) {
      throw new Error(`Branching objection ${fm.id}: missing diagnostic.prompt`);
    }
    return {
      id: fm.id,
      label: fm.label,
      category: fm.category,
      type: 'branching',
      order: fm.order ?? 999,
      diagnostic: { prompt: fm.diagnostic.prompt },
      paths,
    };
  }
  // Simple objection: the body IS the rebuttal. Optional `variants` in
  // frontmatter as an array of {label, rebuttal}.
  const { body: cleanBody, note } = extractNote(body.trim());
  const rawVariants = Array.isArray(fm.variants) ? fm.variants : null;
  const variants: ObjectionVariant[] | undefined = rawVariants?.length
    ? rawVariants
        .filter((v: any) => v && typeof v.label === 'string' && typeof v.rebuttal === 'string')
        .map((v: any): ObjectionVariant => ({ label: v.label, rebuttal: v.rebuttal }))
    : undefined;
  return {
    id: fm.id,
    label: fm.label,
    category: fm.category,
    type: 'simple',
    order: fm.order ?? 999,
    rebuttal: cleanBody,
    variants,
    note: note || undefined,
  };
}

function parseFollowUp(raw: string): FollowUpSequence {
  const { fm, body } = splitFrontmatter(raw);
  const sections = splitSections(body, 'Touch');
  const touches: FollowUpTouch[] = ((fm.touches as any[]) ?? []).map((t) => {
    const sec = sections.get(t.id);
    if (!sec) throw new Error(`Follow-up ${fm.id}: missing "## Touch: ${t.id}" body`);
    return {
      id: t.id,
      label: t.label,
      short_label: t.short_label,
      body: sec.body,
      note: sec.note || undefined,
    };
  });
  return {
    id: fm.id,
    label: fm.label,
    description: fm.description,
    touches,
  };
}

// ============================================================================
// FILE REGISTRIES
// ============================================================================

const SCRIPT_FILES: Record<string, string> = {
  'cold-call-no-oriented': coldCallMd,
  'cold-call-question-oriented': coldCallQuestionMd,
  'cold-call-quick-oriented': coldCallQuickMd,
  'demo-tier3-primary': demoTier3Md,
  'demo-tier2-primary': demoTier2Md,
};

const OBJECTION_FILES: Record<string, string> = {
  'word-of-mouth': wordOfMouthMd,
  'facebook-page': facebookPageMd,
  'cant-afford': cantAffordMd,
  'bad-experience': badExperienceMd,
  'too-busy-simple': tooBusySimpleMd,
  'talk-to-partner': talkToPartnerMd,
  'too-busy': tooBusyMd,
  'send-email': sendEmailMd,
  'busy-plus-email': busyPlusEmailMd,
  'why-need-website': whyNeedWebsiteMd,
  'why-need-website-direct': whyNeedWebsiteDirectMd,
  'built-without-asking': builtWithoutAskingMd,
  'quick-im-busy': quickImBusyMd,
  'quick-too-busy': quickTooBusyMd,
  'quick-website-calls': quickWebsiteCallsMd,
  'quick-facebook-page': quickFacebookPageMd,
  'quick-why-website': quickWhyWebsiteMd,
  'quick-cost': quickCostMd,
  'quick-word-of-mouth': quickWordOfMouthMd,
  'quick-pushback': quickPushbackMd,
  'angry-disarm': angryDisarmMd,
  'total-brush-off': totalBrushOffMd,
  'why-are-you-asking': whyAreYouAskingMd,
  'early-not-interested': earlyNotInterestedMd,
};

const FOLLOW_UP_FILES: Record<string, string> = {
  'email-sequence': emailSequenceMd,
};

// ============================================================================
// LAZY CACHES (per Worker instance)
// ============================================================================

let scriptCache: Map<string, Script> | null = null;
let objectionCache: Map<string, Objection> | null = null;
let followUpCache: Map<string, FollowUpSequence> | null = null;

function loadScripts(): Map<string, Script> {
  if (scriptCache) return scriptCache;
  const m = new Map<string, Script>();
  for (const [id, raw] of Object.entries(SCRIPT_FILES)) {
    const s = parseScript(raw);
    if (s.id !== id) throw new Error(`Script filename "${id}" vs frontmatter id "${s.id}" mismatch`);
    m.set(id, s);
  }
  scriptCache = m;
  return m;
}

function loadObjections(): Map<string, Objection> {
  if (objectionCache) return objectionCache;
  const m = new Map<string, Objection>();
  for (const [id, raw] of Object.entries(OBJECTION_FILES)) {
    const o = parseObjection(raw);
    if (o.id !== id) throw new Error(`Objection filename "${id}" vs frontmatter id "${o.id}" mismatch`);
    m.set(id, o);
  }
  objectionCache = m;
  return m;
}

function loadFollowUps(): Map<string, FollowUpSequence> {
  if (followUpCache) return followUpCache;
  const m = new Map<string, FollowUpSequence>();
  for (const [id, raw] of Object.entries(FOLLOW_UP_FILES)) {
    const f = parseFollowUp(raw);
    if (f.id !== id) throw new Error(`Follow-up filename "${id}" vs frontmatter id "${f.id}" mismatch`);
    m.set(id, f);
  }
  followUpCache = m;
  return m;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function getScript(id: string): Script | null {
  return loadScripts().get(id) ?? null;
}

export function listScripts(): ScriptSummary[] {
  return Array.from(loadScripts().values()).map((s) => ({
    id: s.id,
    label: s.label,
    method: s.method,
    default: s.default,
    stage_count: s.stages.length,
  }));
}

export function getDefaultScript(): Script | null {
  for (const s of loadScripts().values()) {
    if (s.default) return s;
  }
  return null;
}

export function getObjection(id: string): Objection | null {
  return loadObjections().get(id) ?? null;
}

export function listObjections(): Objection[] {
  return Array.from(loadObjections().values()).sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.order - b.order;
  });
}

export function listObjectionsByCategory(): Record<ObjectionCategory, Objection[]> {
  const out: Record<ObjectionCategory, Objection[]> = {
    'standard': [],
    'deep-dive': [],
    'closing': [],
  };
  for (const o of listObjections()) {
    out[o.category].push(o);
  }
  return out;
}

export function getFollowUp(id: string): FollowUpSequence | null {
  return loadFollowUps().get(id) ?? null;
}

export function listFollowUps(): FollowUpSequence[] {
  return Array.from(loadFollowUps().values());
}

// ============================================================================
// TOKEN INTERPOLATION
// ============================================================================

const TOKEN_RE = /\[(Company Name|Name|city|state|their trade|review_count|review_avg|reviews)\]/g;

// scores.reviews is formatted "41 · 4.9★" by the dashboard. Pull the two
// numbers out for separate interpolation when an objection wants just the
// count (e.g. "you've got 41 reviews") or just the rating ("4.9 stars").
function parseReviewsField(raw: string | undefined, want: 'count' | 'avg' | 'combined'): string {
  if (!raw) return '';
  if (want === 'combined') return raw;
  const m = raw.match(/^\s*(\d+)\s*[·•]\s*([\d.]+)/);
  if (m) return want === 'count' ? m[1] : m[2];
  // Fallback: strip non-digits for count, return empty for avg.
  if (want === 'count') return raw.replace(/[^\d]/g, '');
  return '';
}

function tokenValue(token: string, ctx: LeadContext): string {
  switch (token) {
    case 'Company Name':
      return ctx.company || '';
    case 'Name':
      return ctx.contact_name || 'there';
    case 'city':
      return ctx.city || '';
    case 'state':
      return ctx.state || '';
    case 'their trade':
      return ctx.trade || 'your trade';
    case 'review_count':
      return parseReviewsField(ctx.scores?.reviews, 'count');
    case 'review_avg':
      return parseReviewsField(ctx.scores?.reviews, 'avg');
    case 'reviews':
      return parseReviewsField(ctx.scores?.reviews, 'combined');
    default:
      return `[${token}]`;
  }
}

export function interpolate(text: string, ctx: LeadContext): string {
  return text.replace(TOKEN_RE, (_, token) => tokenValue(token, ctx));
}

export function renderStage(stage: Stage, ctx: LeadContext): string {
  return interpolate(stage.body, ctx);
}

export function renderRebuttal(rebuttal: string, ctx: LeadContext): string {
  return interpolate(rebuttal, ctx);
}
