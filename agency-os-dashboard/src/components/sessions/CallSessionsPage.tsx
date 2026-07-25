import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronRight,
  Clock,
  Filter,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
} from 'lucide-react';
import { api, ApiError, industryLabel, type DemoWithLead } from '../../lib/api';
import type { Callback, Lead } from '../../lib/types';
import type { ShowToast, Tab } from '../../lib/types';
import { LeadDetailModal } from '../shared/LeadDetailModal';
import { Spinner } from '../shared/Spinner';

interface Props {
  showToast: ShowToast;
  onOpenSession: (sessionId: number, leadId?: number) => void;
  onStateChanged?: () => void;
  onSwitchTab?: (tab: Tab) => void;
}

type CardTone = 'emerald' | 'amber' | 'blue' | 'rose' | 'slate';

type BoardItem = {
  id: string;
  leadId: number;
  title: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  rating: number | null;
  reviews: number | null;
  eyebrow: string;
  detail: string;
  note?: string | null;
  ageLabel: string;
  activityLabel: string;
  outcomeLabel: string | null;
  tone: CardTone;
  sortAt?: string | null;
};

type BoardColumn = {
  id: string;
  title: string;
  description: string;
  icon: typeof CalendarClock;
  tone: CardTone;
  items: BoardItem[];
};

const ALL = 'all';

export function CallSessionsPage({ showToast, onOpenSession }: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [demos, setDemos] = useState<DemoWithLead[]>([]);
  const [industryFilter, setIndustryFilter] = useState(ALL);
  const [cityFilter, setCityFilter] = useState(ALL);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openingLeadId, setOpeningLeadId] = useState<number | null>(null);
  const [viewLeadId, setViewLeadId] = useState<number | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [cold, contacted, qualified, client, pendingCallbacks, bookedDemos] = await Promise.all([
        api.leads.list({ status: 'cold' }),
        api.leads.list({ status: 'contacted' }),
        api.leads.list({ status: 'qualified' }),
        api.leads.list({ status: 'client' }),
        api.callbacks.list({ status: 'pending' }),
        api.demos.list({ status: 'booked' }),
      ]);
      setLeads([...cold.leads, ...contacted.leads, ...qualified.leads, ...client.leads]);
      setCallbacks(pendingCallbacks.callbacks);
      setDemos(bookedDemos.demos);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load call board: ${msg}`, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const callbacksByLead = useMemo(() => {
    const map = new Map<number, Callback[]>();
    callbacks.forEach((callback) => {
      const list = map.get(callback.lead_id) ?? [];
      list.push(callback);
      map.set(callback.lead_id, list);
    });
    for (const list of map.values()) {
      list.sort((a, b) => a.due_date.localeCompare(b.due_date));
    }
    return map;
  }, [callbacks]);

  const demosByLead = useMemo(() => {
    const map = new Map<number, DemoWithLead[]>();
    demos.forEach((demo) => {
      const list = map.get(demo.lead_id) ?? [];
      list.push(demo);
      map.set(demo.lead_id, list);
    });
    for (const list of map.values()) {
      list.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
    }
    return map;
  }, [demos]);

  const todayIso = localDateIso();

  const columns = useMemo(() => buildColumns({
    leads,
    callbacksByLead,
    demosByLead,
    todayIso,
  }), [leads, callbacksByLead, demosByLead, todayIso]);

  const filterOptions = useMemo(() => {
    const allItems = columns.flatMap((column) => column.items);
    return {
      industries: uniqueSorted(allItems.map((item) => item.industry).filter(Boolean) as string[]),
      cities: uniqueSorted(allItems.map((item) => formatPlace(item.city, item.state)).filter(Boolean)),
    };
  }, [columns]);

  const filteredColumns = useMemo(() => {
    return columns.map((column) => ({
      ...column,
      items: column.items.filter((item) => {
        const industryMatch = industryFilter === ALL || item.industry === industryFilter;
        const cityMatch = cityFilter === ALL || formatPlace(item.city, item.state) === cityFilter;
        return industryMatch && cityMatch;
      }),
    }));
  }, [columns, industryFilter, cityFilter]);

  const totalVisible = filteredColumns.reduce((sum, column) => sum + column.items.length, 0);
  const hasFilters = industryFilter !== ALL || cityFilter !== ALL;

  async function openLeadInExecutionCenter(leadId: number) {
    setOpeningLeadId(leadId);
    try {
      const res = await api.sessions.hotAdd([leadId]);
      onOpenSession(res.session_id, leadId);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not open call execution center: ${msg}`, 'error');
    } finally {
      setOpeningLeadId(null);
    }
  }

  if (loading && leads.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-slate-400">
        <Spinner /> Loading call board...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-slate-900">Call board</h2>
          <p className="mt-1 text-xs text-slate-400">
            Cold-call workflow for fresh calls, due follow-ups, and future callbacks.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BoardSelect
            icon={Filter}
            value={industryFilter}
            onChange={setIndustryFilter}
            label="Industry"
            options={filterOptions.industries.map((value) => ({ value, label: industryLabel(value) }))}
          />
          <BoardSelect
            icon={MapPin}
            value={cityFilter}
            onChange={setCityFilter}
            label="City"
            options={filterOptions.cities.map((value) => ({ value, label: value }))}
          />
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setIndustryFilter(ALL);
                setCityFilter(ALL);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm shadow-slate-200/60 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm shadow-slate-200/60 hover:bg-slate-50 disabled:opacity-60"
          >
            {refreshing ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      <section className="flex items-start gap-3 overflow-x-auto pb-4">
        {filteredColumns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            openingLeadId={openingLeadId}
            onOpenLead={openLeadInExecutionCenter}
            onViewLead={setViewLeadId}
          />
        ))}
      </section>

      {totalVisible === 0 && (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-white/70 py-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <Search className="h-6 w-6 text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-slate-700">No cards match those filters</p>
          <p className="mt-1 text-xs text-slate-400">Clear the filters or refresh the board.</p>
        </div>
      )}

      {viewLeadId !== null && (
        <LeadDetailModal
          leadId={viewLeadId}
          onClose={() => setViewLeadId(null)}
          showToast={showToast}
          onLeadUpdated={() => void load(true)}
        />
      )}
    </div>
  );
}

