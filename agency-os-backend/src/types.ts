export interface Env {
  DB: D1Database;
  ENV: string;
  CLAUDE_API_KEY: string;
  GOOGLE_PLACES_API_KEY: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_OAUTH_REFRESH_TOKEN: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  DASHBOARD_API_KEY: string;
  RESEND_API_KEY: string;
  OUTSCRAPER_API_KEY?: string;
}

export interface Lead {
  id: number;
  company: string;
  contact: string | null;
  phone: string | null;
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
  status: string;
  outcome: string | null;
  followup: string | null;
  notes: string | null;
  source: string | null;
  project_id: number | null;
  deleted_at: string | null;
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
  landingsite_project_id: string | null;
  landingsite_url: string | null;
  custom_domain: string | null;
  gsc_property_url: string | null;
  cf_zone_id: string | null;
  client_email: string | null;
  pages_built: number;
  pages_planned: number;
  next_pages_due: string | null;
  merchynt_active: number;
  contract_start: string | null;
  contract_min_end: string | null;
  status: string;
  reviews_snapshot: string | null;
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
