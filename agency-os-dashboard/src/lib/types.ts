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
  opportunity_reasoning: string | null;
  recommended_tier: number | null;
  enrichment_status: 'pending' | 'enriching' | 'enriched' | 'failed';
  enrichment_error: string | null;
  status: 'cold' | 'contacted' | 'qualified' | 'client' | 'dead';
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
  landingsite_project_id: string | null;
  landingsite_url: string | null;
  custom_domain: string | null;
  pages_built: number;
  pages_planned: number;
  next_pages_due: string | null;
  merchynt_active: number;
  contract_start: string | null;
  contract_min_end: string | null;
  status: 'building' | 'live' | 'paused' | 'dead';
  reviews_snapshot: string | null;
  gsc_property_url: string | null;
  cf_zone_id: string | null;
  client_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface HeaderStats {
  totalClients: number;
  mrrUsd: number;
}

export interface NavCounts {
  prospect: number | null;
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

// ============================================================================
// v2.1 brief / brand-attribute / testimonial types
// ============================================================================

export type BriefKind = 'master' | 'page';
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

export type Tab = 'prospect' | 'pipeline' | 'sites' | 'reports';

export type ToastType = 'default' | 'success' | 'error';
export type ShowToast = (message: string, type?: ToastType) => void;
