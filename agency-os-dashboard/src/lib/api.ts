import type {
  Lead, LeadActivity, CallEntry, ProspectResult, Project, ProjectDiscovery, DiscoveryAnswers, Page, ReportSummary,
  Brief, BriefSummary, BrandAttribute, BrandAttributeCategory, BrandAttributeSource,
  Testimonial, TestimonialSource,
  Session, SessionBlock, CallOutcome, Demo, DemoStatus, Callback, CallbackStatus,
  AgencySettings, SettingsHealth, ProspectCandidate, ProspectInboxSummary,
  GrowthCycle, GrowthWorkItem, GrowthPhase, GrowthWorkCategory, GrowthWorkStatus, GrowthStrategy, OnboardingItem, PageSearchMetrics, PageInsights,
  SeoAuditRun, SeoAuditFinding, ApplicationEvent, ProjectActivityEvent,
  Market, MarketListRow, MarketKeyword, MapPackRow, ResearchRun, ResearchRunSummary,
} from './types';
import type {
  ScriptSummary, Script, ObjectionsByCategory, Objection, FollowUpSequence,
  GenerateRebuttalRequest, GenerateRebuttalResponse, ObjectionHit,
} from './playbook';
import { reauthenticateWithAccess } from './accessSession';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8788';
const TRACKING_BASE = (import.meta.env.VITE_TRACKING_URL as string | undefined) ?? API_BASE;
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? '';

function authHeaders(): Record<string, string> {
  return API_KEY ? { 'X-API-Key': API_KEY } : {};
}

function authenticatedRecordingPlaybackUrl(value: string): string {
  const authenticatedPrefix = '/api/recordings/file/';
  let key: string | null = null;

  if (value.startsWith('r2://')) {
    key = value.slice('r2://'.length);
  } else {
    try {
      const parsed = new URL(value, API_BASE);
      if (parsed.pathname.startsWith(authenticatedPrefix)) {
        key = decodeURIComponent(parsed.pathname.slice(authenticatedPrefix.length));
      } else if (parsed.hostname.endsWith('.r2.dev')) {
        key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      }
    } catch {
      key = value;
    }
  }

  const normalizedKey = key?.replace(/^\/+/, '') ?? '';
  if (!normalizedKey.startsWith('calls/') || normalizedKey.includes('..') || normalizedKey.includes('\\')) return value;
  const encodedKey = normalizedKey.split('/').map(encodeURIComponent).join('/');
  return `${API_BASE.replace(/\/$/, '')}${authenticatedPrefix}${encodedKey}`;
}

/**
 * Project update payload. The DB stores `services` and `service_areas` as
 * JSON-encoded strings, but the backend PUT route accepts arrays (and does
 * the JSON.stringify server-side) — so this type widens those two fields to
 * `string[]` for callers, while leaving every other field as the project
 * shape's native type.
 */
export type ProjectUpdate = Omit<Partial<Project>, 'services' | 'service_areas'> & {
  services?: string[];
  service_areas?: string[];
};

export interface EmailAutomationSummary {
  id: number;
  lead_id: number;
  status: 'active' | 'paused' | 'completed' | 'stopped' | 'failed';
  current_step: 'review_wait' | 'signal_wait' | 'final_wait' | 'archive_wait' | 'complete';
  branch: 'no_open' | 'opened_no_click' | 'demo_clicked' | null;
  next_run_at: string | null;
  initial_send_id: number | null;
  followup_send_id: number | null;
  final_send_id: number | null;
  pending_subject: string | null;
  pending_text: string | null;
  paused_at: string | null;
  completed_at: string | null;
  stopped_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  company: string;
  email: string;
  pipeline_status: string;
  engagement_score: number;
  engagement_grade: string;
  pipeline_sessions: number;
  site_url: string | null;
  initial_status: string | null;
  initial_sent_at: string | null;
  initial_delivered_at: string | null;
  initial_opened_at: string | null;
  initial_clicked_at: string | null;
  initial_provider_message_id: string | null;
  followup_status: string | null;
  followup_sent_at: string | null;
  followup_delivered_at: string | null;
  followup_opened_at: string | null;
  followup_clicked_at: string | null;
  followup_provider_message_id: string | null;
  final_status: string | null;
  final_sent_at: string | null;
  final_delivered_at: string | null;
  final_opened_at: string | null;
  final_clicked_at: string | null;
  final_provider_message_id: string | null;
}

export interface EmailSendRecord {
  id: number;
  lead_id: number;
  recipient: string;
  sender: string;
  reply_to: string | null;
  subject: string;
  template_key: string;
  text_body: string;
  status: string;
  provider_message_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface EmailEventRecord {
  id: number;
  email_send_id: number | null;
  provider_message_id: string | null;
  event_type: string;
  event_at: string;
  payload: string | null;
}

export interface EmailAutomationDetail {
  automation: EmailAutomationSummary;
  lead: Lead;
  sends: EmailSendRecord[];
  events: EmailEventRecord[];
  nextTemplate: {
    subject: string;
    text: string;
    templateKey: string;
    action: string;
  } | null;
}

export interface BuilderJob {
  id: number;
  lead_id: number;
  business_name: string;
  status: 'waiting' | 'building' | 'completed' | 'retry' | 'failed';
  attempt_count: number;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  demo_url: string | null;
  failure_reason: string | null;
  artifact_path: string | null;
  email: string | null;
  pipeline_status: string;
  site_url: string | null;
  site_url_raw: string | null;
  has_brief: number;
}

export interface BuilderEvent {
  id: number;
  run_id: number;
  job_id: number | null;
  event_type: string;
  state: string | null;
  step: string | null;
  message: string | null;
  metadata: string | null;
  business_name: string | null;
  created_at: string;
}

export interface BuilderRunSummary {
  id: number;
  status: 'starting'|'running'|'paused'|'stopped'|'completed'|'error';
  total_jobs: number;
  started_at: string;
  ended_at: string|null;
  error_reason: string|null;
  completed_jobs: number;
  failed_jobs: number;
  remaining_jobs: number;
  average_ms: number|null;
}

export interface BuilderStatus {
  awaitingBuild: number;
  readyToQueue: number;
  missingBriefLeads: Array<{id:number;company:string;email:string|null;phone_route:string|null}>;
  nextBatchLeads: Array<{id:number;company:string;email:string|null;phone_route:string|null;crm_status:string;outcome:string|null;has_brief:number}>;
  safetyExcluded: Array<{id:number;company:string;crmStatus:string;outcome:string|null;reason:string}>;
  control: {
    paused: number;
    stop_requested: number;
    active_run_id: number | null;
    effective_state: 'offline' | 'idle' | 'starting' | 'running' | 'building' | 'login_required' | 'paused' | 'error';
    current_step: string | null;
    worker_message: string | null;
    last_worker_seen_at: string | null;
  };
  run: { id: number; status: 'starting'|'running'|'paused'|'stopped'|'completed'|'error'; total_jobs: number; started_at: string; ended_at: string|null; error_reason: string|null } | null;
  jobs: BuilderJob[];
  events: BuilderEvent[];
  runHistory: BuilderRunSummary[];
  metrics: { averageMs:number|null;medianMs:number|null;sampleSize:number;completedToday:number;failedToday:number };
  health: { apiConnected:boolean;workerOnline:boolean;landingSiteAuthenticated:boolean;readyToStart:boolean };
  resume: { canResume:boolean;jobId:number|null;businessName:string|null;reason:string|null };
}

// DNS endpoint response shapes. Mirror what routes/dns.ts returns.
export interface DnsRecordStatus {
  type: 'A' | 'CNAME';
  subdomain: string;
  hostname: string;
  content: string;
  found: boolean;
}

export interface DnsSetupResponse {
  project: Project;
  nameservers: string[];
  failures: string[];                 // empty on full success
  status: 'pending' | 'failed';
}

export interface DnsStatusResponse {
  // Raw Cloudflare zone status — may differ from dns_status briefly until
  // the backend reconciles (e.g. CF=active but we haven't yet flipped).
  zone_status: 'pending' | 'active' | 'initializing' | 'moved' | 'deleted' | 'deactivated';
  dns_status: 'not_created' | 'pending' | 'active' | 'failed';
  nameservers: string[];
  records: DnsRecordStatus[];
  last_checked: string;
}

export interface DnsRetryResponse {
  created: string[];                  // newly-created records (human-readable strings)
  failures: string[];
  status: 'not_created' | 'pending' | 'active' | 'failed';
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message);
  }
}

