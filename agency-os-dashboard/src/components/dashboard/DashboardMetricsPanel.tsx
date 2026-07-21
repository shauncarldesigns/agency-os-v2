import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  CalendarCheck2,
  Flame,
  MessageSquareText,
  MousePointerClick,
  PhoneCall,
  RefreshCw,
  Send,
  Target,
  Users,
} from 'lucide-react';
import {
  api,
  ApiError,
  type PipelineChannelMetrics,
  type PipelineFunnelMetrics,
  type PipelineHotLead,
  type PipelineKpisResponse,
} from '../../lib/api';
import type { ShowToast, Tab } from '../../lib/types';
import { Spinner } from '../shared/Spinner';

interface DashboardMetricsPanelProps {
  showToast: ShowToast;
  onSwitchTab?: (tab: Tab) => void;
}

const FUNNEL_ITEMS: Array<{
  key: keyof Pick<PipelineFunnelMetrics, 'tapRate' | 'engagementRate' | 'replyPerTap' | 'bookRate'>;
  label: string;
  detail: (m: PipelineFunnelMetrics) => string;
}> = [
  { key: 'tapRate', label: 'Tap rate', detail: (m) => `${m.tapped} taps / ${m.sent} sent` },
  { key: 'engagementRate', label: 'Engagement rate', detail: (m) => `${m.engaged} engaged / ${m.sent} sent` },
  { key: 'replyPerTap', label: 'Reply per tap', detail: () => 'Reply events not tracked yet' },
  { key: 'bookRate', label: 'Book rate', detail: (m) => `${m.booked} booked / ${m.sent} sent` },
];

export function DashboardMetricsPanel({ showToast, onSwitchTab }: DashboardMetricsPanelProps) {
  const [data, setData] = useState<PipelineKpisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.dashboard.pipelineKpis();
      setData(res);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load dashboard KPIs: ${msg}`, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-slate-400">
        <Spinner /> Loading dashboard KPIs...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <BarChart3 className="h-6 w-6 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-600">Dashboard KPIs unavailable</p>
          <button
            onClick={() => void load(true)}
            className="mt-3 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-slate-900">Pipeline dashboard</h2>
          <p className="mt-1 text-xs text-slate-400">
            KPI view for the text + site funnel. Sent volume is context; the headline is action, replies, and bookings.
          </p>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm shadow-slate-200/60 hover:bg-slate-50 disabled:opacity-60"
        >
          {refreshing ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroKpi
          icon={Flame}
          label="Hot leads ready to call"
          value={data.hero.hotLeadsReadyToCall.toString()}
          sub="Tapped or engaged, not called since"
          tone="emerald"
          onClick={() => onSwitchTab?.('automated-pipeline')}
        />
        <HeroKpi
          icon={MessageSquareText}
          label="This week's reply rate"
          value={formatNullablePct(data.hero.thisWeekReplyRate)}
          sub={data.hero.thisWeekReplyRate === null ? 'Reply tracking not wired yet' : 'vs last week'}
          tone="blue"
        />
        <HeroKpi
          icon={CalendarCheck2}
          label="Meetings booked"
          value={data.hero.meetingsBookedThisWeek.toString()}
          sub="This calling week"
          tone="indigo"
          onClick={() => onSwitchTab?.('call-sessions')}
        />
        <HeroKpi
          icon={Users}
          label="Active leads in pipeline"
          value={data.hero.activeLeadsInPipeline.toString()}
          sub="Enriched, no site, cold/contacted"
          tone="slate"
          onClick={() => onSwitchTab?.('automated-pipeline')}
        />
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Funnel strip</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Week of {data.week.monday} vs previous week
            </p>
          </div>
          <div className="text-xs text-slate-400">
            {data.funnel.current.sent} sent · {data.funnel.current.tapped} tapped · {data.funnel.current.booked} booked
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {FUNNEL_ITEMS.map((item) => (
            <FunnelPill
              key={item.key}
              label={item.label}
              value={data.funnel.current[item.key]}
              trend={data.funnel.trends[item.key]}
              detail={item.detail(data.funnel.current)}
            />
          ))}
        </div>
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Channel split</h3>
              <p className="mt-0.5 text-xs text-slate-400">Same ratios by tracked source</p>
            </div>
            <Send className="h-4 w-4 text-blue-500" />
          </div>
          <div className="space-y-3">
            {data.channels.map((channel) => (
              <ChannelCard key={channel.channel} channel={channel} />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Needs action</h3>
              <p className="mt-0.5 text-xs text-slate-400">Warmest leads first, sorted by recent tracked engagement</p>
            </div>
            <button
              onClick={() => onSwitchTab?.('automated-pipeline')}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"
            >
              Open queue <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {data.needsAction.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-9 text-center text-sm text-slate-400">
              No tapped or engaged leads waiting on a call.
            </div>
          ) : (
            <div className="space-y-2">
              {data.needsAction.map((lead) => (
                <NeedsActionRow key={lead.id} lead={lead} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function HeroKpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  icon: typeof Target;
  label: string;
  value: string;
  sub: string;
  tone: 'blue' | 'indigo' | 'emerald' | 'slate';
  onClick?: () => void;
}) {
  const toneCls = {
    blue: 'bg-blue-50 text-blue-600 from-blue-600 to-sky-500',
    indigo: 'bg-indigo-50 text-indigo-600 from-indigo-600 to-violet-500',
    emerald: 'bg-emerald-50 text-emerald-600 from-emerald-600 to-teal-500',
    slate: 'bg-slate-100 text-slate-600 from-slate-600 to-slate-400',
  }[tone].split(' ');
  const [bg, text, from, to] = toneCls;
  const clickable = Boolean(onClick);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm shadow-slate-200/60 transition ${
        clickable ? 'hover:-translate-y-0.5 hover:shadow-md hover:shadow-slate-200/80' : 'cursor-default'
      }`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}>
          <Icon className={`h-5 w-5 ${text}`} />
        </div>
        <div className={`h-1.5 w-14 rounded-full bg-gradient-to-r ${from} ${to}`} />
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </button>
  );
}

