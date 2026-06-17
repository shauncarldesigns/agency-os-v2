import { useState, useEffect, useCallback } from 'react';
import type { Session, ShowToast, SessionBlock, Tab } from '../../lib/types';
import {
  api, ApiError, industryLabel,
  type DashboardWeekReviewResponse, type WeekDates, type CallbackWithLead, type IndustrySpec,
} from '../../lib/api';
import { Modal, ModalHeader, ModalFooter } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { Badge } from '../shared/Badge';

/**
 * Two non-calling-day views — both pulled together in this file because they
 * share the ProspectingTaskBlock and a lot of layout. Rendered by
 * DashboardPanel when mode = 'prep' (Monday) or 'review' (Friday).
 */

interface MondayViewProps {
  showToast: ShowToast;
  onReload: () => Promise<void> | void;
  onSwitchTab?: (tab: Tab) => void;
}

export function MondayView({ showToast, onReload, onSwitchTab }: MondayViewProps) {
  const [week, setWeek] = useState<WeekDates | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [industries, setIndustries] = useState<IndustrySpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Session | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [w, i] = await Promise.all([
        api.sessions.week(),
        api.dashboard.industries().catch(() => ({ industries: [] as IndustrySpec[] })),
      ]);
      setWeek(w.week);
      setSessions(w.sessions);
      setIndustries(i.industries);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load week ahead: ${msg}`, 'error');
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  if (loading || !week) {
    return <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}><Spinner /> Loading…</div>;
  }

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ProspectingTaskBlock showToast={showToast} onSwitchTab={onSwitchTab} />

      <div className="sec-title" style={{ fontSize: '0.84rem' }}>Week ahead — {week.tuesday} to {week.thursday}</div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text3)', marginTop: -8 }}>
        6 sessions auto-composed by industry rotation. Click Edit on a card to override industry,
        score floor, or city filter before the week starts.
      </div>

      {sessions.length === 0 ? (
        <div style={{
          padding: '24px 20px',
          textAlign: 'center',
          color: 'var(--text3)',
          background: 'var(--surface)',
          border: '1px dashed var(--border)',
          borderRadius: 6,
        }}>
          No sessions for this week yet.
          <div style={{ fontSize: '0.7rem', marginTop: 6 }}>
            Hit <strong>+ Generate week</strong> at the top of the dashboard.
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 12,
        }}>
          {sessions.map((s) => (
            <PlannedSessionCard
              key={s.id}
              session={s}
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
        onSaved={async () => {
          setEditing(null);
          await load();
          await onReload();
        }}
      />
    </div>
  );
}

function PlannedSessionCard({ session, onEdit }: { session: Session; onEdit: () => void }) {
  const isComplete = session.status === 'complete';
  const isActive = session.status === 'active';
  const accent = isActive ? 'var(--accent)' : isComplete ? 'var(--green)' : 'var(--border)';
  const dayLabel = new Date(`${session.session_date}T12:00:00-06:00`).toLocaleDateString('en-US', { weekday: 'long' });
  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${accent}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 6,
      padding: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: '0.62rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {dayLabel} {session.session_date}
          </div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, marginTop: 2 }}>
            {session.block === 'morning' ? 'Morning' : 'Evening'} — {industryLabel(session.industry)}
          </div>
        </div>
        <Badge color={isActive ? 'yellow' : isComplete ? 'green' : 'gray'}>
          {isActive ? 'Active' : isComplete ? 'Complete' : 'Planned'}
        </Badge>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>
        {session.lead_count_target} leads · score {session.score_floor}+
      </div>
      {session.status === 'planned' && (
        <div style={{ marginTop: 10 }}>
          <Button variant="ghost" size="xs" onClick={onEdit}>✎ Edit composition</Button>
        </div>
      )}
    </div>
  );
}

export function SessionEditModal({ open, session, industries, showToast, onClose, onSaved }: {
  open: boolean;
  session: Session | null;
  industries: IndustrySpec[];
  showToast: ShowToast;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [industry, setIndustry] = useState('');
  const [scoreFloor, setScoreFloor] = useState(50);
  const [target, setTarget] = useState(40);
  const [cities, setCities] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    setIndustry(session.industry);
    setScoreFloor(session.score_floor);
    setTarget(session.lead_count_target);
    try {
      const arr = session.geographic_filter ? JSON.parse(session.geographic_filter) : [];
      setCities(Array.isArray(arr) ? arr.join(', ') : '');
    } catch { setCities(''); }
  }, [session]);

  if (!session) return null;

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    try {
      const cityArr = cities.split(',').map((s) => s.trim()).filter(Boolean);
      await api.sessions.update(session.id, {
        industry,
        score_floor: scoreFloor,
        lead_count_target: target,
        geographic_filter: cityArr.length > 0 ? cityArr : null,
      });
      showToast('Session updated', 'success');
      await onSaved();
    } catch (err) {
      showToast(`Update failed: ${(err as Error).message}`, 'error');
    } finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={saving ? () => undefined : onClose} width={460}>
      <ModalHeader title={`Edit · ${session.session_date} ${session.block}`} onClose={onClose} />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Industry">
          <select value={industry} onChange={(e) => setIndustry(e.target.value)} style={selectStyle}>
            {industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
            {!industries.some((i) => i.key === industry) && (
              <option value={industry}>{industryLabel(industry)}</option>
            )}
          </select>
        </Field>
        <Field label="Score floor">
          <input type="number" min={0} max={100} value={scoreFloor}
            onChange={(e) => setScoreFloor(parseInt(e.target.value, 10) || 0)} style={inputStyle} />
        </Field>
        <Field label="Lead count target">
          <input type="number" min={1} max={100} value={target}
            onChange={(e) => setTarget(parseInt(e.target.value, 10) || 40)} style={inputStyle} />
        </Field>
        <Field label="Cities (comma-separated; empty = full service area)">
          <input type="text" value={cities} placeholder="De Pere, Howard, Ashwaubenon"
            onChange={(e) => setCities(e.target.value)} style={inputStyle} />
        </Field>
        <div style={{ fontSize: '0.66rem', color: 'var(--text3)', lineHeight: 1.4 }}>
          Composition runs when the session is started — these settings drive how the
          backend picks the 40 leads. Widening cascade still applies if the strict
          filter doesn't fill.
        </div>
      </div>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <><Spinner /> Saving…</> : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ---------- Friday view ----------

interface FridayViewProps {
  showToast: ShowToast;
  onSwitchTab?: (tab: Tab) => void;
}

export function FridayView({ showToast, onSwitchTab }: FridayViewProps) {
  const [data, setData] = useState<DashboardWeekReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.dashboard.weekReview();
        if (!cancelled) setData(r);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        if (!cancelled) showToast(`Could not load review: ${msg}`, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showToast]);

  if (loading) return <div style={{ padding: 30, textAlign: 'center' }}><Spinner /> Loading…</div>;
  if (!data) return null;

  const m = data.metrics;
  const hasAny = m.totalDials > 0 || m.demosBooked > 0 || data.byIndustry.length > 0;

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ProspectingTaskBlock showToast={showToast} onSwitchTab={onSwitchTab} />

      <div className="sec-title" style={{ fontSize: '0.84rem' }}>Week in review — {data.week.monday} to {data.week.friday}</div>

      {!hasAny ? (
        <div style={{
          padding: '24px 20px',
          textAlign: 'center',
          color: 'var(--text3)',
          background: 'var(--surface)',
          border: '1px dashed var(--border)',
          borderRadius: 6,
        }}>
          No calling activity logged this week. Metrics will populate once you start running sessions.
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
          }}>
            <StatCard label="Total dials" value={m.totalDials} />
            <StatCard label="Demos booked" value={m.demosBooked} accent="green" />
            <StatCard label="Demos held" value={m.demosHeld} accent="green" />
            <StatCard label="No-shows" value={m.demosNoShow} accent="yellow" />
            <StatCard label="Booking rate" value={`${(m.bookingRate * 100).toFixed(1)}%`} accent="accent" />
          </div>

          {data.byIndustry.length > 0 && (
            <div>
              <div className="sec-title" style={{ fontSize: '0.76rem' }}>By industry</div>
              <BookingByIndustry rows={data.byIndustry} />
            </div>
          )}
        </>
      )}

      {data.missedCallbacks.length > 0 && (
        <div>
          <div className="sec-title" style={{ fontSize: '0.76rem' }}>Callback recovery</div>
          <div style={{ fontSize: '0.66rem', color: 'var(--text3)', marginBottom: 6 }}>
            Promised callbacks this week that haven't been completed.
          </div>
          <CallbackRecoveryList items={data.missedCallbacks} showToast={showToast} />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: 'green' | 'yellow' | 'accent' }) {
  const accentMap: Record<NonNullable<typeof accent>, string> = {
    green: 'var(--green)',
    yellow: 'var(--yellow)',
    accent: 'var(--accent)',
  };
  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${accent ? accentMap[accent] : 'var(--border)'}`,
      borderRadius: 4,
    }}>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text3)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 600, color: 'var(--text)', marginTop: 2, fontFamily: 'Bebas Neue, system-ui, sans-serif' }}>{value}</div>
    </div>
  );
}

