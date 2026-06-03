import type {
  Lead, CallEntry, ProspectResult, Project, Page, ReportSummary,
  Brief, BriefSummary, BrandAttribute, BrandAttributeCategory, BrandAttributeSource,
  Testimonial, TestimonialSource,
} from './types';

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
    // is reverted to status='qualified' with project_id cleared.
    delete: (id: number) =>
      apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' }),
    coverage: (id: number) =>
      apiFetch<{
        services: string[];
        cities: string[];
        matrix: Array<{ city: string; inReviews: boolean; cells: Array<{ service: string; city: string; state: 'built' | 'building' | 'queued' | 'recommended' | 'available' }> }>;
        summary: { total: number; built: number; available: number; pct: number };
      }>(`/api/projects/${id}/coverage`),
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
};

export { API_BASE };
