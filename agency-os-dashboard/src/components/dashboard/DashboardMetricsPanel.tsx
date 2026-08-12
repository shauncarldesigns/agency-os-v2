import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  CalendarCheck2,
  Flame,
  Globe2,
  MousePointerClick,
  PhoneCall,
  RefreshCw,
  Repeat2,
  Send,
  Target,
  Users,
} from 'lucide-react';
import {
  api,
  ApiError,
  type AgencySummary,
  type AnalyticsRange,
  type PipelineHotLead,
  type PipelineKpisResponse,
  type TextOutreachActivityRange,
  type TextOutreachActivityResponse,
} from '../../lib/api';
import type { ShowToast, Tab } from '../../lib/types';
import { Spinner } from '../shared/Spinner';

interface DashboardMetricsPanelProps {
  showToast: ShowToast;
  onSwitchTab?: (tab: Tab) => void;
}

interface SendTimingState {
  activity: TextOutreachActivityResponse['activity'];
  range: TextOutreachActivityRange;
  loading: boolean;
}

export function DashboardMetricsPanel({ showToast, onSwitchTab }: DashboardMetricsPanelProps) {
  const [data, setData] = useState<PipelineKpisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sendTiming, setSendTiming] = useState<SendTimingState | null>(null);
  const [engagementRange, setEngagementRange] = useState<TextOutreachActivityRange>('30d');

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.dashboard.pipelineKpis(engagementRange);
      setData(res);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load dashboard KPIs: ${msg}`, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast, engagementRange]);

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
    <div className="page-container">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-slate-900">Pipeline dashboard</h2>
          <p className="mt-1 text-xs text-slate-400">
            KPI view for the text + site funnel. Sent volume is context; the headline is taps, engagement, and bookings.
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

      <NeedsActionSection
        leads={data.needsAction}
        onOpenText={() => onSwitchTab?.('automated-pipeline')}
        onOpenEmail={() => onSwitchTab?.('email-outreach')}
      />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <HeroKpi
          icon={Flame}
          label="Engaged leads ready to call"
          value={data.hero.hotLeadsReadyToCall.toString()}
          sub="Not called since their latest engagement"
          tone="emerald"
          onClick={() => onSwitchTab?.('automated-pipeline')}
        />
        <HeroKpi
          icon={CalendarCheck2}
          label="Meetings booked"
          value={data.hero.meetingsBookedThisWeek.toString()}
          sub="This calling week"
          tone="indigo"
          onClick={() => onSwitchTab?.('email-outreach')}
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

      <TextOutreachActivitySection
        showToast={showToast}
        fallback={data.activity.current}
        onTimingChange={setSendTiming}
      />

      <AgencySummarySection showToast={showToast} />

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Engagement by touch</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              First engagement attributed to the most recent text · {activityRangeLabel(engagementRange)}
            </p>
          </div>
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <RangeButton active={engagementRange === '7d'} onClick={() => setEngagementRange('7d')}>Last 7 days</RangeButton>
            <RangeButton active={engagementRange === '30d'} onClick={() => setEngagementRange('30d')}>Last 30 days</RangeButton>
            <RangeButton active={engagementRange === 'all'} onClick={() => setEngagementRange('all')}>All time</RangeButton>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <EffectivenessCard
            label="Intro text"
            value={data.effectiveness.current.engagementByTouch.intro.rate}
            trend={data.effectiveness.trends.engagementByTouch.intro}
            emptyLabel="No intro texts"
            detail={`${data.effectiveness.current.engagementByTouch.intro.engaged} of ${data.effectiveness.current.engagementByTouch.intro.sent} leads engaged after the intro`}
          />
          <EffectivenessCard
            label="Reminder"
            value={data.effectiveness.current.engagementByTouch.reminder.rate}
            trend={data.effectiveness.trends.engagementByTouch.reminder}
            emptyLabel="No reminders"
            detail={`${data.effectiveness.current.engagementByTouch.reminder.engaged} of ${data.effectiveness.current.engagementByTouch.reminder.sent} leads engaged after the reminder`}
          />
          <EffectivenessCard
            label="Final nudge"
            value={data.effectiveness.current.engagementByTouch.finalNudge.rate}
            trend={data.effectiveness.trends.engagementByTouch.finalNudge}
            emptyLabel="No final nudges"
            detail={`${data.effectiveness.current.engagementByTouch.finalNudge.engaged} of ${data.effectiveness.current.engagementByTouch.finalNudge.sent} leads engaged after the final nudge`}
          />
        </div>
      </section>

      <div className="mt-5">
        <MessageSendTimeSection timing={sendTiming} />
      </div>
    </div>
  );
}

function NeedsActionSection({
  leads,
  onOpenText,
  onOpenEmail,
}: {
  leads: PipelineHotLead[];
  onOpenText: () => void;
  onOpenEmail: () => void;
}) {
  const visibleLeads = leads.slice(0, 4);
  const textCount = leads.filter((lead) => lead.outreach_channel === 'text').length;
  // outreach_channel 'call' marks leads that came through the email motion
  // (see the CASE in routes/dashboard.ts) — the follow-up lives on the
  // Email Outreach page, so the button is labeled Email.
  const emailCount = leads.filter((lead) => lead.outreach_channel === 'call').length;
  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-sm font-bold text-slate-900">Needs action</h3>
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600">{leads.length}</span>
          <span className="hidden truncate text-xs text-slate-400 sm:inline">Engaged and awaiting follow-up</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {textCount > 0 && (
            <button
              onClick={onOpenText}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              Text {textCount} <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          )}
          {emailCount > 0 && (
            <button
              onClick={onOpenEmail}
              className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100"
            >
              Email {emailCount} <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">
          No engaged leads waiting on a call.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {visibleLeads.map((lead) => <NeedsActionRow key={lead.id} lead={lead} />)}
        </div>
      )}
    </section>
  );
}

function TextOutreachActivitySection({
  showToast,
  fallback,
  onTimingChange,
}: {
  showToast: ShowToast;
  fallback: TextOutreachActivityResponse['activity'];
  onTimingChange: (timing: SendTimingState) => void;
}) {
  const [range, setRange] = useState<TextOutreachActivityRange>('30d');
  const [activity, setActivity] = useState<TextOutreachActivityResponse['activity']>(fallback);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    onTimingChange({ activity, range, loading: true });
    api.dashboard.textOutreachActivity(range)
      .then((res) => {
        if (!cancelled) {
          setActivity(res.activity);
          onTimingChange({ activity: res.activity, range, loading: false });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        showToast(`Could not load text outreach activity: ${msg}`, 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, showToast, fallback, onTimingChange]);

  const rangeDetail = activityRangeLabel(range);

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Text Outreach Activity</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Real activity logged from site builds, SMS sends, follow-ups, and tracked link visits
          </p>
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-1">
          <RangeButton active={range === '7d'} onClick={() => setRange('7d')}>Last 7 days</RangeButton>
          <RangeButton active={range === '30d'} onClick={() => setRange('30d')}>Last 30 days</RangeButton>
          <RangeButton active={range === 'all'} onClick={() => setRange('all')}>All time</RangeButton>
        </div>
      </div>
      <div className={`grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-2 xl:grid-cols-4 ${loading ? 'opacity-60' : 'opacity-100'}`}>
        <ActivityStat
          icon={Globe2}
          label="Sites created"
          value={activity.sitesCreated}
          detail={`Active built sites · ${rangeDetail}`}
          tone="blue"
        />
        <ActivityStat
          icon={Send}
          label="Intro texts sent"
          value={activity.introTextsSent}
          detail={`Text 1 sends · ${rangeDetail}`}
          tone="indigo"
        />
        <ActivityStat
          icon={Repeat2}
          label="Follow-ups sent"
          value={activity.followUpsSent}
          detail={`Pricing follow-ups · ${rangeDetail}`}
          tone="slate"
        />
        <ActivityStat
          icon={MousePointerClick}
          label="Engaged leads"
          value={activity.engagedLeads}
          detail={`${activity.totalVisits} total visit${activity.totalVisits === 1 ? '' : 's'} · ${rangeDetail}`}
          tone="emerald"
        />
      </div>
    </section>
  );
}

function AgencySummarySection({ showToast }: { showToast: ShowToast }) {
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [summary, setSummary] = useState<AgencySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.dashboard.agencySummary(range)
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        showToast(`Could not load agency summary: ${msg}`, 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, showToast]);

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Agency summary</h3>
          <p className="mt-0.5 text-xs text-slate-400">Call output, demo conversion, and new project movement</p>
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setRange('30d')}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${range === '30d' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Last 30 days
          </button>
          <button
            type="button"
            onClick={() => setRange('all')}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${range === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            All time
          </button>
        </div>
      </div>

      {loading && !summary ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
          <Spinner /> Loading agency summary...
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryStat label="Calls / day" value={summary.calls_per_day.toString()} detail={`${summary.total_calls} calls · ${summary.call_days} days`} />
          <SummaryStat label="Dial to set" value={`${summary.dial_to_set_rate_pct}%`} detail={`${summary.demos_booked} demos booked`} tone="emerald" />
          <SummaryStat label="Demos held" value={summary.demos_held.toString()} detail={`${summary.demos_no_show} no-show${summary.demos_no_show === 1 ? '' : 's'}`} tone="indigo" />
          <SummaryStat label="New projects" value={summary.new_projects.toString()} detail={range === '30d' ? 'Last 30 days' : 'All time'} tone="blue" />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
          Agency summary unavailable.
        </div>
      )}
    </section>
  );
}

function RangeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-semibold ${active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
    >
      {children}
    </button>
  );
}

function SummaryStat({
  label,
  value,
  detail,
  tone = 'slate',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'blue' | 'indigo' | 'emerald' | 'slate';
}) {
  const valueCls = {
    blue: 'text-blue-600',
    indigo: 'text-indigo-600',
    emerald: 'text-emerald-600',
    slate: 'text-slate-900',
  }[tone];
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tracking-tight ${valueCls}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function ActivityStat({
  icon: Icon,
  label,
  value,
  trend,
  detail,
  tone,
}: {
  icon: typeof Target;
  label: string;
  value: number;
  trend?: number;
  detail: string;
  tone: 'blue' | 'indigo' | 'emerald' | 'slate';
}) {
  const toneCls = {
    blue: 'bg-blue-50 text-blue-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    slate: 'bg-slate-100 text-slate-600',
  }[tone].split(' ');
  const [bg, text] = toneCls;
  const trendCls = trend === undefined
    ? 'text-slate-400'
    : trend === 0
      ? 'text-slate-400'
      : trend > 0
        ? 'text-emerald-600'
        : 'text-rose-500';

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${bg}`}>
          <Icon className={`h-4 w-4 ${text}`} />
        </div>
        <span className={`rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold ${trendCls}`}>
          {trend === undefined ? 'Live' : formatCountDelta(trend)}
        </span>
      </div>
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function activityRangeLabel(range: TextOutreachActivityRange): string {
  if (range === '7d') return 'last 7 days';
  if (range === '30d') return 'last 30 days';
  return 'all time';
}

