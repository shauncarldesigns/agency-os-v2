export interface Env {
  DB: D1Database;
  BRIEF_QUEUE: Queue<BriefJobMessage>;
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
}

export interface BriefJobMessage {
  jobId: number;
  projectId: number;
  pageId?: number;
  jobType: 'initial-build' | 'add-page';
  briefMarkdown: string;
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
  pitch_quotes: string | null;
  owner_names: string | null;
  opportunity_score: number | null;
  recommended_tier: number | null;
  enrichment_status: string;
  enrichment_error: string | null;
  status: string;
  outcome: string | null;
  followup: string | null;
  notes: string | null;
  source: string | null;
  project_id: number | null;
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
  primary_color: string | null;
  brand_voice_notes: string | null;
  services: string | null;
  service_areas: string | null;
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
