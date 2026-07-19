import { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  PhoneCall,
  CalendarDays,
  Play,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { api, ApiError, industryLabel, type SessionWithProgress, type WeekDates } from '../../lib/api';
import type { ShowToast } from '../../lib/types';

// ---------------------------------------------------------------------------
// Call Sessions — full past/present/upcoming session browser.
//
// The Dashboard remains "today's snapshot"; this page is the history +
// forward view, paginated by week via the existing /api/sessions/week
// endpoint. Read-mostly: the only action is opening an active session
// (execution view), which routes through the same onOpenSession callback
// the Dashboard uses.
// ---------------------------------------------------------------------------

interface Props {
  showToast: ShowToast;
  onOpenSession: (sessionId: number) => void;
}

// Monday of the week `offset` weeks away from this week, ISO yyyy-mm-dd.
function mondayOf(offsetWeeks: number): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday + offsetWeeks * 7);
  return monday.toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const STATUS_STYLE: Record<string, { label: string; cls: string; icon: typeof Play }> = {
  planned: { label: 'Planned', cls: 'bg-slate-100 text-slate-600', icon: Clock },
  active: { label: 'Active now', cls: 'bg-blue-50 text-blue-700', icon: Play },
  complete: { label: 'Complete', cls: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
};

function SessionCard({
  session,
  onOpen,
}: {
  session: SessionWithProgress;
  onOpen: (id: number) => void;
}) {
  const st = STATUS_STYLE[session.status] ?? STATUS_STYLE.planned;
  const StIcon = st.icon;
  const called = session.called_count ?? 0;
  const total = session.lead_count ?? 0;
  const pct = total > 0 ? Math.round((called / total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {fmtDate(session.session_date)} · {session.block === 'morning' ? 'Morning' : 'Evening'}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">{industryLabel(session.industry)}</div>
        </div>
        <span
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}
        >
          <StIcon className="h-3 w-3" />
          {st.label}
        </span>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
          <span>
            {called}/{total} called
          </span>
          {session.booked_count > 0 && (
            <span className="font-medium text-emerald-600">
              {session.booked_count} booked
            </span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-600"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          {session.voicemail_count ?? 0} vm · {session.callback_count ?? 0} cb ·{' '}
          {session.not_interested_count ?? 0} ni
        </span>
        {session.status === 'active' && (
          <button
            onClick={() => onOpen(session.id)}
            className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm shadow-blue-600/20"
          >
            <Play className="h-3 w-3" />
            Resume
          </button>
        )}
      </div>
    </div>
  );
}

export function CallSessionsPage({ showToast, onOpenSession }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [week, setWeek] = useState<WeekDates | null>(null);
  const [sessions, setSessions] = useState<SessionWithProgress[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.sessions.week(mondayOf(weekOffset));
      setWeek(res.week);
      setSessions(res.sessions);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load sessions';
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [weekOffset, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const weekLabel = week
    ? `${fmtDate(week.monday)} – ${fmtDate(week.friday)}`
    : '…';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Week pager */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <CalendarDays className="h-4 w-4 text-slate-400" />
          {weekLabel}
          {weekOffset === 0 && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
              This week
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekOffset((o) => o - 1)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
            >
              Today
            </button>
          )}
          <button
            onClick={() => setWeekOffset((o) => o + 1)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-12 text-center text-sm text-slate-400">
          Loading sessions…
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-white/50 py-12 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <PhoneCall className="h-6 w-6 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-600">No sessions this week</p>
          <p className="mt-1 text-xs text-slate-400">
            Generate a calling week from the Dashboard to fill this view.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} onOpen={onOpenSession} />
          ))}
        </div>
      )}
    </div>
  );
}