function FunnelPill({
  label,
  value,
  trend,
  detail,
}: {
  label: string;
  value: number | null;
  trend: number | null;
  detail: string;
}) {
  const hasValue = value !== null;
  const trendLabel = trend === null ? 'No trend' : `${trend > 0 ? '+' : ''}${trend.toFixed(1)} pts`;
  const trendCls = trend === null
    ? 'text-slate-400'
    : trend >= 0
      ? 'text-emerald-600'
      : 'text-rose-500';

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{hasValue ? `${value.toFixed(1)}%` : 'Not tracked'}</div>
        </div>
        <span className={`rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold ${trendCls}`}>
          {trendLabel}
        </span>
      </div>
      <div className="mt-2 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function ChannelCard({ channel }: { channel: PipelineChannelMetrics }) {
  if (!channel.tracked || !channel.current) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">{channel.channel}</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-400">Not tracked</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Add channel logging before this gets real numbers.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">{channel.channel}</span>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
          {channel.current.sent} sent
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        <MiniRatio label="Tap" value={channel.current.tapRate} />
        <MiniRatio label="Engage" value={channel.current.engagementRate} />
        <MiniRatio label="Reply/tap" value={channel.current.replyPerTap} />
        <MiniRatio label="Book" value={channel.current.bookRate} />
      </div>
    </div>
  );
}

function MiniRatio({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-bold text-slate-800">{formatNullablePct(value)}</div>
    </div>
  );
}

function NeedsActionRow({ lead }: { lead: PipelineHotLead }) {
  const tone = lead.pipeline_status === 'engaged' || lead.pipeline_sessions > 1
    ? 'border-emerald-200 bg-emerald-50/60'
    : lead.pipeline_sessions > 0
      ? 'border-amber-200 bg-amber-50/60'
      : 'border-orange-200 bg-orange-50/60';
  const place = [lead.city, lead.state].filter(Boolean).join(', ') || 'No location';
  return (
    <div className={`rounded-xl border px-3 py-3 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{lead.company}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>{place}</span>
            <span className="text-slate-300">·</span>
            <span>{lead.pipeline_sessions} visit{lead.pipeline_sessions === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">
          <MousePointerClick className="h-3 w-3" />
          {lead.pipeline_status === 'engaged' ? 'Engaged' : 'Tapped'}
        </div>
      </div>
      {lead.phone && (
        <a href={`tel:${lead.phone}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
          <PhoneCall className="h-3.5 w-3.5" />
          {lead.phone}
        </a>
      )}
    </div>
  );
}

function formatNullablePct(value: number | null) {
  return value === null ? 'Not tracked' : `${value.toFixed(1)}%`;
}
