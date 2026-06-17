import { useState, useEffect, useCallback } from 'react';
import type { ShowToast, Tab } from '../../lib/types';
import {
  api, ApiError,
  type DashboardTodayResponse, type DemoWithLead, type CallbackWithLead,
  type AgencySummary, type ObjectionOverviewItem, type AnalyticsRange,
} from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { Badge } from '../shared/Badge';
import { ProspectingTaskBlock } from './MondayFridayViews';
import { RescheduleDemoModal } from './RescheduleDemoModal';
import { WeekPlanner } from './WeekPlanner';

/**
 * Top-level Dashboard panel.
 *
 * Pulls /api/dashboard once on mount + on tab focus refresh. Hands the data
 * to a day-of-week-routed sub-view (calling / prep / review / quiet). Phase 4
 * ships the calling-day view + priority strip + sessions grid; Mon/Fri views
 * are placeholders until Phase 7.
 */

interface DashboardPanelProps {
  showToast: ShowToast;
  /** Called when an action here causes data the rest of the app cares about
   *  to change (e.g., qualifying a lead). */
  onStateChanged?: () => void;
  /** Open a session's execution view. Phase 5 wires this up; Phase 4 just
   *  surfaces the path. */
  onOpenSession?: (sessionId: number) => void;
  /** Switch to another top-level tab — used by the Prospecting task block's
   *  "Open Prospect tab" button. */
  onSwitchTab?: (tab: Tab) => void;
}

