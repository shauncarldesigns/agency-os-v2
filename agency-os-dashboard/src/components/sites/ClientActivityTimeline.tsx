import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Globe2,
  RefreshCw,
  SearchCheck,
  Settings2,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { ProjectActivityEvent, ShowToast } from '../../lib/types';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

const EVENT_ICONS = {
  brief_generated: FileText,
  brief_completed: FileText,
  page_added: Globe2,
  page_completed: Globe2,
  website_scanned: Globe2,
  dns_checked: Globe2,
  onboarding_completed: ClipboardCheck,
  report_sent: BarChart3,
  reporting_refreshed: BarChart3,
  seo_audit: SearchCheck,
  growth_work: Activity,
  project_created: CheckCircle2,
  project_updated: Settings2,
  client_converted: CheckCircle2,
} as const;

const TONE_STYLES: Record<ProjectActivityEvent['tone'], string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
};

function formatActivityTime(value: string) {
  const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

export function ClientActivityTimeline({ projectId, showToast }: { projectId: number; showToast: ShowToast }) {
  const [events, setEvents] = useState<ProjectActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await api.projects.activity(projectId);
      setEvents(result.events);
    } catch (err) {
      showToast(`Could not load client activity: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, showToast]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const result: Array<{ label: string; events: ProjectActivityEvent[] }> = [];
    for (const item of events) {
      const date = new Date(item.occurredAt.endsWith('Z') || item.occurredAt.includes('+') ? item.occurredAt : `${item.occurredAt.replace(' ', 'T')}Z`);
      const label = Number.isNaN(date.getTime())
        ? 'Earlier'
        : new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
      const current = result[result.length - 1];
      if (current?.label === label) current.events.push(item);
      else result.push({ label, events: [item] });
    }
    return result;
  }, [events]);

  return (
    <section className="workspace-card client-activity-card">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Client timeline</h3>
          <p className="mt-1 text-sm text-slate-500">Website, content, onboarding, SEO, and reporting work in one history.</p>
        </div>
        <Button variant="ghost" size="sm" disabled={refreshing} onClick={() => void load(true)}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center"><Spinner /></div>
      ) : events.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <Activity size={28} className="mx-auto text-slate-300" />
          <p className="mt-3 font-medium text-slate-700">No recorded activity yet</p>
          <p className="mt-1 text-sm text-slate-500">Actions will appear here as this workspace is configured and work is completed.</p>
        </div>
      ) : (
        <div className="px-5 py-4">
          {grouped.map((group) => (
            <div key={group.label} className="mb-6 last:mb-0">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{group.label}</p>
              <div className="space-y-3">
                {group.events.map((item) => {
                  const Icon = EVENT_ICONS[item.kind as keyof typeof EVENT_ICONS]
                    ?? (item.tone === 'error' ? AlertTriangle : Activity);
                  return (
                    <article key={item.id} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${TONE_STYLES[item.tone]}`}>
                        <Icon size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                          <p className="font-medium text-slate-800">{item.title}</p>
                          <time className="shrink-0 text-xs text-slate-400">{formatActivityTime(item.occurredAt)}</time>
                        </div>
                        {item.detail && <p className="mt-1 text-sm leading-5 text-slate-500">{item.detail}</p>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