function BookingByIndustry({ rows }: { rows: Array<{ industry: string; dials: number; booked: number }> }) {
  const maxDials = Math.max(...rows.map((r) => r.dials), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => {
        const rate = r.dials > 0 ? (r.booked / r.dials) * 100 : 0;
        return (
          <div key={r.industry} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 80px', alignItems: 'center', gap: 8, fontSize: '0.74rem' }}>
            <span>{r.industry}</span>
            <div style={{ background: 'var(--surface2)', height: 8, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ background: 'var(--accent)', height: '100%', width: `${(r.dials / maxDials) * 100}%` }} />
            </div>
            <span style={{ color: 'var(--text3)', textAlign: 'right' }}>
              {r.booked} / {r.dials} · {rate.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CallbackRecoveryList({ items, showToast }: { items: CallbackWithLead[]; showToast: ShowToast }) {
  const [completing, setCompleting] = useState<number | null>(null);
  async function markComplete(id: number) {
    setCompleting(id);
    try {
      await api.callbacks.update(id, { status: 'completed' });
      showToast('Marked complete', 'success');
      // Caller can reload; keep it light here.
    } catch (e) {
      showToast(`Failed: ${(e as Error).message}`, 'error');
    } finally { setCompleting(null); }
  }
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
      {items.map((cb, i) => (
        <div key={cb.id} className="priority-row" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: '0.82rem' }}>{cb.company}</strong>
            <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>
              Originally {cb.due_date}{cb.block_hint ? ` · ${cb.block_hint}` : ''}{cb.phone ? ` · ${cb.phone}` : ''}
            </div>
          </div>
          <Button variant="ghost" size="xs" disabled={completing === cb.id} onClick={() => markComplete(cb.id)}>
            {completing === cb.id ? '⏳' : '✓ Mark done'}
          </Button>
        </div>
      ))}
    </div>
  );
}

// ---------- Prospecting task block (shared) ----------

interface ProspectingTaskBlockProps {
  showToast: ShowToast;
  onSwitchTab?: (tab: Tab) => void;
}

export function ProspectingTaskBlock({ onSwitchTab }: ProspectingTaskBlockProps) {
  const [data, setData] = useState<{ count: number; target: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.dashboard.prospectingProgress();
        if (!cancelled) setData({ count: r.count, target: r.target });
      } catch { /* silent — show nothing on failure */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!data) return null;
  const pct = data.target > 0 ? (data.count / data.target) * 100 : 0;
  const done = data.count >= data.target;

  return (
    <div style={{
      padding: '14px 16px',
      background: done ? 'rgba(74,222,128,0.06)' : 'rgba(167,139,250,0.06)',
      border: `1px solid ${done ? 'rgba(74,222,128,0.35)' : 'rgba(167,139,250,0.35)'}`,
      borderRadius: 6,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>
          {done ? '✓ Prospecting target met' : `🔍 Prospect ${data.target} leads this week`}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text3)', marginTop: 2 }}>
          {data.count} / {data.target} prospected this week
        </div>
        <div style={{ marginTop: 6, background: 'var(--surface2)', height: 6, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.min(100, pct)}%`,
            background: done ? 'var(--green)' : '#a78bfa',
          }} />
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={() => onSwitchTab?.('prospect')}>
        Open Prospect tab
      </Button>
    </div>
  );
}

// ---------- helpers ----------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.4px', color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '7px 10px',
  fontSize: '0.78rem',
  color: 'var(--text)',
  fontFamily: 'inherit',
};
const selectStyle: React.CSSProperties = { ...inputStyle };

// Unused SessionBlock import keeps the prop type tight for future block_hint
// editing in the SessionEditModal — referenced via SessionBlock type below.
void ({} as SessionBlock);
