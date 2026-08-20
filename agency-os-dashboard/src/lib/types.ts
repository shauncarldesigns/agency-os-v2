export interface Lead {
  id: number;
  company: string;
  contact: string | null;
  phone: string | null;
  phone_e164: string | null;
  phone_valid: number | null;
  phone_line_type: string | null;
  phone_carrier: string | null;
  phone_route: 'text' | 'call' | 'review' | 'unknown' | null;
  phone_lookup_error: string | null;
  phone_lookup_at: string | null;
  email: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  place_id: string | null;
  gbp_claimed: number;
  gbp_completeness: number | null;
  gbp_photos_count: number | null;
  gbp_categories: string | null;
  gbp_hours: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  google_reviews: string | null;
  reviews_fetched_at: string | null;
  website: string | null;
  has_website: number;
  pagespeed_desktop: number | null;
  pagespeed_mobile: number | null;
  extracted_services: string | null;
  extracted_service_areas: string | null;
  extracted_strengths: string | null;
  pitch_quotes: string | null;
  owner_names: string | null;
  opportunity_score: number | null;
  opportunity_reasoning: string | null;
  recommended_tier: number | null;
  enrichment_status: 'pending' | 'enriching' | 'enriched' | 'failed';
  enrichment_error: string | null;
  enrichment_stage: string | null;
  enrichment_progress: number;
  // Lead lifecycle (Phase-0 vocabulary):
  // - cold           — never called
  // - contacted      — called at least once, no commitment
  // - qualified      — demo booked, prospect project exists, awaiting outcome
  // - client         — signed, has a building/live project (counts toward MRR)
  // - not_interested — cold-called and declined; out of the calling pool
  // - dead           — former client who churned (not for cold-call rejections)
  status: 'cold' | 'contacted' | 'qualified' | 'client' | 'not_interested' | 'dead';
  outcome: string | null;
  followup: string | null;
  notes: string | null;
  source: string | null;
  project_id: number | null;
  deleted_at: string | null;
  // Calling dashboard (added 2026-06-14)
  pitch_card_text: string | null;
  pitch_card_generated_at: string | null;
  last_called_at: string | null;
  demo_booked_at: string | null;
  demo_scheduled_for: string | null;
  // Automated Pipeline — text + site outreach flow (added 2026-07-19).
  // Orthogonal to `status` — a lead can be 'contacted' in the cold-call
  // flow AND 'ready_to_send' in the automated flow at the same time.
  pipeline_status: 'awaiting_build' | 'built_needs_review' | 'ready_to_send' | 'sent_no_reply' | 'engaged' | 'booked' | 'archived';
  site_url: string | null;                     // UTM-tagged; source of truth for texting
  site_url_raw: string | null;                 // as-pasted, pre-UTM
  pipeline_brief: string | null;               // landingsite brief for this lead's site
  campaign_slug: string | null;                // slugified name used in the UTM campaign
  clarity_tag: string | null;                  // Clarity custom-tag id
  pipeline_sessions: number;                   // engagement counter (click-tracker + Clarity)
  pipeline_last_action_at: string | null;      // ISO timestamp — display string derived client-side
  pipeline_last_action?: string | null;        // derived latest non-undone activity action
  pipeline_last_action_meta?: string | null;   // JSON metadata for that activity
  pipeline_last_action_created_at?: string | null;
  pipeline_followup_step?: number;             // derived from Engaged follow-up activity
  pipeline_no_reply_step?: number;             // derived from Sent — No Reply activity
  pipeline_replied?: number;                   // 1 after a non-undone manual reply event
  pipeline_calendar_sent?: number;
  pipeline_calendar_clicked?: number;
  pipeline_scheduling_followup_sent?: number;
  engagement_score: number;
  engagement_grade: 'hot' | 'walkthrough' | 'follow_up' | 'nurture' | string;
  engagement_reasons: string | null;
  clarity_last_sync_at: string | null;
  clarity_last_error: string | null;
  clarity_ignore_until: string | null;
  created_at: string;
  updated_at: string;
}

