import type { Lead, CallEntry, ProspectResult, Project, Page, QueueStatus, ReportSummary } from './types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8788';
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? '';

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
    list: (filters?: { status?: string; tier?: number; enrichment?: string; search?: string }) =>
      apiFetch<{ leads: Lead[]; total: number }>(`/api/leads${qs(filters)}`),
    get: (id: number) => apiFetch<{ lead: Lead; calls: CallEntry[] }>(`/api/leads/${id}`),
    create: (data: Partial<Lead>) =>
      apiFetch<{ lead: Lead }>('/api/leads', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Lead>) =>
      apiFetch<{ lead: Lead }>(`/api/leads/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) =>
      apiFetch<{ success: boolean }>(`/api/leads/${id}`, { method: 'DELETE' }),
    importCsv: (csv: string) =>
      apiFetch<{ imported: number; skipped: number; errors: string[] }>('/api/leads/import', {
        method: 'POST',
        body: csv,
        headers: { 'Content-Type': 'text/csv' },
      }),
    enrich: (id: number) =>
      apiFetch<{ lead: Lead }>(`/api/leads/${id}/enrich`, { method: 'POST' }),
    enrichAll: (limit = 25) =>
      apiFetch<{ total: number; succeeded: number; failed: number; failures: Array<{ id: number; error: string }> }>(
        '/api/leads/enrich-all',
        { method: 'POST', body: JSON.stringify({ limit }) }
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
    search: (input: { location: string; industry: string; radius?: number }) =>
      apiFetch<{ results: ProspectResult[]; total: number }>('/api/prospect/search', {
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
    update: (id: number, data: Partial<Project>) =>
      apiFetch<{ project: Project }>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    coverage: (id: number) =>
      apiFetch<{
        services: string[];
        cities: string[];
        matrix: Array<{ city: string; inReviews: boolean; cells: Array<{ service: string; city: string; state: 'built' | 'building' | 'queued' | 'recommended' | 'available' }> }>;
        summary: { total: number; built: number; available: number; pct: number };
      }>(`/api/projects/${id}/coverage`),
    expand: (id: number, pages: Array<{ type: string; service?: string; city?: string }>) =>
      apiFetch<{ created: number; skipped: number; estimatedMinutes: number; pages: Array<{ pageId: number; jobId: number; service?: string; city?: string }>; errors: string[] }>(
        `/api/projects/${id}/expand`,
        { method: 'POST', body: JSON.stringify({ pages }) },
      ),
  },
  briefs: {
    generate: (input: { projectId?: number; leadId?: number; tier?: 1 | 2 | 3; type?: 'initial' | 'add-page'; page?: { type: string; service?: string; city?: string } }) =>
      apiFetch<{ markdown: string; source: 'claude' | 'template' }>('/api/briefs/generate', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    queue: (input: { projectId: number; briefMarkdown: string; jobType?: 'initial-build' | 'add-page'; pageId?: number }) =>
      apiFetch<{ jobId: number; status: string }>('/api/briefs/queue', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    queueStatus: () => apiFetch<QueueStatus>('/api/briefs/queue/status'),
  },
  cowork: {
    markStarted: (jobId: number) =>
      apiFetch<{ ok: boolean }>('/api/webhook/cowork/started', {
        method: 'POST',
        body: JSON.stringify({ jobId }),
      }),
    markDone: (jobId: number, pageUrl?: string) =>
      apiFetch<{ ok: boolean }>('/api/webhook/cowork/manual-complete', {
        method: 'POST',
        body: JSON.stringify({ jobId, pageUrl }),
      }),
    markFailed: (jobId: number, error: string) =>
      apiFetch<{ ok: boolean }>('/api/webhook/cowork/completed', {
        method: 'POST',
        body: JSON.stringify({ jobId, success: false, error }),
      }),
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
