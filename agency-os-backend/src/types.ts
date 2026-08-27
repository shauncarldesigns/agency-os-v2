export interface Env {
  DB: D1Database;
  RECORDINGS: R2Bucket;       // agency-os-recordings — call audio captures
  ENV: string;
  CLAUDE_API_KEY: string;
  GOOGLE_PLACES_API_KEY: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_OAUTH_REFRESH_TOKEN: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  DASHBOARD_API_KEY: string;
  /** Cloudflare Access rollout: legacy (key only), mixed, or access (JWT only). */
  AUTH_MODE?: 'legacy' | 'mixed' | 'access';
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_ALLOWED_EMAIL?: string;
  DASHBOARD_ORIGIN?: string;
  CLICK_RATE_LIMITER?: RateLimit;
  RESEND_API_KEY: string;
  RESEND_WEBHOOK_SECRET?: string;
  OUTREACH_EMAIL_FROM?: string;
  OUTREACH_EMAIL_REPLY_TO?: string;
  OUTREACH_PUBLIC_URL?: string;
  OUTSCRAPER_API_KEY?: string;
  // Market research — Google Ads keyword volume (added 2026-08-06)
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_CLIENT_ID?: string;
  GOOGLE_ADS_CLIENT_SECRET?: string;
  GOOGLE_ADS_REFRESH_TOKEN?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  /** Optional client-account override for planning calls; defaults to the MCC id. */
  GOOGLE_ADS_CUSTOMER_ID?: string;
  KEYWORD_VOLUME_PROVIDER?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  CLARITY_API_TOKEN?: string;
  CLARITY_PROJECT_ID?: string;
  /** Dedicated token used only by the local Builder Employee. */
  BUILDER_API_TOKEN?: string;
}

export interface Lead {
  id: number;
  company: string;
  contact: string | null;
  phone: string | null;
  phone_e164: string | null;
  phone_valid: number | null;
  phone_line_type: string | null;
  phone_carrier: string | null;
  phone_route: string | null;
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
  extracted_local_landmarks: string | null;
  pitch_quotes: string | null;
  owner_names: string | null;
  opportunity_score: number | null;
  opportunity_reasoning: string | null;
  recommended_tier: number | null;
  enrichment_status: string;
  enrichment_error: string | null;
  enrichment_stage: string | null;
  enrichment_progress: number;
  status: string;
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
  receptionist_interested: number;
  demo_site_status: 'none' | 'live' | 'cleanup_needed' | 'deleted';
  demo_site_deleted_at: string | null;
  receptionist_interested_at: string | null;
  not_interested_reason: string | null;
  // Automated Pipeline — text + site outreach flow (added 2026-07-19).
  // Orthogonal to `status`. See routes/pipeline.ts for the state machine.
  pipeline_status: string;
  site_url: string | null;
  site_url_raw: string | null;
  site_review_status: 'pending' | 'needs_fix' | 'approved';
  site_review_reasons: string | null;
  site_review_note: string | null;
  site_review_updated_at: string | null;
  site_review_approved_at: string | null;
  pipeline_brief: string | null;
  campaign_slug: string | null;
  clarity_tag: string | null;
  pipeline_sessions: number;
  pipeline_last_action_at: string | null;
  engagement_score: number;
  engagement_grade: string;
  engagement_reasons: string | null;
  clarity_last_sync_at: string | null;
  clarity_last_error: string | null;
  clarity_ignore_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallEntry {
  id: number;
  lead_id: number;
  outcome: string;
  notes: string;
  followup_date: string | null;
  created_at: string;
}

export interface Project {
  id: number;
  lead_id: number | null;
  name: string;
  slug: string;
  tier: number;
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
  gsc_property_url: string | null;
  cf_zone_id: string | null;
  client_email: string | null;
  // DNS management (added 2026-06-14)
  domain: string | null;                       // client's domain — set later in project lifecycle via the Quick Action
  cf_nameservers: string | null;               // JSON array of Cloudflare-assigned nameserver strings
  dns_status: 'not_created' | 'pending' | 'active' | 'failed';
  dns_last_checked: string | null;
  registrar: string | null;
  domain_owner_email: string | null;
  pages_built: number;
  pages_planned: number;
  next_pages_due: string | null;
  merchynt_active: number;
  contract_start: string | null;
  contract_min_end: string | null;
  status: string;
  is_internal: number;
  pages_needing_build?: number;
  growth_cycle_id?: number | null;
  growth_cycle_period?: string | null;
  growth_cycle_phase?: 'foundation' | 'expansion' | 'optimization' | null;
  growth_cycle_status?: 'planning' | 'active' | 'complete' | null;
  growth_cycle_due_date?: string;
  growth_cycle_health?: 'healthy' | 'attention' | 'urgent';
  growth_items_total?: number;
  growth_items_completed?: number;
  growth_items_blocked?: number;
  onboarding_completed?: number;
  onboarding_total?: number;
  onboarding_percent?: number;
  reviews_snapshot: string | null;
  created_at: string;
  updated_at: string;
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

// ============================================================================
// v2.1 entities
// ============================================================================

export type BriefKind = 'master' | 'page';
/**
 * Brief status values:
 *  - 'briefed': page brief generated, not yet marked live by operator
 *  - 'complete': page brief's page is live (operator marked the page complete)
 *  - 'draft' / 'saved': master brief states (kept loose; master never goes to complete)
 *  - 'archived': prior version after regenerate (chained via supersedes_brief_id)
 */
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

export type PageStatus = 'planned' | 'briefed' | 'complete';
export type PageBillingStatus = 'included' | 'add_on' | 'comp';

export interface Page {
  id: number;
  project_id: number;
  type: string;
  service: string | null;
  city: string | null;
  slug: string | null;
  url: string | null;
  title: string | null;
  meta_description: string | null;
  status: PageStatus | string;
  brief_content: string | null;
  built_at: string | null;
  brief_id: number | null;
  batch_period: string | null;        // legacy column from v2.1, no longer written
  billing_status: PageBillingStatus | string;
  published_url: string | null;
  marked_complete_at: string | null;
  operator_notes: string | null;
  created_at: string;
}

// ============================================================================
// Calling dashboard (added 2026-06-14)
// ============================================================================

export type SessionBlock = 'morning' | 'evening';
export type SessionStatus = 'planned' | 'active' | 'complete';
export type CallOutcome = 'no_answer' | 'voicemail' | 'not_interested' | 'bad_contact' | 'callback' | 'booked' | 'skipped';
export type DemoStatus = 'booked' | 'held' | 'no_show' | 'rescheduled';
export type CallbackStatus = 'pending' | 'completed' | 'missed' | 'cancelled';

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

export interface WeeklyRotation {
  id: 1;
  last_industry: string | null;
  last_session_at: string | null;
  updated_at: string;
}