// One row per pipeline action. Backs the `/undo` endpoint and the lead
// detail modal's activity trail.
export interface LeadActivity {
  id: number;
  lead_id: number;
  action:
    | 'brief_generated'
    | 'email_captured'
    | 'email_sent'
    | 'email_followed_up'
    | 'email_final_touch'
    | 'email_delivered'
    | 'email_opened'
    | 'email_clicked'
    | 'email_bounced'
    | 'email_complained'
    | 'email_failed'
    | 'email_suppressed'
    | 'email_final_review'
    | 'email_review_extended'
    | 'automation_stopped'
    | 'url_saved'
    | 'site_approved'
    | 'intro_sent'
    | 'followed_up'
    | 'reply_received'
    | 'call_outcome'
    | 'calendar_sent'
    | 'scheduling_followup'
    | 'called'
    | 'status_changed'
    | 'click_observed'
    | 'click_confirmation_screened'
    | 'click_tracked'
    | 'calendar_clicked'
    | 'clarity_synced'
    | 'engagement_reset'
    | 'client_converted'
    | 'undo';
  from_status: string | null;
  to_status: string | null;
  meta: string | null;                          // JSON blob
  created_at: string;
}

export interface CallEntry {
  id: number;
  lead_id: number;
  outcome: string;
  notes: string;
  followup_date: string | null;
  recording_url: string | null;     // Authenticated API URL when operator recorded this call
  created_at: string;
}

export interface ProspectResult {
  placeId: string;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  types: string[];
  primaryType: string | null;
  hasHours: boolean;
  hasDescription: boolean;
  photoCount: number;
  claimed: boolean;
  businessStatus: string | null;
  alreadyInPipeline: boolean;
  opportunityScore: number;
  recommendedTier: 1 | 2 | 3;
  reasoning: string;
}

