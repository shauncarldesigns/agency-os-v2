import type {
  Lead, CallEntry, ProspectResult, Project, Page, ReportSummary,
  Brief, BriefSummary, BrandAttribute, BrandAttributeCategory, BrandAttributeSource,
  Testimonial, TestimonialSource,
  Session, SessionBlock, CallOutcome, Demo, DemoStatus, Callback, CallbackStatus,
} from './types';
import type {
  ScriptSummary, Script, ObjectionsByCategory, Objection, FollowUpSequence,
  GenerateRebuttalRequest, GenerateRebuttalResponse, ObjectionHit,
} from './playbook';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8788';
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? '';

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
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      ...(options.headers as Record<string, string> | undefined ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new ApiError(err.error ?? res.statusText, res.status, err);
  }
  return res.json() as Promise<T>;
}

export const api = {
  leads: {
    list: (filters?: { status?: string; tier?: number; enrichment?: string; search?: string; industry?: string; include_deleted?: boolean; only_deleted?: boolean }) =>
      apiFetch<{ leads: Lead[]; total: number }>(`/api/leads${qs(filters)}`),
    industries: () => apiFetch<{ industries: string[] }>('/api/leads/industries'),
    get: (id: number) => apiFetch<{ lead: Lead; calls: CallEntry[] }>(`/api/leads/${id}`),
    create: (data: Partial<Lead>) =>
      apiFetch<{ lead: Lead }>('/api/leads', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Lead>) =>
      apiFetch<{ lead: Lead }>(`/api/leads/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) =>
      apiFetch<void>(`/api/leads/${id}`, { method: 'DELETE' }),
    // Permanent delete. Backend rejects with 400 unless the lead is already
    // soft-deleted — so this is only safe to call from the trash view.
    hardDelete: (id: number) =>
      apiFetch<void>(`/api/leads/${id}?hard=true`, { method: 'DELETE' }),
    restore: (id: number) =>
      apiFetch<{ lead: Lead }>(`/api/leads/${id}/restore`, { method: 'POST' }),
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
      apiFetch<{ added: number; skipped: number; errors: string[] }>('/api/prospect/add-to-pipeline', {
        method: 'POST',
        body: JSON.stringify({ placeIds }),
      }),
  },
  projects: {
    list: (filters?: { tier?: number; status?: string }) =>
      apiFetch<{ projects: Project[]; total: number }>(`/api/projects${qs(filters)}`),
    get: (id: number) =>
      apiFetch<{ project: Project; pages: Page[] }>(`/api/projects/${id}`),
    create: (data: { leadId?: number; tier?: 1 | 2 | 3; business_name?: string; services?: string[]; service_areas?: string[] }) =>
      apiFetch<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: ProjectUpdate) =>
      apiFetch<{ project: Project }>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
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

    // Brief content edits (inline TBD fill / manual edits)
    updateContent: (briefId: number, content_markdown: string) =>
      apiFetch<Brief>(`/api/briefs/${briefId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content_markdown }),
      }),
  },
  pages: {
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
        foundationPages: Array<{ type: string; label: string; pageId: number | null; status: string; billingStatus: string }>;
        servicePages: Array<{ service: string; pageId: number | null; status: string; billingStatus: string }>;
        serviceAreaGrid: {
          services: string[];
          cities: string[];
          cells: Array<{ service: string; city: string; pageId: number | null; status: string; billingStatus: string }>;
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
    refresh: (projectId: number, period?: string) =>
      apiFetch<{ snapshot: unknown }>(`/api/reports/${projectId}/refresh${qs({ period })}`, { method: 'POST' }),
    snapshot: (projectId: number, period?: string) =>
      apiFetch<{ snapshot: unknown }>(`/api/reports/${projectId}/snapshot${qs({ period })}`, { method: 'POST' }),
    exportUrl: (projectId: number, period: string, sections: string[]) =>
      `${API_BASE}/api/reports/${projectId}/export?key=${encodeURIComponent(API_KEY)}#${encodeURIComponent(JSON.stringify({ period, sections }))}`,
    exportHtml: (projectId: number, period: string, sections: string[]) =>
      fetch(`${API_BASE}/api/reports/${projectId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ period, sections }),
      }).then(r => r.text()),
    email: (projectId: number, opts: { period: string; sections: string[]; to?: string }) =>
      apiFetch<{ ok: boolean; id: string; to: string }>(`/api/reports/${projectId}/email`, {
        method: 'POST', body: JSON.stringify(opts),
      }),
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

export interface DashboardTodayResponse {
  today: string;
  mode: 'prep' | 'calling' | 'review' | 'quiet';
  sessions: Session[];
  priorityStrip: {
    demosAwaitingStatus: DemoWithLead[];
    noShowRecovery: DemoWithLead[];
    demosToday: DemoWithLead[];
    callbacksDue: CallbackWithLead[];
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

export type AnalyticsRange = '30d' | 'all';

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

export interface SessionOutcomeBody {
  leadId: number;
  outcome: CallOutcome;
  notes?: string;
  callbackDate?: string;
  blockHint?: SessionBlock;
  demoData?: { scheduledFor: string; honeybookConfirmed?: boolean };
  objectionHits?: ObjectionHit[];
}

export { API_BASE };
