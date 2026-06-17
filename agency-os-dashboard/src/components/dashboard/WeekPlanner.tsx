import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  api, ApiError, industryLabel,
  type SessionWithProgress, type IndustrySpec,
} from '../../lib/api';
import type { Session, ShowToast } from '../../lib/types';
import { Spinner } from '../shared/Spinner';
import { Button } from '../shared/Button';
import { SessionEditModal } from './MondayFridayViews';

/**
 * Week planner — replaces the prior day-of-week-routed sessions grid.
 *
 * Always shows the full calling week (Mon-Fri), so the operator can see
 * past sessions they didn't finish, today's active session, and future
 * planned sessions in one continuous view. If a session from a prior day
 * is still `active` (operator got behind), the WORKING NOW banner at the
 * top surfaces it regardless of date — no more "another active session"
 * errors with no way to reach it.
 *
 * Per-session progress + outcome breakdown comes from the backend's
 * extended /api/sessions/week response (lead_count + called_count + per-
 * outcome counts).
 */

interface WeekPlannerProps {
  showToast: ShowToast;
  onOpenSession?: (sessionId: number) => void;
}

type StatusFilter = 'all' | 'planned' | 'complete';

export function WeekPlanner({ showToast, onOpenSession }: WeekPlannerProps) {
  const [sessions, setSessions] = useState<SessionWithProgress[]>([]);
  const [activeSession, setActiveSession] = useState<SessionWithProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [industries, setIndustries] = useState<IndustrySpec[]>([]);
  const [editing, setEditing] = useState<Session | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [weekRes, industriesRes] = await Promise.all([
        api.sessions.week(),
        api.dashboard.industries(),
      ]);
      setSessions(weekRes.sessions);
      setActiveSession(weekRes.activeSession);
      setIndustries(industriesRes.industries);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load sessions: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return sessions;
    if (filter === 'planned') return sessions.filter((s) => s.status === 'planned');
    return sessions.filter((s) => s.status === 'complete');
  }, [sessions, filter]);

  return (
    <div className="weekplan">
      {activeSession && (
        <WorkingNowBanner session={activeSession} onResume={() => onOpenSession?.(activeSession.id)} />
      )}

      <div className="weekplan-header">
        <h2 className="weekplan-title">All call sessions</h2>
        <div className="weekplan-filters">
          {(['all', 'planned', 'complete'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`weekplan-filter${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'planned' ? 'Planned' : 'Complete'}
            </button>
          ))}
        </div>
      </div>

      {loading && sessions.length === 0 ? (
        <div className="weekplan-loading"><Spinner /> Loading week…</div>
      ) : filtered.length === 0 ? (
        <div className="weekplan-empty">
          {filter === 'all'
            ? <>No sessions for this week yet. Hit <strong>+ Generate week</strong> above to auto-compose Mon-Fri.</>
            : <>No {filter} sessions this week.</>}
        </div>
      ) : (
        <div className="weekplan-grid">
          {filtered.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              showToast={showToast}
              onReload={load}
              onOpen={onOpenSession}
              onEdit={() => setEditing(s)}
            />
          ))}
        </div>
      )}

      <SessionEditModal
        open={editing !== null}
        session={editing}
        industries={industries}
        showToast={showToast}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await load(); }}
      />
    </div>
  );
}

// ============================================================================
// WORKING NOW BANNER
// ============================================================================

function WorkingNowBanner({ session, onResume }: { session: SessionWithProgress; onResume: () => void }) {
  const startedLabel = session.started_at
    ? formatStartedAt(session.started_at)
    : 'Just now';
  const sub = compositionSummary(session);
  return (
    <div className="weekplan-active">
      <div className="weekplan-active-body">
        <div className="weekplan-active-tag">● WORKING NOW</div>
        <div className="weekplan-active-title">{sessionTitle(session)}</div>
        <div className="weekplan-active-sub">
          Started {startedLabel}{sub ? ` · ${sub}` : ''}
        </div>
      </div>
      <Button variant="primary" size="default" onClick={onResume}>Resume session →</Button>
    </div>
  );
}

// ============================================================================
// SESSION CARD (active / planned / complete variants)
// ============================================================================

function SessionCard({
  session, showToast, onReload, onOpen, onEdit,
}: {
  session: SessionWithProgress;
  showToast: ShowToast;
  onReload: () => Promise<void> | void;
  onOpen?: (id: number) => void;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const status = session.status;
  const isActive = status === 'active';
  const isPlanned = status === 'planned';
  const isComplete = status === 'complete';

  const denom = isPlanned && session.lead_count === 0
    ? session.lead_count_target
    : session.lead_count;
  const numer = session.called_count;
  const pct = denom > 0 ? Math.min(100, Math.round((numer / denom) * 100)) : 0;

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
    <div className={`weekplan-card${isActive ? ' is-active' : isComplete ? ' is-complete' : ''}`}>
      <div className="weekplan-card-top">
        <StatusBadge status={status} />
        <span className="weekplan-card-when">{whenLabel(session)}</span>
      </div>
      <div className="weekplan-card-title">{sessionTitle(session)}</div>
      <div className="weekplan-card-sub">{compositionSummary(session)}</div>

      <div className="weekplan-progress">
        <div className={`weekplan-progress-fill ${isComplete ? 'is-complete' : isActive ? 'is-active' : ''}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="weekplan-card-bottom">
        <div className="weekplan-card-stats">
          {isComplete ? (
            <CompleteStats session={session} />
          ) : (
            <span><strong>{numer}</strong> / {denom} called</span>
          )}
        </div>
        <div className="weekplan-card-action">
          {isActive && <button type="button" className="weekplan-card-cta" onClick={() => onOpen?.(session.id)}>Continue →</button>}
          {isPlanned && (
            <>
              <button type="button" className="weekplan-card-cta-ghost" onClick={onEdit}>Edit</button>
              <button type="button" className="weekplan-card-cta" onClick={handleStart} disabled={busy}>
                {busy ? 'Starting…' : 'Start →'}
              </button>
            </>
          )}
          {isComplete && <button type="button" className="weekplan-card-cta-ghost" onClick={() => onOpen?.(session.id)}>View →</button>}
        </div>
      </div>
    </div>
  );
}

function CompleteStats({ session }: { session: SessionWithProgress }) {
  const interestRate = session.called_count > 0
    ? Math.round((session.booked_count / session.called_count) * 100)
    : 0;
  return (
    <>
      <span>{session.called_count} called</span>
      {session.callback_count > 0 && <span> · {session.callback_count} callback{session.callback_count === 1 ? '' : 's'}</span>}
      {session.booked_count > 0 && <span> · {session.booked_count} booked</span>}
      {session.called_count > 0 && <span className="weekplan-rate"> · {interestRate}% booked</span>}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <span className="weekplan-badge weekplan-badge-active">● ACTIVE</span>;
  if (status === 'complete') return <span className="weekplan-badge weekplan-badge-complete">✓ COMPLETE</span>;
  return <span className="weekplan-badge weekplan-badge-planned">◷ PLANNED</span>;
}

// ============================================================================
// HELPERS
// ============================================================================

function sessionTitle(s: Session): string {
  // "Wed · Morning — Plumbers" / "Mon — Electricians" style.
  const dayLabel = new Date(`${s.session_date}T12:00:00-06:00`)
    .toLocaleDateString('en-US', { weekday: 'long' });
  const block = s.block === 'morning' ? 'Morning' : 'Afternoon';
  return `${dayLabel} ${block} — ${industryLabel(s.industry)}`;
}

function compositionSummary(s: SessionWithProgress): string {
  const geo = safeJsonArray(s.geographic_filter);
  const parts: string[] = [];
  if (geo.length > 0) parts.push(geo.slice(0, 3).join(', ') + (geo.length > 3 ? '…' : ''));
  if (geo.length === 0) parts.push(`Score ${s.score_floor}+`);
  return parts.join(' · ');
}

function whenLabel(s: Session): string {
  // Relative tag in the corner of each card. "Today" / "Tomorrow" /
  // "Yesterday" / "Wed Jun 18" etc. Helps when scanning the grid.
  const sessionDate = s.session_date;
  const today = new Date().toISOString().slice(0, 10);
  const tmw = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (sessionDate === today) {
    if (s.status === 'active' && s.started_at) return `Started ${formatStartedAt(s.started_at)}`;
    return `Today ${s.block === 'morning' ? 'AM' : 'PM'}`;
  }
  if (sessionDate === tmw) return `Tomorrow ${s.block === 'morning' ? 'AM' : 'PM'}`;
  if (sessionDate === yest) return 'Yesterday';
  return new Date(`${sessionDate}T12:00:00-06:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatStartedAt(iso: string): string {
  // started_at is stored as UTC string. Render in operator's local time.
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function safeJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