export interface Project {
  id: number;
  lead_id: number | null;
  name: string;
  slug: string;
  tier: 1 | 2 | 3;
  business_name: string;
  industry: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  description: string | null;
  years_in_business: number | null;
  founded_year: number | null;
  owner_name: string | null;
  owner_credentials: string | null;
  primary_color: string | null;
  accent_color: string | null;
  tagline: string | null;
  photography_direction: string | null;
  brand_voice_notes: string | null;
  services: string | null;
  service_areas: string | null;
  monthly_pages_target: number;
  scrape_completed_at: string | null;
  scrape_data: string | null;
  landingsite_url: string | null;
  custom_domain: string | null;
  pages_built: number;
  pages_planned: number;
  next_pages_due: string | null;
  merchynt_active: number;
  contract_start: string | null;
  contract_min_end: string | null;
  /**
   * Project lifecycle:
   * - 'prospect' — qualified, pitching, not yet signed. EXCLUDED from MRR.
   * - 'building' — signed client, site under construction. Counts toward MRR.
   * - 'live'     — site is live. Counts toward MRR.
   * - 'paused'   — temporarily inactive client. Counts toward MRR.
   * - 'dead'     — churned. Excluded from MRR.
   */
  status: 'prospect' | 'building' | 'live' | 'paused' | 'dead';
  /** Internal/test workspace: visible in Clients & Sites, excluded from MRR and conversion stats. */
  is_internal: number;
  /** Derived by the project-list query for the Clients & Sites action queue. */
  pages_needing_build?: number;
  growth_cycle_id?: number | null;
  growth_cycle_period?: string | null;
  growth_cycle_phase?: GrowthPhase | null;
  growth_cycle_status?: GrowthCycleStatus | null;
  growth_cycle_due_date?: string;
  growth_cycle_health?: 'healthy' | 'attention' | 'urgent';
  growth_items_total?: number;
  growth_items_selected?: number;
  growth_items_completed?: number;
  growth_items_blocked?: number;
  growth_bonus_completed?: number;
  onboarding_completed?: number;
  onboarding_total?: number;
  onboarding_percent?: number;
  reviews_snapshot: string | null;
  gsc_property_url: string | null;
  cf_zone_id: string | null;
  client_email: string | null;
  // DNS management (added 2026-06-14)
  domain: string | null;
  cf_nameservers: string | null;               // JSON array of CF nameservers; parse before use
  dns_status: 'not_created' | 'pending' | 'active' | 'failed';
  dns_last_checked: string | null;
  registrar: string | null;
  domain_owner_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectActivityEvent {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  occurredAt: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'error';
}

export interface ProjectDiscovery {
  project_id: number;
  status: 'draft' | 'complete';
  is_test_mode: number;
  answers_json: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DiscoveryAnswers = Record<string, string | boolean>;

export interface HeaderStats {
  totalClients: number;
  mrrUsd: number;
}

export interface NavCounts {
  prospect: number | null;
  callOutreach: number;
  pipeline: number;
  sites: number;
}

export type PageStatus = 'planned' | 'briefed' | 'in_progress' | 'complete' | 'archived';

export interface Page {
  id: number;
  project_id: number;
  type: 'homepage' | 'service' | 'service-area' | 'about' | 'faq' | 'contact' | string;
  service: string | null;
  city: string | null;
  slug: string | null;
  url: string | null;
  title: string | null;
  meta_description: string | null;
  status: PageStatus | string;
  built_at: string | null;
  brief_id: number | null;
  batch_period: string | null;
  published_url: string | null;
  marked_complete_at: string | null;
  operator_notes: string | null;
  created_at: string;
}

export type GrowthPhase = 'foundation' | 'expansion' | 'optimization';
export type GrowthCycleStatus = 'planning' | 'active' | 'complete';
export type GrowthWorkCategory = 'created' | 'improved' | 'google_business' | 'proof' | 'measured' | 'technical' | 'conversion';
export type GrowthWorkStatus = 'planned' | 'in_progress' | 'complete' | 'blocked';

export interface GrowthCycle {
  id: number;
  project_id: number;
  period: string;
  phase: GrowthPhase;
  status: GrowthCycleStatus;
  due_date: string;
  client_summary: string | null;
  next_priorities: string | null;
  generated_at: string | null;
  generated_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type GrowthPlanningMode = 'auto' | 'balanced' | 'expansion' | 'optimization';
export interface GrowthStrategy {
  project_id: number;
  planning_mode: GrowthPlanningMode;
  primary_objective: string | null;
  priority_services: string;
  priority_areas: string;
  seasonal_priorities: string | null;
  constraints: string | null;
  auto_generate: number;
  require_approval: number;
}

export interface GrowthWorkItem {
  id: number;
  cycle_id: number;
  category: GrowthWorkCategory;
  title: string;
  description: string | null;
  status: GrowthWorkStatus;
  evidence_url: string | null;
  page_id: number | null;
  brief_id: number | null;
  recommended_page_type: string | null;
  recommended_service: string | null;
  recommended_city: string | null;
  completion_signal: 'gsc_connected' | 'seo_snapshot_available' | null;
  work_tier: 'committed' | 'bonus';
  client_visible: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageSearchMetrics {
  period: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number | null;
  positionChange: number | null;
  impressionsChange: number | null;
}

export interface PageInsightBrief {
  id: number;
  project_id: number;
  kind: BriefKind;
  page_id: number;
  status: BriefStatus;
  version: number;
  generated_by_model: string | null;
  generation_input: string | null;
  generated_at: string;
  updated_at: string | null;
  completed_at: string | null;
  supersedes_brief_id: number | null;
}

export interface PageInsightWorkItem extends GrowthWorkItem {
  period: string;
  phase: GrowthPhase;
}

export interface PageInsights {
  page: Page;
  briefs: PageInsightBrief[];
  work_items: PageInsightWorkItem[];
  metrics_history: PageSearchMetrics[];
  audit_findings: SeoAuditFinding[];
}

export interface SeoAuditRun {
  id: number;
  project_id: number;
  status: 'running' | 'complete' | 'failed';
  start_url: string;
  pages_crawled: number;
  critical_count: number;
  warning_count: number;
  opportunity_count: number;
  health_score: number | null;
  robots_status: string | null;
  sitemap_status: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface SeoAuditFinding {
  id: number;
  run_id: number;
  project_id: number;
  page_id: number | null;
  page_url: string | null;
  severity: 'critical' | 'warning' | 'opportunity';
  rule_key: string;
  title: string;
  details: string;
  fingerprint: string;
  created_at: string;
}

export interface OnboardingItem {
  key: string;
  label: string;
  description: string;
  mode: 'automatic' | 'manual';
  completed: boolean;
  completed_at?: string | null;
  notes?: string | null;
}

// ============================================================================
// v2.1 brief / brand-attribute / testimonial types
// ============================================================================

export type BriefKind = 'master' | 'page' | 'outreach';
export type BriefStatus = 'briefed' | 'complete' | 'draft' | 'saved' | 'archived';

export interface Brief {
  id: number;
  project_id: number;
  kind: BriefKind;
  page_id: number | null;
  content_markdown: string;
  status: BriefStatus;
  version: number;
  tbd_count: number;
  generated_by_model: string | null;
  generation_input: string | null;
  generated_at: string;
  updated_at: string | null;
  completed_at: string | null;
  supersedes_brief_id: number | null;
}

export type BriefSummary = Omit<Brief, 'content_markdown' | 'generation_input'>;

export type BrandAttributeCategory =
  | 'tagline'
  | 'certification'
  | 'review_theme'
  | 'photography_direction'
  | 'positioning'
  | 'differentiator'
  | 'value'
  | 'other';

export type BrandAttributeSource = 'scrape' | 'reviews' | 'operator' | 'claude';

export interface BrandAttribute {
  id: number;
  project_id: number;
  category: BrandAttributeCategory;
  value: string;
  source: BrandAttributeSource | null;
  weight: number;
  created_at: string;
}

export type TestimonialSource = 'google' | 'operator' | 'website' | 'other';

export interface Testimonial {
  id: number;
  project_id: number;
  author_name: string;
  author_location: string | null;
  quote: string;
  rating: number | null;
  source: TestimonialSource | null;
  is_featured: number;
  created_at: string;
}

export interface ReportSnapshot {
  id: number;
  project_id: number;
  period: string;
  impressions: number | null;
  clicks: number | null;
  avg_position: number | null;
  ctr: number | null;
  pagespeed_desktop: number | null;
  pagespeed_mobile: number | null;
  visitors: number | null;
  pageviews: number | null;
  top_keywords: string | null;
  top_pages: string | null;
  exec_summary: string | null;
  created_at: string;
}

export interface KeywordWin {
  query: string;
  previousPosition: number | null;
  currentPosition: number;
  delta: number | 'NEW';
  impressions: number;
  clicks: number;
}

export interface ReportSummary {
  project: {
    id: number;
    name: string;
    city: string | null;
    state: string | null;
    tier: 1 | 2 | 3;
    client_email: string | null;
    custom_domain: string | null;
    landingsite_url: string | null;
  };
  period: string;
  previousPeriod: string;
  current: ReportSnapshot | null;
  previous: ReportSnapshot | null;
  pagesBuilt: Array<{ type: string; service: string | null; city: string | null; slug: string | null; built_at: string | null }>;
  keywordWins: KeywordWin[];
}

export type Tab =
  | 'dashboard'
  | 'research'
  | 'email-outreach'
  | 'call-center'
  | 'prospect'
  | 'pipeline'
  | 'automated-pipeline'
  | 'builder'
  | 'sites'
  | 'docs'
  | 'playbook'
  | 'settings';

export interface AgencySettings {
  general: {
    agencyName: string; operatorName: string; operatorEmail: string; initials: string;
    timezone: string; currency: string; dateFormat: string; defaultServiceArea: string;
    appearance: 'light' | 'system';
  };
  outreach: {
    sessionSize: number; scoreFloor: number; industryRotation: string[];
    geographicFilters: string[]; callingDays: string[]; callingBlocks: string[];
    recallCooldownDays: number; hotThreshold: number; walkthroughThreshold: number;
    followUpThreshold: number;
  };
  defaults: {
    tier1Mrr: number; tier2Mrr: number; tier3Mrr: number; services: string[];
    serviceAreas: string[]; reportSenderName: string; reportSenderEmail: string;
    companyVoice: string; bannedPhrases: string[];
  };
  discovery: {
    enabled: boolean;
    websiteMode: 'no_website';
    phoneRequired: boolean;
    industries: string[];
    locations: string[];
    runDays: string[];
    localRunHour: number;
    maxCandidatesPerRun: number;
    inboxLimit: number;
    scoreFloor: number;
    suppressionDays: number;
    expirationDays: number;
  };
  research: {
    seedTemplates: string[];
    industryTerms: Record<string, string>;
    mapPackKeywordCount: number;
    mapPackResultLimit: number;
    batchCap: number;
    provider: 'google_ads' | 'dataforseo';
  };
  updatedAt: string | null;
}

// ============================================================================
// Market research (added 2026-08-06)
// ============================================================================

export interface Market {
  id: number;
  industry: string;
  location_label: string;
  geo_target_id: string;
  latitude: number;
  longitude: number;
  is_active: number;
  last_researched_at: string | null;
  created_at: string;
}

export interface MarketListRow extends Market {
  headline_keyword: string | null;
  headline_volume: number | null;
  keyword_count: number;
  /** SUM of monthly_volume across all the market's keywords — category
   *  demand. Related queries overlap, so compare markets with it rather
   *  than reading it as unique searchers. */
  total_volume: number | null;
  volume_keyword_count: number;
  last_run_status: string | null;
}

export interface MarketKeyword {
  id: number;
  market_id: number;
  run_id: number | null;
  keyword: string;
  monthly_volume: number | null;
  competition: string | null;
  competition_index: number | null;
  cpc_low: number | null;
  cpc_high: number | null;
  trend_json: string | null;
  is_near_me: number;
  fetched_at: string;
}

export interface MapPackRow {
  id: number;
  market_id: number;
  run_id: number | null;
  keyword: string;
  position: number;
  place_id: string | null;
  company: string;
  has_website: number;
  website: string | null;
  google_rating: number | null;
  review_count: number | null;
  captured_at: string;
}

export interface ResearchRun {
  id: number;
  market_id: number;
  trigger: 'manual' | 'scheduled';
  provider: string;
  status: 'running' | 'complete' | 'failed' | 'partial';
  keywords_count: number;
  error_detail: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface ResearchRunSummary {
  runId: number;
  marketId: number;
  status: 'complete' | 'partial' | 'failed';
  keywordsStored: number;
  mapPackKeywords: string[];
  mapPackRowsStored: number;
  errorDetail: string | null;
}

export interface ProspectCandidate {
  id: number; place_id: string; company: string; phone: string | null; website: string | null;
  address: string | null; city: string | null; state: string | null; industry: string;
  search_location: string; google_rating: number | null; google_review_count: number | null;
  gbp_claimed: number; gbp_photos_count: number; opportunity_score: number;
  recommended_tier: 1 | 2 | 3; score_reasoning: string | null;
  source: 'automated' | 'manual'; status: 'pending' | 'approved' | 'rejected' | 'expired';
  first_seen_at: string; last_seen_at: string; lead_id: number | null;
}

export interface ProspectInboxSummary {
  pending: number; newToday: number; approvedThisWeek: number; rejected: number;
  lastRun: {
    id: number; status: string; trigger_type: 'scheduled' | 'manual'; industry: string; search_location: string;
    started_at: string; results_found: number; new_candidates: number; refreshed_candidates: number;
    skipped_existing: number; skipped_ineligible: number; error_message: string | null;
  } | null;
  schedule: {
    enabled: boolean; localRunHour: number; timezone: string;
    upcoming: Array<{ industry: string; location: string; date: string | null; weekday: string | null }>;
  } | null;
}

export interface SettingsHealth {
  status: 'ok'; checkedAt: string;
  integrations: Array<{ id: string; name: string; configured: boolean; optional?: boolean; detail: string; lastSuccessAt?: string | null }>;
  system: { database: string; environment: string; counts: { leads: number; projects: number; sessions: number }; lastAutomationAt: string | null };
}

export type ToastType = 'default' | 'success' | 'error';
export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}
export type ShowToast = (message: string, type?: ToastType, action?: ToastAction) => void;

// ============================================================================
// Calling dashboard (added 2026-06-14)
// ============================================================================

export type SessionBlock = 'morning' | 'evening';
export type SessionStatus = 'planned' | 'active' | 'complete';
export type CallOutcome = 'no_answer' | 'voicemail' | 'not_interested' | 'callback' | 'booked' | 'skipped';
export type DemoStatus = 'booked' | 'held' | 'no_show' | 'rescheduled';

export interface ApplicationEvent {
  id: number;
  level: 'info' | 'warn' | 'error';
  source: string;
  event_type: string;
  message: string;
  method: string | null;
  path: string | null;
  status_code: number | null;
  duration_ms: number | null;
  details_json: string | null;
  created_at: string;
}
export type CallbackStatus = 'pending' | 'completed' | 'missed';

export type SessionKind = 'auto' | 'hot';

export interface Session {
  id: number;
  session_date: string;
  block: SessionBlock;
  industry: string;
  geographic_filter: string | null;   // JSON array; null = full service area
  score_floor: number;
  lead_count_target: number;
  status: SessionStatus;
  kind: SessionKind;                  // 'auto' (composed) | 'hot' (operator-curated)
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface SessionLead {
  id: number;
  session_id: number;
  lead_id: number;
  position: number;
  call_outcome: CallOutcome | null;
  called_at: string | null;
  is_callback: number;                // bool — 0 or 1
}

export interface Callback {
  id: number;
  lead_id: number;
  due_date: string;
  block_hint: SessionBlock | null;
  notes: string | null;
  status: CallbackStatus;
  completed_at: string | null;
  created_at: string;
}

export type DemoInterestLevel = 'hot' | 'warm' | 'cold';

export interface Demo {
  id: number;
  lead_id: number;
  booked_at: string;
  scheduled_for: string;
  status: DemoStatus;
  honeybook_confirmed: number;        // bool — 0 or 1
  outcome_notes: string | null;
  status_set_at: string | null;
  interest_level: DemoInterestLevel | null;
  created_at: string;
}

export interface DemoEvent {
  id: number;
  demo_id: number;
  event_type: 'created' | 'held' | 'no_show' | 'rescheduled';
  event_data: string | null;          // JSON
  created_at: string;
}