export function DashboardPanel({ showToast, onOpenSession, onSwitchTab }: DashboardPanelProps) {
  const [data, setData] = useState<DashboardTodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  // Reschedule modal state — lifted here so any priority-strip row can open it
  // and the modal survives strip re-renders during data reload.
  const [reschedulingDemo, setReschedulingDemo] = useState<DemoWithLead | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.dashboard.today();
      setData(res);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load dashboard: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  async function handleGenerateWeek() {
    setGenerating(true);
    try {
      const res = await api.sessions.generateWeek();
      const total = res.created.length;
      showToast(
        total > 0
          ? `Generated ${total} session${total === 1 ? '' : 's'} for next calling week`
          : 'No new sessions to generate (week already populated).',
        total > 0 ? 'success' : 'default'
      );
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Generate week failed: ${msg}`, 'error');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)' }}>
        <Spinner /> Loading dashboard…
      </div>
    );
  }

  if (!data) return null;

  return (
    <>
      <div className="sec-header">
        <div>
          <div className="sec-title">Call sessions</div>
          <div className="sec-sub">
            {dayLabelToday(data.today)} · week of {data.today}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>↻ Refresh</Button>
          <Button variant="primary" size="sm" onClick={handleGenerateWeek} disabled={generating}>
            {generating ? <><Spinner /> Generating…</> : '+ Generate week'}
          </Button>
        </div>
      </div>

      {/* Priority strip — demos awaiting status, callbacks due, no-show recovery.
          Renders whenever there's anything to action; otherwise stays hidden. */}
      {hasAnyPriority(data.priorityStrip) && (
        <PriorityStrip
          data={data.priorityStrip}
          showToast={showToast}
          onReload={load}
          onReschedule={setReschedulingDemo}
        />
      )}

      <RescheduleDemoModal
        open={reschedulingDemo !== null}
        demo={reschedulingDemo}
        showToast={showToast}
        onClose={() => setReschedulingDemo(null)}
        onRescheduled={load}
      />

      {/* Week planner — full Mon-Fri view regardless of day-of-week. Active
          session (even if from a prior day) surfaces in the Working Now
          banner so it's always reachable. */}
      <WeekPlanner showToast={showToast} onOpenSession={onOpenSession} />

      {/* Weekly prospecting nudge — kept persistent because the operator
          still needs the 50-leads-per-week target visible regardless of
          which day they open the dashboard. */}
      <div style={{ marginTop: 24 }}>
        <ProspectingTaskBlock onSwitchTab={onSwitchTab} showToast={showToast} />
      </div>

      {/* Always-on analytics — agency summary + objections overview. */}
      <AnalyticsSection />
    </>
  );
}

// ---------- Analytics section (Phase 5) ----------

function AnalyticsSection() {
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [summary, setSummary] = useState<AgencySummary | null>(null);
  const [objections, setObjections] = useState<ObjectionOverviewItem[]>([]);
  const [totalCalls, setTotalCalls] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.dashboard.agencySummary(range), api.dashboard.objectionsOverview(range)])
      .then(([s, o]) => {
        if (cancelled) return;
        setSummary(s);
        setObjections(o.objections);
        setTotalCalls(o.total_calls);
      })
      .catch(() => { /* silent — section just stays blank on error */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  return (
    <div className="analytics-section">
      <div className="analytics-header">
        <h2 className="analytics-title">Agency summary</h2>
        <div className="analytics-range">
          <button
            type="button"
            className={`analytics-range-btn${range === '30d' ? ' active' : ''}`}
            onClick={() => setRange('30d')}
          >Last 30 days</button>
          <button
            type="button"
            className={`analytics-range-btn${range === 'all' ? ' active' : ''}`}
            onClick={() => setRange('all')}
          >All time</button>
        </div>
      </div>

      {loading && !summary ? (
        <div style={{ padding: 18, color: 'var(--text3)' }}><Spinner /> Loading metrics…</div>
      ) : summary && (
        <div className="analytics-grid">
          <AnalyticsCard label="Calls / day" value={summary.calls_per_day.toString()} sub={`${summary.total_calls} calls · ${summary.call_days} days`} />
          <AnalyticsCard label="Dial → set" value={`${summary.dial_to_set_rate_pct}%`} sub={`${summary.demos_booked} demos booked`} accent="green" />
          <AnalyticsCard label="Demos held" value={summary.demos_held.toString()} sub={`${summary.demos_no_show} no-shows`} />
          <AnalyticsCard label="New projects" value={summary.new_projects.toString()} sub={range === '30d' ? 'last 30 days' : 'all time'} />
        </div>
      )}

      <div className="analytics-header" style={{ marginTop: 24 }}>
        <h2 className="analytics-title">Objections overview</h2>
        <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>
          {totalCalls > 0 ? `Across ${totalCalls} calls` : 'No call data yet'}
        </div>
      </div>

      {objections.length === 0 ? (
        <div style={{ padding: 18, color: 'var(--text3)', fontSize: '0.78rem', border: '1px dashed var(--border)', borderRadius: 'var(--rl)' }}>
          Tap an objection chip during a call to start populating this view.
        </div>
      ) : (
        <div className="objections-grid">
          {objections.map((o) => <ObjectionCard key={o.objection_id} item={o} />)}
        </div>
      )}
    </div>
  );
}

function AnalyticsCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'green' | 'yellow' | 'red' }) {
  const cls = accent ? `accent-${accent}` : '';
  return (
    <div className="analytics-card">
      <div className="analytics-card-label">{label}</div>
      <div className={`analytics-card-value ${cls}`}>{value}</div>
      {sub && <div className="analytics-card-sub">{sub}</div>}
    </div>
  );
}

function ObjectionCard({ item }: { item: ObjectionOverviewItem }) {
  // Spec: handled-rate < 30% triggers a red "rewrite this" CTA.
  // We only flag when there's enough data to be meaningful (5+ hits).
  const lowHandled = item.total_hits >= 5 && item.handled_rate_pct < 30;
  const handledColor = item.handled_rate_pct >= 60
    ? 'var(--green)'
    : item.handled_rate_pct >= 30 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div className="objection-card">
      <div className="objection-card-top">
        <span className="objection-card-label">{item.label}</span>
        <span className="objection-card-hits">{item.total_hits} hit{item.total_hits === 1 ? '' : 's'}</span>
      </div>
      <div className="objection-freq-bar">
        <div className="objection-freq-fill" style={{ width: `${Math.min(100, item.frequency_pct * 4)}%` }} />
      </div>
      <div className="objection-card-bottom">
        <span className="objection-freq-text">{item.frequency_pct}% of calls</span>
        <span style={{ color: handledColor, fontWeight: 600 }}>{item.handled_rate_pct}% handled</span>
      </div>
      {lowHandled && (
        <div className="objection-card-cta">⚠ Low handled-rate — consider rewriting</div>
      )}
    </div>
  );
}

// ---------- Header label ----------

function dayLabelToday(date: string): string {
  return new Date(`${date}T12:00:00-06:00`).toLocaleDateString('en-US', { weekday: 'long' });
}

// ---------- Priority strip ----------

function hasAnyPriority(strip: DashboardTodayResponse['priorityStrip']): boolean {
  return (
    strip.demosAwaitingStatus.length > 0
    || strip.noShowRecovery.length > 0
    || strip.demosToday.length > 0
    || strip.callbacksDue.length > 0
  );
}

interface PriorityStripProps {
  data: DashboardTodayResponse['priorityStrip'];
  showToast: ShowToast;
  onReload: () => Promise<void> | void;
  onReschedule: (demo: DemoWithLead) => void;
}

function PriorityStrip({ data, showToast, onReload, onReschedule }: PriorityStripProps) {
  if (!hasAnyPriority(data)) {
    return (
      <div style={{
        margin: '14px 0',
        padding: '10px 14px',
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--surface)',
        color: 'var(--text3)',
        fontSize: '0.78rem',
      }}>
        All clear — no priority actions.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '14px 0' }}>
      {data.demosAwaitingStatus.length > 0 && (
        <PriorityGroup label={`Demos awaiting status (${data.demosAwaitingStatus.length})`} accent="red">
          {data.demosAwaitingStatus.map((d) => (
            <DemoAwaitingRow
              key={d.id}
              demo={d}
              showToast={showToast}
              onChanged={onReload}
              onReschedule={() => onReschedule(d)}
            />
          ))}
        </PriorityGroup>
      )}
      {data.noShowRecovery.length > 0 && (
        <PriorityGroup label={`No-show recovery (${data.noShowRecovery.length})`} accent="yellow">
          {data.noShowRecovery.map((d) => (
            <NoShowRow key={d.id} demo={d} />
          ))}
        </PriorityGroup>
      )}
      {data.demosToday.length > 0 && (
        <PriorityGroup label={`Demos today (${data.demosToday.length})`} accent="blue">
          {data.demosToday.map((d) => (
            <DemoTodayRow key={d.id} demo={d} />
          ))}
        </PriorityGroup>
      )}
      {data.callbacksDue.length > 0 && (
        <PriorityGroup label={`Callbacks due today (${data.callbacksDue.length})`} accent="green">
          {data.callbacksDue.map((cb) => (
            <CallbackRow key={cb.id} cb={cb} />
          ))}
        </PriorityGroup>
      )}
    </div>
  );
}

function PriorityGroup({ label, accent, children }: { label: string; accent: 'red' | 'yellow' | 'blue' | 'green'; children: React.ReactNode }) {
  const colorMap: Record<typeof accent, string> = {
    red: 'rgba(248,113,113,0.35)',
    yellow: 'rgba(245,200,66,0.35)',
    blue: 'rgba(96,165,250,0.35)',
    green: 'rgba(74,222,128,0.35)',
  };
  return (
    <div style={{
      border: `1px solid ${colorMap[accent]}`,
      borderRadius: 6,
      background: 'var(--surface)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '6px 12px',
        fontSize: '0.65rem',
        fontWeight: 700,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        color: 'var(--text2)',
        background: 'var(--surface2)',
        borderBottom: `1px solid ${colorMap[accent]}`,
      }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function DemoAwaitingRow({ demo, showToast, onChanged, onReschedule }: {
  demo: DemoWithLead; showToast: ShowToast; onChanged: () => Promise<void> | void; onReschedule: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function mark(status: 'held' | 'no_show') {
    setBusy(true);
    try {
      await api.demos.setStatus(demo.id, { status });
      await onChanged();
      showToast(status === 'held' ? 'Marked held' : 'Marked no-show', status === 'held' ? 'success' : 'default');
    } catch (e) { showToast(`Failed: ${(e as Error).message}`, 'error'); }
    finally { setBusy(false); }
  }
  return (
    <div className="priority-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: '0.82rem' }}>{demo.company}</strong>
        <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>
          Scheduled {formatDateTime(demo.scheduled_for)} · {[demo.city, demo.state].filter(Boolean).join(', ')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5 }}>
        <Button variant="primary" size="xs" onClick={() => mark('held')} disabled={busy}>Held</Button>
        <Button variant="ghost" size="xs" onClick={() => mark('no_show')} disabled={busy}>No-show</Button>
        <Button variant="ghost" size="xs" onClick={onReschedule} disabled={busy}>Reschedule</Button>
      </div>
    </div>
  );
}

function NoShowRow({ demo }: { demo: DemoWithLead }) {
  return (
    <div className="priority-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: '0.82rem' }}>{demo.company}</strong>
        <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>
          Originally {formatDateTime(demo.scheduled_for)} · {demo.phone ?? '—'}
        </div>
      </div>
      <Badge color="yellow">No-show — re-dial</Badge>
    </div>
  );
}

function DemoTodayRow({ demo }: { demo: DemoWithLead }) {
  return (
    <div className="priority-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: '0.82rem' }}>{demo.company}</strong>
        <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>
          {formatDateTime(demo.scheduled_for)} · {demo.phone ?? '—'}
        </div>
      </div>
      <Badge color="blue">Today</Badge>
    </div>
  );
}

function CallbackRow({ cb }: { cb: CallbackWithLead }) {
  const overdue = new Date(cb.due_date) < new Date(new Date().toISOString().slice(0, 10));
  return (
    <div className="priority-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: '0.82rem' }}>{cb.company}</strong>
        <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>
          {overdue ? 'Originally ' : 'Due '}{cb.due_date}{cb.block_hint ? ` · ${cb.block_hint}` : ''}
          {cb.notes ? ` · ${cb.notes.slice(0, 60)}` : ''}
        </div>
      </div>
      <Badge color={overdue ? 'yellow' : 'green'}>{overdue ? 'Overdue' : 'Due'}</Badge>
    </div>
  );
}

// ---------- helpers ----------

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}