function buildColumns(input: {
  leads: Lead[];
  callbacksByLead: Map<number, Callback[]>;
  demosByLead: Map<number, DemoWithLead[]>;
  todayIso: string;
}): BoardColumn[] {
  const columns: BoardColumn[] = [
    { id: 'to-call', title: 'To Call', description: 'Never contacted, fresh queue', icon: CalendarClock, tone: 'blue', items: [] },
    { id: 'retry', title: 'Retry', description: 'Attempted, no firm next step', icon: RefreshCw, tone: 'rose', items: [] },
    { id: 'waiting', title: 'Waiting', description: 'Callback is still in the future', icon: Clock, tone: 'slate', items: [] },
    { id: 'follow-up-due', title: 'Follow-Up Due', description: 'Callback date has arrived', icon: CalendarClock, tone: 'amber', items: [] },
  ];
  const byId = Object.fromEntries(columns.map((column) => [column.id, column]));

  input.leads.forEach((lead) => {
    const leadCallbacks = input.callbacksByLead.get(lead.id) ?? [];
    const nextCallback = leadCallbacks[0];
    const dueCallback = leadCallbacks.find((callback) => callback.due_date <= input.todayIso);
    const leadFollowupDate = parseLeadFollowupDate(lead.followup);
    const leadFollowupDue = !dueCallback && !nextCallback && leadFollowupDate && leadFollowupDate <= input.todayIso;
    const leadFollowupFuture = !dueCallback && !nextCallback && leadFollowupDate && leadFollowupDate > input.todayIso;
    const bookedDemo = input.demosByLead.get(lead.id)?.[0];

    if (lead.status === 'not_interested' || lead.pipeline_status === 'archived') {
      return;
    }

    if (lead.status === 'client' || lead.status === 'qualified' || lead.pipeline_status === 'booked' || bookedDemo) {
      return;
    }

    if (lead.status === 'cold') {
      byId['to-call'].items.push(leadItem(lead, {
        eyebrow: 'Fresh lead',
        detail: lead.opportunity_score ? `${lead.opportunity_score} opportunity score` : 'Never contacted',
        note: lead.opportunity_reasoning,
        activityLabel: 'Not called',
        tone: 'blue',
        sortAt: lead.updated_at,
      }));
      return;
    }

    if (dueCallback) {
      byId['follow-up-due'].items.push(leadItem(lead, {
        eyebrow: dueCallback.due_date < input.todayIso ? 'Overdue callback' : 'Callback due',
        detail: `${dueCallback.due_date < input.todayIso ? 'Originally' : 'Due'} ${formatDate(dueCallback.due_date)}${dueCallback.block_hint ? ` · ${dueCallback.block_hint}` : ''}`,
        note: dueCallback.notes ?? lead.notes,
        activityLabel: dueCallback.due_date < input.todayIso ? 'Overdue' : 'Due today',
        tone: 'amber',
        sortAt: dueCallback.due_date,
      }));
      return;
    }

    if (leadFollowupDue) {
      byId['follow-up-due'].items.push(leadItem(lead, {
        eyebrow: leadFollowupDate < input.todayIso ? 'Overdue follow-up' : 'Follow-up due',
        detail: `${leadFollowupDate < input.todayIso ? 'Originally' : 'Due'} ${formatDate(leadFollowupDate)}`,
        note: lead.followup ?? lead.notes,
        activityLabel: leadFollowupDate < input.todayIso ? 'Overdue' : 'Due today',
        tone: 'amber',
        sortAt: leadFollowupDate,
      }));
      return;
    }

    if (nextCallback) {
      byId.waiting.items.push(leadItem(lead, {
        eyebrow: 'Waiting',
        detail: `Callback ${formatDate(nextCallback.due_date)}${nextCallback.block_hint ? ` · ${nextCallback.block_hint}` : ''}`,
        note: nextCallback.notes ?? lead.notes,
        activityLabel: 'Waiting',
        tone: 'slate',
        sortAt: nextCallback.due_date,
      }));
      return;
    }

    if (leadFollowupFuture) {
      byId.waiting.items.push(leadItem(lead, {
        eyebrow: 'Waiting',
        detail: `Follow-up ${formatDate(leadFollowupDate)}`,
        note: lead.followup ?? lead.notes,
        activityLabel: 'Waiting',
        tone: 'slate',
        sortAt: leadFollowupDate,
      }));
      return;
    }

    if (lead.status === 'contacted') {
      byId.retry.items.push(leadItem(lead, {
        eyebrow: retryEyebrow(lead),
        detail: 'No callback date set',
        note: lead.notes || lead.outcome,
        activityLabel: lead.last_called_at ? 'Retry' : 'Contacted',
        tone: 'rose',
        sortAt: lead.last_called_at ?? lead.updated_at,
      }));
    }
  });

  columns.forEach((column) => {
    const ascending = column.id === 'waiting' || column.id === 'follow-up-due';
    column.items.sort(ascending ? bySortAtAsc : bySortAtDesc);
  });
  return columns;
}