function formatDashboardHour(hour: number): string {
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
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

function EffectivenessCard({
  label,
  value,
  trend,
  detail,
  emptyLabel,
}: {
  label: string;
  value: number | null;
  trend: number | null;
  detail: string;
  emptyLabel: string;
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
          <div className="mt-1 text-xl font-bold text-slate-900">{hasValue ? `${value.toFixed(1)}%` : emptyLabel}</div>
        </div>
        <span className={`rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold ${trendCls}`}>
          {trendLabel}
        </span>
      </div>
      <div className="mt-2 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function MessageSendTimeSection({ timing }: { timing: SendTimingState | null }) {
  // Operator sending window: 8am–8pm. Twelve buckets represent messages
  // sent from 8:00–8:59am through 7:00–7:59pm; 8pm is the right edge.
  const sendByHour = (timing?.activity.sendByHour ?? [])
    .filter((point) => point.hour >= 8 && point.hour < 20);
  const maxHourlySends = Math.max(1, ...sendByHour.map((point) => point.total));
  const totalMessages = sendByHour.reduce((sum, point) => sum + point.total, 0);
  const peakHour = sendByHour.reduce<(typeof sendByHour)[number] | null>(
    (peak, point) => (!peak || point.total > peak.total ? point : peak),
    null,
  );
  const peakHourValue = peakHour?.total ?? 0;
  const rangeDetail = activityRangeLabel(timing?.range ?? '30d');

  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60 transition-opacity ${timing?.loading ? 'opacity-60' : 'opacity-100'}`}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Message send times</h3>
          <p className="mt-0.5 text-xs text-slate-400">Intro texts and follow-ups · 8am–8pm Chicago time</p>
        </div>
        <p className="text-[11px] text-slate-400">{rangeDetail} · totals by hour</p>
      </div>
      {totalMessages === 0 ? (
        <div className="flex h-52 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 text-xs text-slate-400">
          {timing?.loading ? 'Loading send activity…' : 'No sent-message activity in this range.'}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50/30 px-4 pb-4 pt-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Messages sent by hour</h4>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-blue-200" />Intro texts</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-blue-400" />Follow-ups</span>
              {peakHour && peakHour.total > 0 && <span className="font-semibold text-blue-700">Peak {formatDashboardHour(peakHour.hour)} · {peakHour.total}</span>}
            </div>
          </div>
          <div className="overflow-x-auto pb-1">
            <div className="flex h-40 min-w-[560px] items-end gap-2">
              {sendByHour.map((point) => {
                const totalHeight = (point.total / maxHourlySends) * 116;
                const introHeight = point.total > 0 ? totalHeight * (point.intro / point.total) : 0;
                const followupHeight = totalHeight - introHeight;
                const isPeak = point.total > 0 && point.total === peakHourValue;
                return (
                  <div
                    key={point.hour}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                    title={`${formatDashboardHour(point.hour)}: ${point.intro} intro, ${point.followUps} follow-up`}
                  >
                    {point.total > 0 && <span className={`mb-1 text-[9px] font-semibold ${isPeak ? 'text-blue-700' : 'text-slate-500'}`}>{point.total}</span>}
                    <div className="flex w-full min-w-7 flex-col justify-end overflow-hidden rounded-t-[5px]">
                      <div className={isPeak ? 'bg-blue-500' : 'bg-blue-400'} style={{ height: `${followupHeight}px` }} />
                      <div className={isPeak ? 'bg-blue-700' : 'bg-blue-200'} style={{ height: `${introHeight}px` }} />
                    </div>
                    <span className={`mt-2 h-4 text-[9px] ${isPeak ? 'font-bold text-blue-700' : 'text-slate-400'}`}>{formatDashboardHour(point.hour)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function NeedsActionRow({ lead }: { lead: PipelineHotLead }) {
  const score = lead.engagement_score ?? 0;
  const tone = score >= 90
    ? 'border-rose-200 bg-rose-50/70'
    : score >= 70
      ? 'border-emerald-200 bg-emerald-50/60'
      : score >= 40
        ? 'border-amber-200 bg-amber-50/60'
        : lead.pipeline_sessions > 0
          ? 'border-orange-200 bg-orange-50/60'
          : 'border-slate-200 bg-slate-50';
  const actionLabel = score >= 90
    ? 'Call now'
    : score >= 70
      ? 'Walkthrough'
      : score >= 40
        ? 'Follow up'
        : 'Nurture';
  const place = [lead.city, lead.state].filter(Boolean).join(', ') || 'No location';
  return (
    <div className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 ${tone}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="truncate text-xs font-semibold text-slate-900">{lead.company}</div>
          <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold text-slate-700">{score}</span>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-slate-500">
          {lead.outreach_channel === 'call' ? 'Email Outreach' : 'Text Outreach'} · {actionLabel} · {lead.pipeline_sessions} visit{lead.pipeline_sessions === 1 ? '' : 's'} · {place}
        </div>
      </div>
      {lead.phone && (
        <a
          href={`tel:${lead.phone}`}
          title={`Call ${lead.company}`}
          aria-label={`Call ${lead.company}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-blue-700 shadow-sm"
        >
          <PhoneCall className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

function formatCountDelta(value: number) {
  if (value === 0) return 'No change';
  return `${value > 0 ? '+' : ''}${value} vs last week`;
}