function qs(params?: Record<string, string | number | boolean | undefined | null>): string {
  if (!params) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers as Record<string, string> | undefined ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    if (res.status === 401) reauthenticateWithAccess();
    throw new ApiError(err.error ?? res.statusText, res.status, err);
  }
  // DELETE endpoints correctly return 204 No Content. Treat that as a
  // successful void response instead of trying to parse an empty JSON body.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  research: {
    markets: () => apiFetch<{ markets: MarketListRow[] }>('/api/research/markets'),
    market: (id: number) =>
      apiFetch<{ market: Market; keywords: MarketKeyword[]; mapPack: Record<string, MapPackRow[]>; runs: ResearchRun[] }>(`/api/research/markets/${id}`),
    addMarket: (data: { industry: string; geo_target_id: string }) =>
      apiFetch<{ market: Market }>('/api/research/markets', { method: 'POST', body: JSON.stringify(data) }),
    geoTargets: (q: string) =>
      apiFetch<{ targets: Array<{ criteria_id: string; name: string; canonical_name: string; state: string }> }>(`/api/research/geo-targets?q=${encodeURIComponent(q)}`),
    updateMarket: (id: number, data: Partial<Pick<Market, 'is_active' | 'location_label' | 'geo_target_id' | 'latitude' | 'longitude'>>) =>
      apiFetch<{ market: Market }>(`/api/research/markets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteMarket: (id: number) =>
      apiFetch<{ deleted: boolean }>(`/api/research/markets/${id}`, { method: 'DELETE' }),
    run: (id: number) =>
      apiFetch<{ run: ResearchRunSummary | null; stoppedEarly: string | null; error?: string }>(`/api/research/markets/${id}/research`, { method: 'POST' }),
    runAll: () =>
      apiFetch<{ processed: number; runs: ResearchRunSummary[]; stoppedEarly: string | null; remainingUnprocessed: number }>('/api/research/run-all', { method: 'POST' }),
    keywordSeeds: (industry: string) =>
      apiFetch<{ industry: string; serviceTerm: string; templates: string[]; preview: string[] }>(`/api/research/keyword-seeds/${encodeURIComponent(industry)}`),
  },
  settings: {
    get: () => apiFetch<{ settings: AgencySettings }>('/api/settings'),
    update: (settings: Pick<AgencySettings, 'general' | 'outreach' | 'defaults' | 'discovery' | 'research'>) =>
      apiFetch<{ settings: AgencySettings }>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
    health: () => apiFetch<SettingsHealth>('/api/settings/health'),
    activity: (level?: 'info' | 'warn' | 'error') =>
      apiFetch<{ events: ApplicationEvent[] }>(`/api/settings/activity${qs({ level, limit: 200 })}`),
    claritySync: () => apiFetch<{ checked: number; matched: number; updated: number; skipped: number; error?: string }>('/api/settings/clarity-sync', { method: 'POST' }),
    exportLeads: async () => {
      const res = await fetch(`${API_BASE}/api/leads/export`, { credentials: 'include', headers: authHeaders() });
      if (!res.ok) throw new ApiError('Could not export leads', res.status);
      return res.blob();
    },
  },
  leads: {
    list: (filters?: { status?: string; pipeline_status?: string; tier?: number; enrichment?: string; search?: string; industry?: string; include_deleted?: boolean; only_deleted?: boolean }) =>
      apiFetch<{ leads: Lead[]; total: number }>(`/api/leads${qs(filters)}`),
    industries: () => apiFetch<{ industries: string[] }>('/api/leads/industries'),
    get: (id: number) => apiFetch<{ lead: Lead; calls: CallEntry[] }>(`/api/leads/${id}`),
    create: (data: Partial<Lead>) =>
      apiFetch<{ lead: Lead }>('/api/leads', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Lead>) =>
      apiFetch<{ lead: Lead }>(`/api/leads/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    appendNote: (id: number, note: string) =>
      apiFetch<{ lead: Lead }>(`/api/leads/${id}/notes`, { method: 'POST', body: JSON.stringify({ note }) }),
    classifyPhone: (id: number) =>
      apiFetch<{ lead: Lead; classification: PhoneClassification }>(`/api/leads/${id}/phone-classify`, { method: 'POST' }),
    updatePhoneRoute: (id: number, route: PhoneRoute) =>
      apiFetch<{ lead: Lead }>(`/api/leads/${id}/phone-route`, {
        method: 'PATCH',
        body: JSON.stringify({ route }),
      }),
    classifyPhones: (input: { ids?: number[]; limit?: number; force?: boolean } = {}) =>
      apiFetch<PhoneClassificationBatchResponse>('/api/leads/phone-classify', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    delete: (id: number) =>
      apiFetch<void>(`/api/leads/${id}`, { method: 'DELETE' }),
    // Permanent delete. Backend rejects with 400 unless the lead is already
    // soft-deleted — so this is only safe to call from the trash view.
    hardDelete: (id: number) =>
      apiFetch<void>(`/api/leads/${id}?hard=true`, { method: 'DELETE' }),
    restore: (id: number) =>
      apiFetch<{ lead: Lead }>(`/api/leads/${id}/restore`, { method: 'POST' }),
    reactivate: (id: number, body: { workspace: 'text' | 'email' | 'receptionist'; destination?: 'awaiting_build' | 'built_needs_review' | 'ready_to_send' }) =>
      apiFetch<{ lead: Lead }>(`/api/leads/${id}/reactivate`, { method: 'POST', body: JSON.stringify(body) }),
    importCsv: (csv: string) =>
      apiFetch<{ imported: number; skipped: number; errors: string[] }>('/api/leads/import', {
        method: 'POST',
        body: csv,
        headers: { 'Content-Type': 'text/csv' },
      }),
    enrich: (id: number) =>
      apiFetch<{ lead: Lead }>(`/api/leads/${id}/enrich`, { method: 'POST' }),
    // Qualify a lead → creates a Sites project at the chosen tier and marks
    // the lead as 'client'. Optional note is prepended to the lead's notes.
    qualify: (id: number, input: { tier: 1 | 2 | 3; note?: string }) =>
      apiFetch<{ lead: Lead; project: Project }>(`/api/leads/${id}/qualify`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    convertToClient: (id: number, input: {
      tier: 1 | 2 | 3;
      initialStatus: 'prospect' | 'building' | 'live';
      contractStart?: string;
      clientEmail?: string;
      note?: string;
      selectedPlan?: 'Build & Maintain' | 'Growth';
      commitmentTerm?: 'ongoing_hosting' | '6_months' | '12_months';
      discoveryScheduledFor?: string;
    }) => apiFetch<{ lead: Lead; project: Project }>(`/api/leads/${id}/convert-to-client`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    /**
     * Bulk enrich. Two modes:
     * - `ids` provided → re-enrich those specific leads regardless of current
     *   enrichment_status (used by the pipeline bulk-select flow).
     * - `ids` omitted → enrich every 'pending' lead, capped by `limit`.
     */
    enrichAll: (opts: { limit?: number; ids?: number[] } = {}) =>
      apiFetch<{
        total: number;
        processed?: number;
        succeeded: number;
        failed: number;
        failures: Array<{ id: number; error: string }>;
        /** Set when the backend stopped the batch before processing every id —
         *  e.g. 'subrequest_budget_exhausted' when the Worker hit its 1000-
         *  subrequest cap. The remaining leads are untouched (NOT marked
         *  failed) so the operator can retry them in a fresh invocation. */
        stoppedEarly?: string | null;
        remainingUnprocessed?: number;
      }>(
        '/api/leads/enrich-all',
        { method: 'POST', body: JSON.stringify({ limit: opts.limit ?? 25, ...(opts.ids ? { ids: opts.ids } : {}) }) }
      ),
  },
  calls: {
    list: (leadId: number) => apiFetch<{ calls: CallEntry[] }>(`/api/leads/${leadId}/calls`),
    create: (leadId: number, data: { outcome: string; notes: string; followup_date?: string | null }) =>
      apiFetch<{ call: CallEntry }>(`/api/leads/${leadId}/calls`, { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: number) =>
      apiFetch<{ success: boolean }>(`/api/calls/${id}`, { method: 'DELETE' }),
  },
  prospect: {
    search: (input: { location: string; industry: string; radius?: number; pageToken?: string | null; maxPages?: number }) =>
      apiFetch<{ results: ProspectResult[]; total: number; nextPageToken: string | null; pagesFetched: number }>('/api/prospect/search', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    place: (placeId: string) =>
      apiFetch<{ place: unknown; cached: boolean }>(`/api/prospect/place/${placeId}`),
    addToPipeline: (placeIds: string[]) =>
      apiFetch<{ added: number; skipped: number; addedPlaceIds: string[]; errors: string[] }>('/api/prospect/add-to-pipeline', {
        method: 'POST',
        body: JSON.stringify({ placeIds }),
      }),
    candidates: (status: ProspectCandidate['status'] = 'pending') =>
      apiFetch<{ candidates: ProspectCandidate[] }>(`/api/prospect/candidates${qs({ status })}`),
    inboxSummary: () => apiFetch<ProspectInboxSummary>('/api/prospect/inbox-summary'),
    approveCandidates: (ids: number[]) =>
      apiFetch<{ added: number; skipped: number; errors: string[] }>('/api/prospect/candidates/approve', { method: 'POST', body: JSON.stringify({ ids }) }),
    rejectCandidates: (ids: number[]) =>
      apiFetch<{ rejected: number }>('/api/prospect/candidates/reject', { method: 'POST', body: JSON.stringify({ ids }) }),
    runDiscovery: (input?: { industry?: string; location?: string }) =>
      apiFetch<{ status: string; reason?: string; newCandidates: number; refreshedCandidates: number; resultsFound: number }>('/api/prospect/run-now', { method: 'POST', body: JSON.stringify(input ?? {}) }),
  },
  projects: {
    list: (filters?: { tier?: number; status?: string }) =>
      apiFetch<{ projects: Project[]; total: number }>(`/api/projects${qs(filters)}`),
    get: (id: number) =>
      apiFetch<{ project: Project; pages: Page[] }>(`/api/projects/${id}`),
    activity: (id: number) =>
      apiFetch<{ events: ProjectActivityEvent[] }>(`/api/projects/${id}/activity`),
    create: (data: { leadId?: number; tier?: 1 | 2 | 3; business_name?: string; services?: string[]; service_areas?: string[] }) =>
      apiFetch<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: ProjectUpdate) =>
      apiFetch<{ project: Project }>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    discovery: {
      get: (id: number) =>
        apiFetch<{ discovery: ProjectDiscovery | null; eligible: boolean }>(`/api/projects/${id}/discovery`),
      save: (
        id: number,
        body: { answers: DiscoveryAnswers; status?: 'draft' | 'complete'; testMode?: boolean },
      ) =>
        apiFetch<{ discovery: ProjectDiscovery }>(`/api/projects/${id}/discovery`, {
          method: 'PUT',
          body: JSON.stringify(body),
        }),
      clear: (id: number) =>
        apiFetch<void>(`/api/projects/${id}/discovery`, { method: 'DELETE' }),
    },
    growthCycles: {
      current: (id: number) =>
        apiFetch<{ cycle: GrowthCycle | null; items: GrowthWorkItem[] }>(`/api/projects/${id}/growth-cycles/current`),
      create: (id: number, data?: { period?: string; phase?: GrowthPhase }) =>
        apiFetch<{ cycle: GrowthCycle; items: GrowthWorkItem[] }>(`/api/projects/${id}/growth-cycles`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
      update: (id: number, data: Partial<Pick<GrowthCycle, 'phase' | 'status' | 'client_summary' | 'next_priorities'>>) =>
        apiFetch<{ cycle: GrowthCycle; items: GrowthWorkItem[] }>(`/api/growth-cycles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      addItem: (cycleId: number, data: { category: GrowthWorkCategory; title: string; description?: string; evidence_url?: string; page_id?: number; recommended_page_type?: string; recommended_service?: string; recommended_city?: string; work_tier?: 'committed' | 'bonus' }) =>
        apiFetch<{ item: GrowthWorkItem }>(`/api/growth-cycles/${cycleId}/items`, { method: 'POST', body: JSON.stringify(data) }),
      commitItem: (id: number, replaceItemId?: number) =>
        apiFetch<{ cycle: GrowthCycle; items: GrowthWorkItem[] }>(`/api/growth-work-items/${id}/commit`, { method: 'POST', body: JSON.stringify({ replace_item_id: replaceItemId }) }),
      updateItem: (id: number, data: Partial<Pick<GrowthWorkItem, 'title' | 'description' | 'evidence_url' | 'client_visible'>> & { status?: GrowthWorkStatus }) =>
        apiFetch<{ item: GrowthWorkItem }>(`/api/growth-work-items/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      generateItemBrief: (id: number) =>
        apiFetch<{ item: GrowthWorkItem; brief: Brief }>(`/api/growth-work-items/${id}/brief`, { method: 'POST' }),
      deleteItem: (id: number) => apiFetch<{ success: boolean }>(`/api/growth-work-items/${id}`, { method: 'DELETE' }),
      generate: (id: number, replace = false) =>
        apiFetch<{ cycle: GrowthCycle; items: GrowthWorkItem[] }>(`/api/projects/${id}/growth-cycles/generate`, { method: 'POST', body: JSON.stringify({ replace }) }),
      strategy: (id: number) => apiFetch<{ strategy: GrowthStrategy }>(`/api/projects/${id}/growth-strategy`),
      saveStrategy: (id: number, data: Omit<Partial<GrowthStrategy>, 'priority_services' | 'priority_areas'> & { priority_services?: string[]; priority_areas?: string[] }) =>
        apiFetch<{ strategy: GrowthStrategy }>(`/api/projects/${id}/growth-strategy`, { method: 'PUT', body: JSON.stringify(data) }),
    },
    onboarding: {
      get: (id: number) => apiFetch<{ items: OnboardingItem[]; completed: number; total: number }>(`/api/projects/${id}/onboarding`),
      update: (id: number, key: string, completed: boolean, notes?: string | null) =>
        apiFetch<{ success: boolean }>(`/api/projects/${id}/onboarding/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify({ completed, notes }) }),
    },
    // Hard-delete a project. Cascades to its pages/briefs/etc; the linked lead
    // is reverted to status='contacted' with project_id cleared.
    delete: (id: number) =>
      apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' }),
    // The demo was held but the prospect declined. Project is marked 'dead'
    // (historical record), lead returns to 'contacted' for re-engagement.
    demoPassed: (id: number) =>
      apiFetch<{ project: Project }>(`/api/projects/${id}/demo-passed`, { method: 'POST' }),
    coverage: (id: number) =>
      apiFetch<{
        services: string[];
        cities: string[];
        matrix: Array<{ city: string; inReviews: boolean; cells: Array<{ service: string; city: string; state: 'built' | 'building' | 'queued' | 'recommended' | 'available' }> }>;
        summary: { total: number; built: number; available: number; pct: number };
      }>(`/api/projects/${id}/coverage`),
    // DNS management — mounted under /api/projects/:id/dns/* by the backend.
    // setup() is rejected by the backend with 409 if the project already has
    // a cf_zone_id; phase 5's Edit Project flow goes through a separate confirm
    // step before calling setup() again with a new domain.
    dns: {
      setup: (
        id: number,
        body: { domain: string; registrar?: string; domain_owner_email?: string },
        // Pass replace=true for the Edit Project domain-swap flow. Causes the
        // backend to orphan the existing zone and create a new one. The
        // old zone_id is logged for audit; manual cleanup in CF dashboard.
        opts?: { replace?: boolean }
      ) =>
        apiFetch<DnsSetupResponse>(
          `/api/projects/${id}/dns/setup${opts?.replace ? '?replace=true' : ''}`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        ),
      status: (id: number) =>
        apiFetch<DnsStatusResponse>(`/api/projects/${id}/dns/status`),
      retry: (id: number) =>
        apiFetch<DnsRetryResponse>(`/api/projects/${id}/dns/retry`, { method: 'POST' }),
    },
  },
  briefs: {
    listForProject: (projectId: number) =>
      apiFetch<{ briefs: BriefSummary[] }>(`/api/projects/${projectId}/briefs`),
    get: (id: number) => apiFetch<Brief>(`/api/briefs/${id}`),

    // Master brief
    getMaster: (projectId: number) =>
      apiFetch<Brief>(`/api/projects/${projectId}/briefs/master`),
    master: (projectId: number) =>
      apiFetch<Brief>(`/api/projects/${projectId}/briefs/master`, { method: 'POST' }),
    regenerateMaster: (projectId: number, feedback?: string) =>
      apiFetch<Brief>(`/api/projects/${projectId}/briefs/master/regenerate`, {
        method: 'POST',
        body: JSON.stringify(feedback ? { feedback } : {}),
      }),

    // Page briefs
    generatePage: (projectId: number, pageId: number) =>
      apiFetch<Brief>(`/api/projects/${projectId}/pages/${pageId}/brief`, { method: 'POST' }),
    complete: (briefId: number) =>
      apiFetch<{ brief: Brief; growth_work_completed: boolean }>(`/api/briefs/${briefId}/complete`, { method: 'POST' }),

    // Brief content edits (inline TBD fill / manual edits)
    updateContent: (briefId: number, content_markdown: string) =>
      apiFetch<Brief>(`/api/briefs/${briefId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content_markdown }),
      }),
  },
  pages: {
    insights: (pageId: number) => apiFetch<PageInsights>(`/api/pages/${pageId}/insights`),
    /** Create a page row (used to materialize a matrix cell). */
    create: (projectId: number, input: { type: string; service?: string; city?: string; customTitle?: string }) =>
      apiFetch<Page>(`/api/projects/${projectId}/pages`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    setStatus: (pageId: number, status: 'planned' | 'briefed' | 'complete') =>
      apiFetch<Page>(`/api/pages/${pageId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    setBilling: (pageId: number, billing_status: 'included' | 'add_on' | 'comp') =>
      apiFetch<Page>(`/api/pages/${pageId}/billing`, {
        method: 'PATCH',
        body: JSON.stringify({ billing_status }),
      }),
  },
  matrix: {
    get: (projectId: number) =>
      apiFetch<{
        foundationPages: Array<{ type: string; label: string; pageId: number | null; status: string; billingStatus: string; metrics: PageSearchMetrics | null }>;
        servicePages: Array<{ service: string; pageId: number | null; status: string; billingStatus: string; metrics: PageSearchMetrics | null }>;
        serviceAreaGrid: {
          services: string[];
          cities: string[];
          cells: Array<{ service: string; city: string; pageId: number | null; status: string; billingStatus: string; metrics: PageSearchMetrics | null }>;
        };
      }>(`/api/projects/${projectId}/matrix`),
  },
  scrape: {
    run: (projectId: number, input?: { url?: string; force?: boolean }) =>
      apiFetch<{
        ok: boolean;
        reason: string | null;
        pages_fetched: number;
        bytes: number;
        brand_attributes_inserted: number;
        extracted: unknown;
      }>(`/api/projects/${projectId}/scrape`, {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
      }),
  },
  brandAttributes: {
    list: (projectId: number) =>
      apiFetch<{ brandAttributes: BrandAttribute[] }>(`/api/projects/${projectId}/brand-attributes`),
    create: (projectId: number, input: { category: BrandAttributeCategory; value: string; source?: BrandAttributeSource; weight?: number }) =>
      apiFetch<BrandAttribute>(`/api/projects/${projectId}/brand-attributes`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    delete: (id: number) =>
      apiFetch<void>(`/api/brand-attributes/${id}`, { method: 'DELETE' }),
  },
  testimonials: {
    list: (projectId: number) =>
      apiFetch<{ testimonials: Testimonial[] }>(`/api/projects/${projectId}/testimonials`),
    create: (projectId: number, input: { authorName: string; authorLocation?: string; quote: string; rating?: number; source?: TestimonialSource; isFeatured?: boolean }) =>
      apiFetch<Testimonial>(`/api/projects/${projectId}/testimonials`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: number, input: Partial<{ authorName: string; authorLocation: string | null; quote: string; rating: number | null; source: TestimonialSource | null; isFeatured: boolean }>) =>
      apiFetch<Testimonial>(`/api/testimonials/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    delete: (id: number) =>
      apiFetch<void>(`/api/testimonials/${id}`, { method: 'DELETE' }),
  },
  reports: {
    summary: (projectId: number, period?: string) =>
      apiFetch<ReportSummary>(`/api/reports/${projectId}/summary${qs({ period })}`),
    health: (projectId: number) =>
      apiFetch<{ snapshot: ReportSummary['current'] }>(`/api/reports/${projectId}/health`, { method: 'POST' }),
    refresh: (projectId: number, period?: string) =>
      apiFetch<{ snapshot: unknown }>(`/api/reports/${projectId}/refresh${qs({ period })}`, { method: 'POST' }),
    snapshot: (projectId: number, period?: string) =>
      apiFetch<{ snapshot: unknown }>(`/api/reports/${projectId}/snapshot${qs({ period })}`, { method: 'POST' }),
    exportHtml: (projectId: number, period: string, sections: string[]) =>
      fetch(`${API_BASE}/api/reports/${projectId}/export`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ period, sections }),
      }).then(r => r.text()),
    email: (projectId: number, opts: { period: string; sections: string[]; to?: string }) =>
      apiFetch<{ ok: boolean; id: string; to: string }>(`/api/reports/${projectId}/email`, {
        method: 'POST', body: JSON.stringify(opts),
      }),
  },
  seoAudits: {
    latest: (projectId: number) => apiFetch<{ run: SeoAuditRun | null; findings: SeoAuditFinding[]; unmatchedPages: number }>(`/api/projects/${projectId}/seo-audits/latest`),
    run: (projectId: number) => apiFetch<{ run: SeoAuditRun; findings: SeoAuditFinding[]; unmatchedPages: number }>(`/api/projects/${projectId}/seo-audits`, { method: 'POST' }),
    importPages: (projectId: number) => apiFetch<{ imported: number; linked: number; remaining: number }>(`/api/projects/${projectId}/seo-audits/import-pages`, { method: 'POST' }),
  },
  // Calling dashboard (Phase 3+ backend, Phase 4+ frontend).
  dashboard: {
    today: () => apiFetch<DashboardTodayResponse>('/api/dashboard'),
    weekReview: (date?: string) =>
      apiFetch<DashboardWeekReviewResponse>(`/api/dashboard/week-review${qs({ date })}`),
    prospectingProgress: () =>
      apiFetch<{ week: WeekDates; count: number; target: number }>('/api/dashboard/prospecting-progress'),
    industries: () => apiFetch<{ industries: IndustrySpec[] }>('/api/dashboard/industries'),
    generatePitchCard: (leadId: number) =>
      apiFetch<{ pitch_card_text: string; generated_at: string }>(
        `/api/dashboard/leads/${leadId}/pitch-card`, { method: 'POST' }
      ),
    agencySummary: (range: AnalyticsRange = '30d') =>
      apiFetch<AgencySummary>(`/api/dashboard/agency-summary?range=${range}`),
    objectionsOverview: (range: AnalyticsRange = '30d') =>
      apiFetch<ObjectionsOverviewResponse>(`/api/dashboard/objections-overview?range=${range}`),
    textOutreachActivity: (range: TextOutreachActivityRange = '30d') =>
      apiFetch<TextOutreachActivityResponse>(`/api/dashboard/text-outreach-activity?range=${range}`),
    pipelineKpis: (engagementRange: TextOutreachActivityRange = '30d') =>
      apiFetch<PipelineKpisResponse>(`/api/dashboard/pipeline-kpis?engagement_range=${engagementRange}`),
  },
  sessions: {
    today: () => apiFetch<{ date: string; mode: string; sessions: Session[] }>('/api/sessions/today'),
    week: (date?: string) =>
      apiFetch<{ week: WeekDates; sessions: SessionWithProgress[]; activeSession: SessionWithProgress | null }>(`/api/sessions/week${qs({ date })}`),
    get: (id: number) =>
      apiFetch<{ session: Session; leads: Array<Lead & { position: number; call_outcome: CallOutcome | null; is_callback: number; session_lead_id: number }> }>(`/api/sessions/${id}`),
    generateWeek: (weekStart?: string) =>
      apiFetch<{ week: WeekDates; created: Session[]; skipped: Array<{ date: string; block: string; reason: string }> }>(
        '/api/sessions/generate-week',
        { method: 'POST', body: JSON.stringify(weekStart ? { weekStart } : {}) }
      ),
    update: (id: number, body: { industry?: string; geographic_filter?: string[] | null; score_floor?: number; lead_count_target?: number }) =>
      apiFetch<{ session: Session }>(`/api/sessions/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    start: (id: number) =>
      apiFetch<{ session: Session }>(`/api/sessions/${id}/start`, { method: 'POST' }),
    extend: (id: number, count = 20) =>
      apiFetch<{ added: number; appliedFilter: unknown; widened: unknown[] }>(
        `/api/sessions/${id}/extend`, { method: 'POST', body: JSON.stringify({ count }) }
      ),
    complete: (id: number) =>
      apiFetch<{ session: Session; recap: SessionRecap }>(`/api/sessions/${id}/complete`, { method: 'POST' }),
    nextLead: (id: number) =>
      apiFetch<{ lead: (Lead & { position: number; is_callback: number; session_lead_id: number }) | null; done: boolean; total?: number; called?: number }>(
        `/api/sessions/${id}/next-lead`
      ),
    outcome: (id: number, body: SessionOutcomeBody) =>
      apiFetch<{ ok: boolean; demo: Demo | null; callbackId: number | null; project: Project | null }>(
        `/api/sessions/${id}/outcome`, { method: 'POST', body: JSON.stringify(body) }
      ),
    hot: () => apiFetch<{ session: SessionWithProgress | null }>(`/api/sessions/hot`),
    hotAdd: (leadIds: number[]) =>
      apiFetch<{ session_id: number; added: number; duplicates: number; skipped_invalid: number }>(
        `/api/sessions/hot/add`, { method: 'POST', body: JSON.stringify({ lead_ids: leadIds }) }
      ),
  },
  demos: {
    list: (filters?: { status?: string; date?: string }) =>
      apiFetch<{ demos: DemoWithLead[] }>(`/api/demos${qs(filters)}`),
    awaitingStatus: () => apiFetch<{ demos: DemoWithLead[] }>('/api/demos/awaiting-status'),
    noShowRecovery: () => apiFetch<{ demos: DemoWithLead[] }>('/api/demos/no-show-recovery'),
    today: () => apiFetch<{ demos: DemoWithLead[] }>('/api/demos/today'),
    setStatus: (id: number, body: { status: DemoStatus; newDate?: string; notes?: string }) =>
      apiFetch<{ demo: Demo }>(`/api/demos/${id}/status`, { method: 'PUT', body: JSON.stringify(body) }),
  },
  callbacks: {
    list: (filters?: { status?: string; date?: string }) =>
      apiFetch<{ callbacks: Callback[] }>(`/api/callbacks${qs(filters)}`),
    update: (id: number, body: { status?: CallbackStatus; due_date?: string; notes?: string }) =>
      apiFetch<{ callback: Callback }>(`/api/callbacks/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  },
  recordings: {
    fetchBlob: async (url: string): Promise<Blob> => {
      const playbackUrl = authenticatedRecordingPlaybackUrl(url);
      const res = await fetch(playbackUrl, {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (!res.ok) throw new ApiError(`Recording playback failed: ${res.status}`, res.status);
      return res.blob();
    },
    upload: async (
      leadId: number,
      blob: Blob,
      ext = 'webm',
    ): Promise<{ url: string; key: string; bytes: number; call_id: number }> => {
      const form = new FormData();
      form.append('file', blob, `recording.${ext}`);
      form.append('leadId', String(leadId));
      form.append('ext', ext);
      const res = await fetch(`${API_BASE}/api/recordings`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: form,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ApiError(`Upload failed: ${res.status} ${text}`, res.status);
      }
      return res.json();
    },
    // Lists every R2 object under a lead's prefix + whether it's already
    // attached to a call_log row. Frontend uses this to detect orphans.
    listForLead: (leadId: number) =>
      apiFetch<{ recordings: RecordingObject[] }>(`/api/leads/${leadId}/recordings`),
    // Creates a placeholder call_log row pointing at an orphan R2 object.
    // Idempotent — re-attaching the same key returns the existing call_id.
    attach: (leadId: number, key: string) =>
      apiFetch<{ call_id: number; created: boolean }>(
        `/api/leads/${leadId}/recordings/attach`,
        { method: 'POST', body: JSON.stringify({ key }) }
      ),
  },
  // Automated Pipeline — text + site outreach queue.
  // Same underlying `leads` table as the cold-call flow, filtered
  // server-side to leads that actually belong in this motion (no site,
  // enriched, in cold/contacted). See backend/src/routes/pipeline.ts.
  pipeline: {
    list: (filters?: { status?: string; q?: string; channel?: 'text'|'email' }) =>
      apiFetch<{ leads: Lead[] }>(`/api/pipeline/leads${qs(filters)}`),
    get: (id: number) =>
      apiFetch<{ lead: Lead; activity: LeadActivity[] }>(`/api/pipeline/leads/${id}`),
    claritySnippet: (id: number) =>
      apiFetch<{ project_id: string; clarity_tag: string; campaign_slug: string; snippet: string }>(`/api/pipeline/leads/${id}/clarity-snippet`),
    syncClarity: () =>
      apiFetch<{ checked: number; matched: number; updated: number; skipped: number; error?: string }>('/api/pipeline/clarity-sync', { method: 'POST' }),
    saveSiteUrl: (id: number, url: string) =>
      apiFetch<{ lead: Lead }>(`/api/pipeline/leads/${id}/site-url`, {
        method: 'POST',
        body: JSON.stringify({ url }),
      }),
    approveSite: (id: number) =>
      apiFetch<{ lead: Lead }>(`/api/pipeline/leads/${id}/approve-site`, {
        method: 'POST',
      }),
    updateSiteReview: (
      id: number,
      body: { status: 'pending' | 'needs_fix'; reasons?: string[]; note?: string },
    ) => apiFetch<{ lead: Lead }>(`/api/pipeline/leads/${id}/site-review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    updateDemoSiteStatus: (id: number, status: 'live' | 'cleanup_needed' | 'deleted') =>
      apiFetch<{ lead: Lead }>(`/api/pipeline/leads/${id}/demo-site-status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    // Fires on operator taps of Open in Messages / Log call. Optimistic:
    // the server assumes the send happened; the paired undo() reverts if
    // the operator dismisses the toast in the ~6s window.
    action: (
      id: number,
      body: {
        action:
          | 'email_sent'
          | 'email_followed_up'
          | 'email_final_touch'
          | 'intro_sent'
          | 'followed_up'
          | 'reply_received'
          | 'call_outcome'
          | 'calendar_sent'
          | 'scheduling_followup'
          | 'called'
          | 'archived';
        meta?: unknown;
      },
    ) =>
      apiFetch<{ lead: Lead }>(`/api/pipeline/leads/${id}/action`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    undo: (id: number) =>
      apiFetch<{ lead: Lead } | null>(`/api/pipeline/leads/${id}/undo`, {
        method: 'POST',
      }),
    // Generates + caches a landingsite-ready brief. Idempotent unless
    // { regenerate: true } is passed; a second call otherwise returns
    // the cached brief without re-billing Claude.
    generateBrief: (id: number, opts?: { regenerate?: boolean }) =>
      apiFetch<{ lead: Lead }>(`/api/pipeline/leads/${id}/brief`, {
        method: 'POST',
        body: JSON.stringify({ regenerate: !!opts?.regenerate }),
      }),
  },
  builder: {
    status: (runId?: number) => apiFetch<BuilderStatus>(`/api/builder/status${runId ? `?runId=${runId}` : ''}`),
    start: (leadIds: number[], batchSize = 20) => apiFetch<{ runId: number; queued: number }>('/api/builder/start', {
      method: 'POST', body: JSON.stringify({ leadIds, batchSize }),
    }),
    control: (action: 'pause'|'resume'|'stop') => apiFetch<{ ok: true }>('/api/builder/control', {
      method: 'POST', body: JSON.stringify({ action }),
    }),
    retryFailed: (runId?: number) => apiFetch<{ retried: number }>('/api/builder/retry-failed', { method: 'POST', body: JSON.stringify({ runId }) }),
    resumeStuck: () => apiFetch<{ ok:true;jobId:number;businessName:string }>('/api/builder/resume-stuck', { method: 'POST' }),
  },
  emailOutreach: {
    send: (
      id: number,
      body: {
        subject: string;
        text: string;
        templateKey: string;
        action: 'email_sent' | 'email_followed_up' | 'email_final_touch';
      },
    ) =>
      apiFetch<{
        ok: true;
        sendId: number;
        providerMessageId: string;
        status: string;
        pipelineStatus: string;
      }>(`/api/email/leads/${id}/send`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    automations: () =>
      apiFetch<{ automations: EmailAutomationSummary[] }>('/api/email/automations'),
    automation: (leadId: number) =>
      apiFetch<EmailAutomationDetail>(`/api/email/leads/${leadId}/automation`),
    startAutomation: (leadId: number) =>
      apiFetch<{ automation: EmailAutomationSummary }>(`/api/email/leads/${leadId}/automation/start`, {
        method: 'POST',
      }),
    automationAction: (
      automationId: number,
      action:
        | 'pause'
        | 'resume'
        | 'send_now'
        | 'skip'
        | 'stop'
        | 'return_to_call'
        | 'undo_return_to_call'
        | 'extend_review'
        | 'archive',
    ) =>
      apiFetch<{ ok: true; automation?: EmailAutomationSummary; result?: unknown }>(
        `/api/email/automations/${automationId}/action`,
        { method: 'POST', body: JSON.stringify({ action }) },
      ),
    updateScheduledEmail: (automationId: number, subject: string, text: string) =>
      apiFetch<{ automation: EmailAutomationSummary }>(
        `/api/email/automations/${automationId}/scheduled-email`,
        { method: 'PUT', body: JSON.stringify({ subject, text }) },
      ),
    runDue: () =>
      apiFetch<{ checked: number; processed: number; sent: number; completed: number; failed: number }>(
        '/api/email/automations/run-due',
        { method: 'POST' },
      ),
  },
  playbook: {
    scripts: () => apiFetch<{ scripts: ScriptSummary[] }>('/api/playbook/scripts'),
    script: (id: string) => apiFetch<{ script: Script }>(`/api/playbook/scripts/${id}`),
    objections: () => apiFetch<{ by_category: ObjectionsByCategory }>('/api/playbook/objections'),
    objection: (id: string) => apiFetch<{ objection: Objection }>(`/api/playbook/objections/${id}`),
    followUp: (id: string) => apiFetch<{ sequence: FollowUpSequence }>(`/api/playbook/follow-ups/${id}`),
    generateRebuttal: (body: GenerateRebuttalRequest) =>
      apiFetch<GenerateRebuttalResponse>('/api/playbook/generate-rebuttal', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    markUsed: (generationId: number, variantIndex: number) =>
      apiFetch<{ ok: true }>(`/api/playbook/generations/${generationId}/mark-used`, {
        method: 'POST',
        body: JSON.stringify({ variant_index: variantIndex }),
      }),
  },
};

// --- Dashboard / sessions response types ---

export interface WeekDates {
  monday: string; tuesday: string; wednesday: string; thursday: string; friday: string;
}

export interface DemoWithLead extends Demo {
  company: string; phone: string | null; city: string | null; state: string | null; contact: string | null;
}

export interface CallbackWithLead extends Callback {
  company: string; phone: string | null;
}

export interface VoicemailToRedial {
  id: number;
  company: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  last_called_at: string;
}

export interface DashboardTodayResponse {
  today: string;
  mode: 'prep' | 'calling' | 'review' | 'quiet';
  sessions: Session[];
  priorityStrip: {
    demosAwaitingStatus: DemoWithLead[];
    noShowRecovery: DemoWithLead[];
    demosToday: DemoWithLead[];
    callbacksDue: CallbackWithLead[];
    voicemailsToRedial: VoicemailToRedial[];
  };
}

export interface DashboardWeekReviewResponse {
  week: WeekDates;
  metrics: {
    totalDials: number;
    demosBooked: number;
    demosHeld: number;
    demosNoShow: number;
    bookingRate: number;
  };
  byIndustry: Array<{ industry: string; dials: number; booked: number }>;
  missedCallbacks: CallbackWithLead[];
}

// Industry rotation entry. Backend's leads.industry stores `key` (Google
// Places primaryType like 'plumber'); UI shows `label` ('Plumbing').
export interface IndustrySpec {
  key: string;
  label: string;
}

// Tiny lookup helper for components that have a session.industry key but
// need the friendly label. Returns the key unchanged if unknown.
export function industryLabel(key: string, specs: IndustrySpec[] = INDUSTRY_FALLBACK): string {
  return specs.find((s) => s.key === key)?.label ?? key;
}

// Hard-coded fallback so the UI can render labels even before
// /api/dashboard/industries returns. Mirrors backend's INDUSTRY_ROTATION;
// keep in sync if the backend list changes.
const INDUSTRY_FALLBACK: IndustrySpec[] = [
  { key: 'plumber',            label: 'Plumbing' },
  { key: 'hvac_contractor',    label: 'HVAC' },
  { key: 'electrician',        label: 'Electrical' },
  { key: 'roofing_contractor', label: 'Roofing' },
  { key: 'general_contractor', label: 'General Contracting' },
];

export interface SessionRecap {
  total: number; called: number; voicemails: number; notInterested: number;
  callbacks: number; booked: number; skipped: number; bookingRate: number;
}

export interface SessionWithProgress extends Session {
  lead_count: number;
  called_count: number;
  booked_count: number;
  callback_count: number;
  voicemail_count: number;
  not_interested_count: number;
  skipped_count: number;
}

export interface RecordingObject {
  key: string;
  url: string;
  size_bytes: number;
  uploaded_at: string;
  attached: boolean;
  call_id: number | null;
}

export type AnalyticsRange = '30d' | 'all';
export type TextOutreachActivityRange = '7d' | '30d' | 'all';
export type PhoneRoute = 'text' | 'call' | 'review' | 'unknown';

export interface PhoneClassification {
  phone_e164: string | null;
  phone_valid: number;
  phone_line_type: string | null;
  phone_carrier: string | null;
  phone_route: PhoneRoute;
  phone_lookup_error: string | null;
}

export interface PhoneClassificationBatchResponse {
  total: number;
  succeeded: number;
  failed: number;
  items: Array<{ id: number; ok: boolean; route?: PhoneRoute | string; lineType?: string | null; error?: string }>;
}

export interface AgencySummary {
  range: AnalyticsRange;
  total_calls: number;
  call_days: number;
  calls_per_day: number;
  demos_booked: number;
  demos_held: number;
  demos_no_show: number;
  dial_to_set_rate_pct: number;
  new_projects: number;
}

export interface ObjectionOverviewItem {
  objection_id: string;
  label: string;
  category: 'standard' | 'deep-dive' | 'closing';
  type: 'simple' | 'branching';
  total_hits: number;
  handled_count: number;
  handled_rate_pct: number;
  frequency_pct: number;
}

export interface ObjectionsOverviewResponse {
  range: AnalyticsRange;
  total_calls: number;
  objections: ObjectionOverviewItem[];
}

// Reply metrics were removed 2026-07-21 by operator decision — the sms:
// deep-link channel means replies land on the operator's personal phone,
// and they chose not to log them manually.
export interface PipelineFunnelMetrics {
  sent: number;
  tapped: number;
  engaged: number;
  booked: number;
  tapRate: number | null;
  engagementRate: number | null;
  bookRate: number | null;
}

export interface PipelineChannelMetrics {
  channel: 'SMS' | 'Facebook' | string;
  current: PipelineFunnelMetrics | null;
  previous: PipelineFunnelMetrics | null;
  tracked: boolean;
}

export interface PipelineActivityMetrics {
  sitesCreated: number;
  introTextsSent: number;
  followUpsSent: number;
  engagedLeads: number;
  totalVisits: number;
  sendByHour?: Array<{
    hour: number;
    intro: number;
    followUps: number;
    total: number;
  }>;
}

export interface TextOutreachActivityResponse {
  range: TextOutreachActivityRange;
  activity: PipelineActivityMetrics;
}

export interface PipelineHotLead {
  id: number;
  company: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  pipeline_status: string;
  pipeline_sessions: number;
  engagement_score: number;
  engagement_grade: string;
  engagement_reasons: string | null;
  pipeline_last_action_at: string | null;
  outreach_channel: 'text' | 'call';
  last_engagement_at: string | null;
}

export interface OutreachEffectivenessMetrics {
  engagementByTouch: {
    intro: OutreachTouchMetric;
    reminder: OutreachTouchMetric;
    finalNudge: OutreachTouchMetric;
  };
  calendarOpened: number;
  calendarBooked: number;
  calendarBookingRate: number | null;
}

export interface OutreachTouchMetric {
  sent: number;
  engaged: number;
  rate: number | null;
}

export interface PipelineKpisResponse {
  week: WeekDates;
  previousWeek: WeekDates;
  hero: {
    hotLeadsReadyToCall: number;
    meetingsBookedThisWeek: number;
    activeLeadsInPipeline: number;
  };
  funnel: {
    current: PipelineFunnelMetrics;
    previous: PipelineFunnelMetrics;
    trends: {
      tapRate: number | null;
      engagementRate: number | null;
      bookRate: number | null;
    };
  };
  effectiveness: {
    range: TextOutreachActivityRange;
    current: OutreachEffectivenessMetrics;
    previous: OutreachEffectivenessMetrics;
    trends: {
      engagementByTouch: {
        intro: number | null;
        reminder: number | null;
        finalNudge: number | null;
      };
      calendarBookingRate: number | null;
    };
  };
  activity: {
    current: PipelineActivityMetrics;
    previous: PipelineActivityMetrics;
    trends: PipelineActivityMetrics;
  };
  channels: PipelineChannelMetrics[];
  needsAction: PipelineHotLead[];
}

export interface SessionOutcomeBody {
  leadId: number;
  outcome: CallOutcome;
  notes?: string;
  callbackDate?: string;
  preserveFinalReview?: boolean;
  blockHint?: SessionBlock;
  demoData?: { scheduledFor: string; honeybookConfirmed?: boolean; interestLevel: 'hot' | 'warm' | 'cold' };
  objectionHits?: ObjectionHit[];
  recordingUrl?: string | null;
  recordingCallId?: number | null;
  receptionistInterested?: boolean;
  receptionistEmail?: string;
  badContactReason?: 'disconnected' | 'wrong_number' | 'no_contact' | 'business_closed';
}

export { API_BASE, TRACKING_BASE };