function leadItem(
  lead: Lead,
  overrides: Pick<BoardItem, 'eyebrow' | 'detail' | 'note' | 'tone' | 'sortAt'> & {
    activityLabel?: string;
  }
): BoardItem {
  return {
    id: `${lead.id}-${overrides.eyebrow}`,
    leadId: lead.id,
    title: lead.company,
    phone: lead.phone,
    city: lead.city,
    state: lead.state,
    industry: lead.industry,
    rating: lead.google_rating,
    reviews: lead.google_review_count,
    ageLabel: formatAgeLabel(lead),
    activityLabel: overrides.activityLabel ?? 'Ready',
    outcomeLabel: callOutcomeLabel(lead),
    ...overrides,
  };
}

function KanbanColumn({
  column,
  openingLeadId,
  onOpenLead,
  onViewLead,
}: {
  column: BoardColumn;
  openingLeadId: number | null;
  onOpenLead: (leadId: number) => void;
  onViewLead: (leadId: number) => void;
}) {
  const cls = toneClasses(column.tone);
  return (
    <div className="w-72 shrink-0 rounded-2xl bg-slate-100/80 p-2.5">
      <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${cls.solidIconBg}`}>
              <column.icon className="h-3 w-3 text-white" strokeWidth={2.5} />
            </span>
            {column.title}
          </span>
          <p className="mt-0.5 truncate pl-6 text-[11px] text-slate-400">{column.description}</p>
        </div>
        <span className="text-xs font-medium text-slate-400">
          {column.items.length}
        </span>
      </div>
      <div className="space-y-2">
        {column.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
            No leads
          </div>
        ) : (
          column.items.map((item) => (
            <BoardCard
              key={item.id}
              item={item}
              opening={openingLeadId === item.leadId}
              onOpen={() => onOpenLead(item.leadId)}
              onViewLead={() => onViewLead(item.leadId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BoardCard({
  item,
  opening,
  onOpen,
  onViewLead,
}: {
  item: BoardItem;
  opening: boolean;
  onOpen: () => void;
  onViewLead: () => void;
}) {
  const place = formatPlace(item.city, item.state);
  const tone = toneClasses(item.tone);
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60 transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 truncate text-sm font-bold text-slate-900">{item.title}</h4>
        <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
          {opening ? <Spinner /> : <span className={`h-2 w-2 rounded-full ${tone.dotBg}`} />}
          {item.activityLabel}
        </span>
      </div>

      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
        <span className="truncate">{item.industry ? industryLabel(item.industry) : item.eyebrow}</span>
        <RatingSummary rating={item.rating} reviews={item.reviews} />
      </div>

      {item.outcomeLabel && (
        <div className="mt-2">
          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
            {item.outcomeLabel}
          </span>
        </div>
      )}

      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500">
        {item.detail}
        {place ? ` · ${place}` : ''}
      </p>

      {item.note && item.note !== item.detail && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-400">{item.note}</p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-blue-600/20 hover:from-blue-700 hover:to-indigo-700"
        >
          Open call <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onViewLead();
          }}
          className="text-[11px] font-medium text-blue-600 hover:text-blue-700"
        >
          View lead
        </button>
      </div>

      <p className="mt-2 text-[11px] text-slate-400">{item.ageLabel}</p>
    </article>
  );
}

function RatingSummary({ rating, reviews }: { rating: number | null; reviews: number | null }) {
  if (rating === null || reviews === null) return null;
  const rounded = Math.round(rating);
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="inline-flex items-center gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star
            key={i}
            className={`h-3 w-3 ${i < rounded ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}`}
          />
        ))}
      </span>
      <span className="font-medium text-amber-500">{rating.toFixed(1)}</span>
      <span>({reviews})</span>
    </span>
  );
}

function BoardSelect({
  icon: Icon,
  value,
  onChange,
  label,
  options,
}: {
  icon: typeof Filter;
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm shadow-slate-200/60">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-xs font-semibold text-slate-700 outline-none"
      >
        <option value={ALL}>All {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function toneClasses(tone: CardTone) {
  return {
    emerald: { iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', solidIconBg: 'bg-emerald-500', dotBg: 'bg-emerald-500' },
    amber: { iconBg: 'bg-amber-50', iconText: 'text-amber-600', solidIconBg: 'bg-amber-500', dotBg: 'bg-amber-500' },
    blue: { iconBg: 'bg-blue-50', iconText: 'text-blue-600', solidIconBg: 'bg-blue-500', dotBg: 'bg-blue-500' },
    rose: { iconBg: 'bg-rose-50', iconText: 'text-rose-600', solidIconBg: 'bg-rose-500', dotBg: 'bg-rose-500' },
    slate: { iconBg: 'bg-slate-100', iconText: 'text-slate-600', solidIconBg: 'bg-slate-500', dotBg: 'bg-slate-400' },
  }[tone];
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function bySortAtDesc(a: BoardItem, b: BoardItem) {
  return timeOf(b.sortAt) - timeOf(a.sortAt);
}

function bySortAtAsc(a: BoardItem, b: BoardItem) {
  return timeOf(a.sortAt) - timeOf(b.sortAt);
}

function timeOf(value: string | null | undefined) {
  return value ? new Date(value).getTime() : 0;
}

function formatPlace(city: string | null | undefined, state: string | null | undefined): string {
  return [city, state].filter(Boolean).join(', ');
}

function formatAgeLabel(lead: Lead): string {
  const label = lead.enrichment_status === 'enriched' ? 'Enriched' : 'Updated';
  return `${label} ${formatRelativeTime(lead.updated_at ?? lead.created_at)}`;
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return 'recently';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 'recently';
  const diffMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 45) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} mo ago`;
}

function localDateIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLeadFollowupDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function callOutcomeLabel(lead: Lead): string | null {
  const raw = [lead.outcome, lead.followup, lead.notes].filter(Boolean).join(' ').toLowerCase();
  if (!raw && !lead.last_called_at) return null;
  if (lead.status === 'not_interested' || raw.includes('not interested')) return 'Not interested';
  if (raw.includes('no answer')) return 'No answer';
  if (raw.includes('voicemail') || raw.includes('vm')) return 'Voicemail left';
  if (raw.includes('callback') || raw.includes('call back') || lead.followup) return 'Callback requested';
  if (raw.includes('owner') || raw.includes('spoke') || raw.includes('conversation')) return 'Spoke with owner';
  if (lead.last_called_at) return 'No answer';
  return null;
}

function retryEyebrow(lead: Lead): string {
  const outcome = callOutcomeLabel(lead);
  if (outcome === 'No answer') return 'No answer';
  if (outcome === 'Voicemail left') return 'Voicemail left';
  if (outcome === 'Spoke with owner') return 'Spoke with owner';
  return 'Retry';
}

function formatDate(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
