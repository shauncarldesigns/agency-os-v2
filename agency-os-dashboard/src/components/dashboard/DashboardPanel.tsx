import { useState, useEffect, useCallback } from 'react';
import type { ShowToast, Tab } from '../../lib/types';
import {
  api, ApiError,
  type DashboardTodayResponse, type DemoWithLead, type CallbackWithLead,
} from '../../lib/api';
import type { Session } from '../../lib/types';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { Badge } from '../shared/Badge';
import { MondayView, FridayView } from './MondayFridayViews';
import { RescheduleDemoModal } from './RescheduleDemoModal';

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
          <div className="sec-title">{titleForMode(data.mode, data.today)}</div>
          <div className="sec-sub">{subForMode(data.mode)}</div>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>↻ Refresh</Button>
          <Button variant="primary" size="sm" onClick={handleGenerateWeek} disabled={generating}>
            {generating ? <><Spinner /> Generating…</> : '+ Generate week'}
          </Button>
        </div>
      </div>

      {/* Priority strip is pinned to top on calling days; informational on others. */}
      {(data.mode === 'calling' || hasAnyPriority(data.priorityStrip)) && (
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

      {/* Day-specific view */}
      {data.mode === 'calling' && (
        <SessionsGrid sessions={data.sessions} onOpenSession={onOpenSession} showToast={showToast} onReload={load} />
      )}
      {data.mode === 'prep' && (
        <MondayView showToast={showToast} onReload={load} onSwitchTab={onSwitchTab} />
      )}
      {data.mode === 'review' && (
        <FridayView showToast={showToast} onSwitchTab={onSwitchTab} />
      )}
      {data.mode === 'quiet' && (
        <NonCallingDayView mode={data.mode} sessions={data.sessions} onOpenSession={onOpenSession} />
      )}
    </>
  );
}

// ---------- Title / subtitle helpers ----------

function titleForMode(mode: string, date: string): string {
  const day = new Date(`${date}T12:00:00-06:00`).toLocaleDateString('en-US', { weekday: 'long' });
  if (mode === 'calling') return `${day} — Calling Day`;
  if (mode === 'prep') return `${day} — Week Ahead`;
  if (mode === 'review') return `${day} — Week in Review`;
  return `${day}`;
}

function subForMode(mode: string): string {
  if (mode === 'calling') return 'Priority actions + today\'s sessions. Click a session to start calling.';
  if (mode === 'prep') return 'Plan the week. Sessions for Tue-Thu auto-compose by industry rotation.';
  if (mode === 'review') return 'Last week\'s metrics. Recovery list for callbacks you missed.';
  return 'Quiet day — read-only view.';
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

// ---------- Sessions grid (calling-day view) ----------

interface SessionsGridProps {
  sessions: Session[];
  onOpenSession?: (sessionId: number) => void;
  showToast: ShowToast;
  onReload: () => Promise<void> | void;
}

function SessionsGrid({ sessions, onOpenSession, showToast, onReload }: SessionsGridProps) {
  if (sessions.length === 0) {
    return (
      <div style={{
        marginTop: 16,
        padding: '30px 20px',
        textAlign: 'center',
        color: 'var(--text3)',
        background: 'var(--surface)',
        border: '1px dashed var(--border)',
        borderRadius: 6,
      }}>
        No sessions scheduled for today.
        <div style={{ fontSize: '0.7rem', marginTop: 6 }}>
          Hit <strong>+ Generate week</strong> above to auto-compose Mon-Fri sessions.
        </div>
      </div>
    );
  }
  return (
    <div style={{
      marginTop: 16,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
      gap: 12,
    }}>
      {sessions.map((s) => (
        <SessionCard key={s.id} session={s} onOpen={onOpenSession} showToast={showToast} onReload={onReload} />
      ))}
    </div>
  );
}

interface SessionCardProps {
  session: Session;
  onOpen?: (id: number) => void;
  showToast: ShowToast;
  onReload: () => Promise<void> | void;
}

function SessionCard({ session, onOpen, showToast, onReload }: SessionCardProps) {
  const [busy, setBusy] = useState(false);
  const isActive = session.status === 'active';
  const isPlanned = session.status === 'planned';
  const isComplete = session.status === 'complete';
  const accent = isActive ? 'var(--accent)' : isComplete ? 'var(--green)' : 'var(--border)';

  async function handleStart() {
    setBusy(true);
    try {
      await api.sessions.start(session.id);
      showToast('Session started', 'success');
      await onReload();
      onOpen?.(session.id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not start: ${msg}`, 'error');
    } finally { setBusy(false); }
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${accent}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 6,
      padding: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>
            {sessionTitle(session)}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text3)', marginTop: 2 }}>
            {compositionLine(session)}
          </div>
        </div>
        <SessionStatusBadge status={session.status} />
      </div>
      {!isComplete && !isPlanned && (
        // Progress is per-session-lead but we don't have that in the today
        // payload; for now show a stub. Phase 5 wires real progress via
        // /api/sessions/:id when the execution view opens.
        <div style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text3)' }}>
          Active — click Continue to resume calling.
        </div>
      )}
      <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
        {isPlanned && (
          <Button variant="primary" size="sm" disabled={busy} onClick={handleStart}>
            {busy ? <><Spinner /> Starting…</> : '▶ Start'}
          </Button>
        )}
        {isActive && (
          <Button variant="primary" size="sm" onClick={() => onOpen?.(session.id)}>
            ▶ Continue
          </Button>
        )}
        {isComplete && (
          <Button variant="ghost" size="sm" onClick={() => onOpen?.(session.id)}>
            View recap
          </Button>
        )}
      </div>
    </div>
  );
}

function sessionTitle(s: Session): string {
  return `${s.block === 'morning' ? 'Morning' : 'Evening'} — ${s.industry}`;
}

function compositionLine(s: Session): string {
  const parts = [
    `${s.lead_count_target} leads`,
    `score ${s.score_floor}+`,
  ];
  const geo = safeJsonArray(s.geographic_filter);
  if (geo.length > 0) parts.push(geo.slice(0, 3).join(', ') + (geo.length > 3 ? '…' : ''));
  return parts.join(' · ');
}

function SessionStatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge color="yellow">Active</Badge>;
  if (status === 'complete') return <Badge color="green">Complete</Badge>;
  return <Badge color="gray">Planned</Badge>;
}

// ---------- Non-calling day placeholder views (Mon/Fri/Sat/Sun) ----------

function NonCallingDayView({ mode, sessions, onOpenSession }: { mode: string; sessions: Session[]; onOpenSession?: (id: number) => void }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        padding: '20px 16px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        color: 'var(--text2)',
        fontSize: '0.78rem',
        lineHeight: 1.6,
      }}>
        {mode === 'prep' && <><strong>Prep day.</strong> Week-ahead view + prospecting block land in Phase 7. For now, generate the week above.</>}
        {mode === 'review' && <><strong>Review day.</strong> Week metrics + callback recovery list land in Phase 7.</>}
        {mode === 'quiet' && <><strong>Quiet day.</strong> The next calling week is Tue-Thu. Use this time for fulfillment work.</>}
      </div>

      {sessions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="sec-title" style={{ fontSize: '0.78rem', marginBottom: 8 }}>Sessions for today</div>
          <SessionsGrid sessions={sessions} onOpenSession={onOpenSession} showToast={() => undefined} onReload={() => undefined} />
        </div>
      )}
    </div>
  );
}

// ---------- helpers ----------

function safeJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; }
  catch { return []; }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}
