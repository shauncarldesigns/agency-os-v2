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
  enrichment_status: 'pending' | 'enriching' | 'enriched' | 'failed';
  enrichment_error: string | null;
  status: 'cold' | 'contacted' | 'qualified' | 'client' | 'dead';
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
  primary_color: string | null;
  brand_voice_notes: string | null;
  services: string | null;
  service_areas: string | null;
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
  build: number;
  sites: number;
}

export interface Page {
  id: number;
  project_id: number;
  type: 'homepage' | 'service' | 'service-area' | 'about' | 'faq' | 'contact';
  service: string | null;
  city: string | null;
  slug: string | null;
  url: string | null;
  title: string | null;
  meta_description: string | null;
  status: 'queued' | 'building' | 'built' | 'failed';
  built_at: string | null;
  created_at: string;
}

export interface BriefJob {
  id: number;
  project_id: number;
  page_id: number | null;
  job_type: 'initial-build' | 'add-page';
  status: 'queued' | 'processing' | 'done' | 'failed';
  cowork_started_at: string | null;
  cowork_completed_at: string | null;
  error_message: string | null;
  created_at: string;
  project_name?: string;
  project_tier?: 1 | 2 | 3;
}

export interface QueueStatus {
  active: BriefJob[];
  recent: BriefJob[];
  counts: { queued: number; processing: number };
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

export interface BuildContext {
  leadId?: number;
  projectId?: number;
  businessName: string;
  tier: 1 | 2 | 3;
  reviewCount?: number | null;
}

export type Tab = 'prospect' | 'pipeline' | 'build' | 'sites' | 'reports';

export type ToastType = 'default' | 'success' | 'error';
export type ShowToast = (message: string, type?: ToastType) => void;
