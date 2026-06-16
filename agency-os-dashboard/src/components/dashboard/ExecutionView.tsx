import { useState, useEffect, useCallback, useRef } from 'react';
import type { Lead, ShowToast, Session, CallOutcome, SessionBlock } from '../../lib/types';
import { api, ApiError, type SessionOutcomeBody } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { Badge } from '../shared/Badge';
import { formatPhone, parseList, stars, googleMapsUrl } from '../../lib/format';

/**
 * Full-screen one-lead-at-a-time execution view.
 *
 * Loaded when the operator clicks Continue/Start on a session card.
 * Pulls /api/sessions/:id/next-lead repeatedly until the session is done,
 * showing the lead's call prep data + outcome buttons.
 *
 * Keyboard shortcuts (baked in from day one — retrofitting later is annoying):
 *   1 = Voicemail
 *   2 = Not interested
 *   3 = Callback (focuses date picker)
 *   4 = Booked demo (triggers booking modal via onBookDemo callback)
 *   S = Skip (no log entry, silent advance)
 *   ← = previous-lead navigation isn't implemented yet (Phase 9 polish)
 *   Esc = close any inline picker
 */

interface ExecutionViewProps {
  sessionId: number;
  showToast: ShowToast;
  /** Closes the execution view + reloads the dashboard. */
  onClose: () => void;
  /** Phase 6 will wire this to open the BookDemoModal. Phase 5 ships a stub
   *  that prompts for a datetime so the outcome can still be recorded. */
  onBookDemo: (
    lead: Lead,
    onConfirm: (scheduledFor: string, honeybookConfirmed: boolean) => Promise<void>,
  ) => void;
}

interface LeadWithSession extends Lead {
  position?: number;
  is_callback?: number;
  session_lead_id?: number;
  // Per-session call outcome (null until operator records something). Comes
  // from the session_leads JOIN in /api/sessions/:id.
  call_outcome?: CallOutcome | null;
  called_at?: string | null;
}

export function ExecutionView({ sessionId, showToast, onClose, onBookDemo }: ExecutionViewProps) {
  const [session, setSession] = useState<Session | null>(null);
  // Full lead list, kept client-side so the operator can navigate
  // forward/backward without re-fetching. currentIndex is the position they're
  // looking at; lead derives from leads[currentIndex].
  const [leads, setLeads] = useState<LeadWithSession[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);

  const lead = leads[currentIndex] ?? null;
  const calledCount = leads.filter((l) => l.call_outcome != null).length;
  const allDone = leads.length > 0 && calledCount === leads.length;

  // Notes textarea state. Drafts persist in localStorage so the operator
  // doesn't lose mid-call typing if the modal closes (browser refresh,
  // session pause, accidental Esc). Keyed by session_lead_id so each lead's
  // notes are independent. Cleared on outcome.
  const [notes, setNotes] = useState('');
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  const draftKey = lead?.session_lead_id ? `exec-notes-${lead.session_lead_id}` : null;
  // Debounced write — 800ms after typing stops.
  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => {
      try {
        if (notes.trim()) localStorage.setItem(draftKey, notes);
        else localStorage.removeItem(draftKey);
      } catch { /* silent */ }
    }, 800);
    return () => clearTimeout(t);
  }, [notes, draftKey]);
  // Clear draft when outcome is recorded.
  const clearDraft = useCallback(() => {
    if (!draftKey) return;
    try { localStorage.removeItem(draftKey); } catch { /* silent */ }
  }, [draftKey]);

  // Inline callback date picker visible state.
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [callbackDate, setCallbackDate] = useState(defaultCallbackDate());
  const [callbackBlock, setCallbackBlock] = useState<SessionBlock>('morning');

  // Pitch card generation state (lazy — operator clicks ↻ to generate).
  const [generatingPitchCard, setGeneratingPitchCard] = useState(false);

  // Full session load — fetches all leads, sets currentIndex to the first
  // uncalled position so the operator naturally starts where they left off
  // even after a refresh. Called on mount and after Extend +20 (the burn-
  // through "extend" path needs fresh data).
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.sessions.get(sessionId);
      setSession(res.session);
      setLeads(res.leads);
      // Park on the first uncalled lead; fall back to position 0 if everyone's
      // already been called (burn-through screen will catch that).
      const firstUncalled = res.leads.findIndex((l) => l.call_outcome == null);
      setCurrentIndex(firstUncalled === -1 ? 0 : firstUncalled);
      setCallbackOpen(false);
      setNotes('');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load execution view: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [sessionId, showToast]);

  useEffect(() => { void load(); }, [load]);

  // Re-seed the notes textarea when the current lead changes (Previous/Next/
  // advance). LocalStorage drafts are keyed by session_lead_id so each lead's
  // notes survive navigation away and back.
  useEffect(() => {
    if (!draftKey) { setNotes(''); return; }
    try {
      const saved = localStorage.getItem(draftKey);
      setNotes(saved ?? '');
    } catch { setNotes(''); }
    setCallbackOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.session_lead_id]);

  // Advance helper: jump to the next uncalled lead AFTER the given index.
  // If none remain forward, wrap to the first uncalled before the index
  // (lets the operator finish the leads they skipped on the way). Returns
  // the new index — caller is responsible for setCurrentIndex.
  const findNextUncalledIndex = useCallback((fromIndex: number): number => {
    const total = leads.length;
    if (total === 0) return 0;
    for (let i = fromIndex + 1; i < total; i++) {
      if (leads[i].call_outcome == null) return i;
    }
    // Wrap — pick up any skipped-earlier uncalled leads from the start.
    for (let i = 0; i <= fromIndex; i++) {
      if (leads[i].call_outcome == null) return i;
    }
    // Nothing uncalled left anywhere. Caller will see allDone === true and
    // render the burn-through screen.
    return total;
  }, [leads]);

  // Record an outcome. Updates the in-memory leads array (so navigation
  // continues to reflect the new state without a full refetch) then advances
  // to the next uncalled position.
  const recordOutcome = useCallback(async (
    outcome: CallOutcome,
    extra: Partial<SessionOutcomeBody> = {},
  ) => {
    if (!lead || recording) return;
    setRecording(true);
    try {
      await api.sessions.outcome(sessionId, {
        leadId: lead.id,
        outcome,
        notes: notesRef.current.trim() || undefined,
        ...extra,
      });
      clearDraft();
      // Mutate the local copy so the NEXT findNextUncalled call sees this
      // outcome and skips past it. Important: spread into a new array so React
      // notices the change.
      const updated = leads.slice();
      updated[currentIndex] = { ...updated[currentIndex], call_outcome: outcome, called_at: new Date().toISOString() };
      setLeads(updated);
      // Compute next index from the UPDATED list (not the closed-over stale one).
      const next = (() => {
        const total = updated.length;
        for (let i = currentIndex + 1; i < total; i++) {
          if (updated[i].call_outcome == null) return i;
        }
        for (let i = 0; i <= currentIndex; i++) {
          if (updated[i].call_outcome == null) return i;
        }
        return total; // → burn-through
      })();
      setCurrentIndex(next);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not record outcome: ${msg}`, 'error');
    } finally {
      setRecording(false);
    }
  }, [lead, sessionId, recording, leads, currentIndex, clearDraft, showToast]);

  // Outcome button handlers.
  const handleVoicemail = useCallback(() => recordOutcome('voicemail'), [recordOutcome]);
  const handleNotInterested = useCallback(() => recordOutcome('not_interested'), [recordOutcome]);
  const handleCallbackToggle = useCallback(() => { setCallbackOpen((v) => !v); }, []);
  const handleCallbackConfirm = useCallback(async () => {
    await recordOutcome('callback', { callbackDate, blockHint: callbackBlock });
    setCallbackOpen(false);
  }, [recordOutcome, callbackDate, callbackBlock]);
  const handleBookedDemo = useCallback(() => {
    if (!lead) return;
    onBookDemo(lead, async (scheduledFor, honeybookConfirmed) => {
      await recordOutcome('booked', { demoData: { scheduledFor, honeybookConfirmed } });
    });
  }, [lead, onBookDemo, recordOutcome]);

  // Navigation handlers — no DB writes, pure index movement. "Skip for now"
  // is just Next that doesn't record an outcome; the lead stays in 'uncalled'
  // state and naturally cycles back via the recordOutcome wrap-around logic.
  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex < leads.length - 1;
  const handlePrevious = useCallback(() => {
    if (canGoBack) setCurrentIndex((i) => i - 1);
  }, [canGoBack]);
  const handleNext = useCallback(() => {
    if (canGoForward) setCurrentIndex((i) => i + 1);
  }, [canGoForward]);
  // Skip-for-now: advances to next uncalled (wraps if at end), matching
  // outcome-button advance semantics. The lead stays uncalled, so subsequent
  // cycles will surface it again.
  const handleSkip = useCallback(() => {
    setCurrentIndex(findNextUncalledIndex(currentIndex));
  }, [findNextUncalledIndex, currentIndex]);

  // Pitch card on-demand generation. Caches on the lead row server-side and
  // also updates the local leads array so navigating away+back shows the
  // freshly-generated text.
  const handleGeneratePitchCard = useCallback(async () => {
    if (!lead || generatingPitchCard) return;
    setGeneratingPitchCard(true);
    try {
      const res = await api.dashboard.generatePitchCard(lead.id);
      const updated = leads.slice();
      updated[currentIndex] = {
        ...updated[currentIndex],
        pitch_card_text: res.pitch_card_text,
        pitch_card_generated_at: res.generated_at,
      };
      setLeads(updated);
      showToast('Pitch card generated', 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not generate: ${msg}`, 'error');
    } finally {
      setGeneratingPitchCard(false);
    }
  }, [lead, generatingPitchCard, showToast, leads, currentIndex]);

  // Keyboard shortcuts:
  //   1-4 = outcomes (unchanged)
  //   ← = Previous (back through positions, sees called + uncalled)
  //   → or S = Next / Skip for now (advance to next uncalled, wraps)
  //   Esc = close callback picker
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (recording || loading) return;
      switch (e.key) {
        case '1': e.preventDefault(); void handleVoicemail(); break;
        case '2': e.preventDefault(); void handleNotInterested(); break;
        case '3': e.preventDefault(); handleCallbackToggle(); break;
        case '4': e.preventDefault(); handleBookedDemo(); break;
        case 's': case 'S': e.preventDefault(); handleSkip(); break;
        case 'ArrowLeft': e.preventDefault(); handlePrevious(); break;
        case 'ArrowRight': e.preventDefault(); handleNext(); break;
        case 'Escape': e.preventDefault(); setCallbackOpen(false); break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording, loading, handleVoicemail, handleNotInterested, handleCallbackToggle, handleBookedDemo, handleSkip, handlePrevious, handleNext]);

  if (loading) {
    return (
      <div className="exec-overlay">
        <div className="exec-modal">
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
            <Spinner /> Loading session…
          </div>
        </div>
      </div>
    );
  }

  if (allDone || !lead) {
    return (
      <div className="exec-overlay">
        <div className="exec-modal" style={{ width: 540 }}>
          <BurnThroughComplete
            sessionId={sessionId}
            progress={{ total: leads.length, called: calledCount }}
            showToast={showToast}
            onExtend={async (count) => {
              const r = await api.sessions.extend(sessionId, count);
              showToast(
                `Added ${r.added} leads${r.widened.length > 0 ? ` (widened: ${r.widened.length} step${r.widened.length === 1 ? '' : 's'})` : ''}`,
                'success'
              );
              await load();
            }}
            onWrap={async () => {
              await api.sessions.complete(sessionId);
              showToast('Session complete', 'success');
              onClose();
            }}
            onJumpNext={() => {
              // Phase 9 polish: actually navigate to the next block. For now,
              // just close and bounce back to the dashboard.
              showToast('Jump-to-next ships in Phase 9 polish — wrap this session and click the next card.', 'default');
              onClose();
            }}
          />
        </div>
      </div>
    );
  }

  const reviewCount = lead.google_review_count ?? 0;
  const rating = lead.google_rating;
  const tier = lead.recommended_tier as 1 | 2 | 3 | null;

  return (
    <div className="exec-overlay">
      <div className="exec-modal" style={{ width: 760, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface2)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {session ? `${session.industry} · ${session.block}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ProgressDashes total={leads.length} called={calledCount} currentIndex={currentIndex} />
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', color: 'var(--text3)', fontSize: '1.2rem', cursor: 'pointer', padding: '2px 8px' }}
              title="Close (pauses session)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1 }}>
          {/* Company header */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text)' }}>{lead.company}</h2>
              {lead.is_callback === 1 && <Badge color="yellow">Callback</Badge>}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text3)', marginTop: 4 }}>
              {[lead.city, lead.state].filter(Boolean).join(', ')}
              {lead.website && (
                <>
                  {' · '}
                  <a href={normalizeUrl(lead.website)} target="_blank" rel="noreferrer" style={{ color: 'var(--text2)' }}>
                    {cleanDomain(lead.website)} ↗
                  </a>
                </>
              )}
              {lead.phone && (
                <>
                  {' · '}
                  <a href={`tel:${lead.phone}`} style={{ color: 'var(--text2)', fontFamily: 'ui-monospace,monospace' }}>
                    {formatPhone(lead.phone)}
                  </a>
                </>
              )}
              {(() => {
                // Google Maps link — operator wanted access to the GBP listing
                // mid-call for quick research (services, hours, reviews scroll,
                // photos). Uses place_id when present so it resolves to the
                // exact business, not a generic search.
                const maps = googleMapsUrl(lead);
                if (!maps) return null;
                return (
                  <>
                    {' · '}
                    <a href={maps} target="_blank" rel="noreferrer" style={{ color: 'var(--text2)' }}>
                      🗺️ Maps ↗
                    </a>
                  </>
                );
              })()}
              {lead.contact && ` · ${lead.contact}`}
            </div>
          </div>

          {/* Score cards row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <ScoreCard
              label="GBP"
              value={reviewCount > 0 ? `${reviewCount} reviews` : '— no reviews'}
              sub={rating != null ? `${rating.toFixed(1)}★ ${stars(rating)}` : (lead.gbp_claimed === 0 ? 'Unclaimed' : '')}
              accent={lead.gbp_claimed === 0 ? 'red' : reviewCount >= 20 ? 'green' : 'gray'}
            />
            <ScoreCard
              label="Website"
              value={lead.website ? `PSI ${lead.pagespeed_mobile ?? '?'}` : 'No site'}
              sub={lead.opportunity_score != null ? `Score ${lead.opportunity_score}${tier ? ` · Tier ${tier}` : ''}` : ''}
              accent={!lead.website ? 'red' : (lead.pagespeed_mobile ?? 100) < 50 ? 'yellow' : 'green'}
            />
          </div>

          {/* Pitch card */}
          <PitchCard
            text={lead.pitch_card_text}
            generatedAt={lead.pitch_card_generated_at}
            onRegenerate={handleGeneratePitchCard}
            busy={generatingPitchCard}
          />

          {/* Signals */}
          <SignalsList lead={lead} />

          {/* Notes textarea */}
          <div style={{ marginTop: 12 }}>
            <div style={labelStyle}>Call notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything noteworthy from the call (saved on outcome)…"
              rows={3}
              style={{
                width: '100%',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: 8,
                fontSize: '0.76rem',
                color: 'var(--text)',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Inline callback picker (visible on outcome=3) */}
          {callbackOpen && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(245,200,66,0.06)', border: '1px solid rgba(245,200,66,0.3)', borderRadius: 6 }}>
              <div style={labelStyle}>Callback date</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="date"
                  value={callbackDate}
                  onChange={(e) => setCallbackDate(e.target.value)}
                  style={{ padding: '6px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontFamily: 'inherit' }}
                />
                <select
                  value={callbackBlock}
                  onChange={(e) => setCallbackBlock(e.target.value as SessionBlock)}
                  style={{ padding: '6px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}
                >
                  <option value="morning">Morning</option>
                  <option value="evening">Evening</option>
                </select>
                <Button variant="primary" size="sm" disabled={recording} onClick={handleCallbackConfirm}>
                  Confirm callback
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCallbackOpen(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>

        {/* Outcome buttons + nav row (fixed bottom). Skip is no longer an
            outcome — it lives in NavRow now and just advances without writing. */}
        <OutcomeButtons
          recording={recording}
          onVoicemail={handleVoicemail}
          onNotInterested={handleNotInterested}
          onCallback={handleCallbackToggle}
          onBooked={handleBookedDemo}
        />
        <NavRow
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          recording={recording}
          onPrevious={handlePrevious}
          onSkip={handleSkip}
          onNext={handleNext}
        />
      </div>
    </div>
  );
}

// ---------- sub-components ----------

function ProgressDashes({ total, called, currentIndex }: { total: number; called: number; currentIndex: number }) {
  // "N of M" reflects the operator's current position, not just called count
  // (since Previous/Next navigation can put them on any position regardless
  // of outcome state). Dashes light up for any lead with an outcome.
  const visible = Math.min(total, 40);
  if (visible === 0) return <span style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>0 / 0</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>
        {currentIndex + 1} of {total}
        <span style={{ marginLeft: 6, opacity: 0.7 }}>· {called} called</span>
      </span>
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: visible }).map((_, i) => {
          // Three visual states: current position (filled accent w/ ring),
          // called (filled accent), uncalled (border).
          const isCurrent = i === currentIndex;
          const isCalled = i < currentIndex; // approximation — see note below
          return (
            <span
              key={i}
              style={{
                width: isCurrent ? 9 : 7,
                height: isCurrent ? 5 : 3,
                background: isCalled ? 'var(--accent)' : 'var(--border)',
                outline: isCurrent ? '1px solid var(--accent)' : undefined,
                outlineOffset: isCurrent ? 1 : 0,
                transition: 'all 80ms',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ScoreCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: 'green' | 'yellow' | 'red' | 'gray' }) {
  const colorMap = {
    green: 'rgba(74,222,128,0.4)',
    yellow: 'rgba(245,200,66,0.4)',
    red: 'rgba(248,113,113,0.4)',
    gray: 'var(--border)',
  };
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--surface2)',
      border: `1px solid ${colorMap[accent]}`,
      borderLeft: `3px solid ${colorMap[accent]}`,
      borderRadius: 4,
    }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.66rem', color: 'var(--text3)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function PitchCard({ text, generatedAt, onRegenerate, busy }: { text: string | null; generatedAt: string | null; onRegenerate: () => void; busy: boolean }) {
  return (
    <div style={{
      marginTop: 12,
      padding: '12px 14px',
      background: 'rgba(167,139,250,0.06)',
      border: '1px solid rgba(167,139,250,0.3)',
      borderRadius: 6,
      position: 'relative',
    }}>
      <div style={{ ...labelStyle, color: '#a78bfa', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>💎 Pitch card</span>
        <button
          onClick={onRegenerate}
          disabled={busy}
          style={{
            background: 'transparent',
            border: '1px solid rgba(167,139,250,0.4)',
            color: '#a78bfa',
            borderRadius: 3,
            padding: '2px 8px',
            fontSize: '0.62rem',
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.5 : 1,
            textTransform: 'none',
            letterSpacing: 0,
          }}
        >
          {busy ? '…' : (text ? '↻ Regenerate' : '✦ Generate')}
        </button>
      </div>
      {text ? (
        <>
          <div style={{ fontSize: '0.84rem', color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {text}
          </div>
          {generatedAt && (
            <div style={{ fontSize: '0.6rem', color: 'var(--text3)', marginTop: 6 }}>
              Generated {new Date(generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: '0.74rem', color: 'var(--text3)', fontStyle: 'italic' }}>
          Not generated yet. Click <strong>✦ Generate</strong> for a 2-3 sentence pre-call script.
        </div>
      )}
    </div>
  );
}

function SignalsList({ lead }: { lead: Lead }) {
  const signals: Array<{ text: string; severity: 'high' | 'normal' }> = [];

  if (lead.gbp_claimed === 0) {
    signals.push({ text: 'Unclaimed Google Business Profile', severity: 'high' });
  }
  if (!lead.website) {
    signals.push({ text: 'No website', severity: 'high' });
  } else if (lead.pagespeed_mobile != null) {
    signals.push({ text: `Mobile PageSpeed ${lead.pagespeed_mobile}/100`, severity: lead.pagespeed_mobile < 50 ? 'high' : 'normal' });
  }
  if (lead.gbp_photos_count != null && lead.gbp_photos_count < 5) {
    signals.push({ text: `Only ${lead.gbp_photos_count} GBP photos`, severity: 'normal' });
  }
  const owners = parseList<string>(lead.owner_names);
  if (owners.length > 0) {
    signals.push({ text: `Owner: ${owners[0]}`, severity: 'normal' });
  }
  if (lead.google_review_count != null && lead.google_review_count > 0 && lead.google_rating != null) {
    signals.push({ text: `${lead.google_review_count} reviews · ${lead.google_rating.toFixed(1)}★`, severity: 'normal' });
  }

  if (signals.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={labelStyle}>📡 Signals</div>
      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
        {signals.map((s, i) => (
          <li key={i} style={{
            padding: '4px 0',
            fontSize: '0.76rem',
            color: s.severity === 'high' ? 'var(--text)' : 'var(--text2)',
            fontWeight: s.severity === 'high' ? 600 : 400,
          }}>
            • {s.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface OutcomeButtonsProps {
  recording: boolean;
  onVoicemail: () => void;
  onNotInterested: () => void;
  onCallback: () => void;
  onBooked: () => void;
}

function OutcomeButtons({ recording, onVoicemail, onNotInterested, onCallback, onBooked }: OutcomeButtonsProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 8,
      padding: '12px 18px',
      borderTop: '1px solid var(--border)',
      background: 'var(--surface2)',
    }}>
      <OutcomeBtn label="Voicemail" sub="1" onClick={onVoicemail} disabled={recording} />
      <OutcomeBtn label="Not interested" sub="2" onClick={onNotInterested} disabled={recording} accent="red" />
      <OutcomeBtn label="Callback" sub="3" onClick={onCallback} disabled={recording} accent="yellow" />
      <OutcomeBtn label="Booked demo" sub="4" onClick={onBooked} disabled={recording} accent="green" />
    </div>
  );
}

// Nav row — sits below outcome buttons. None of these write to the DB.
// Previous walks back through positions (sees called + uncalled).
// Skip-for-now advances to the next uncalled lead, wrapping if at the end so
// skipped leads naturally come back around.
// Next advances one position regardless of outcome state.
interface NavRowProps {
  canGoBack: boolean;
  canGoForward: boolean;
  recording: boolean;
  onPrevious: () => void;
  onSkip: () => void;
  onNext: () => void;
}
function NavRow({ canGoBack, canGoForward, recording, onPrevious, onSkip, onNext }: NavRowProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      padding: '8px 18px 12px',
      borderTop: '1px solid var(--border)',
      background: 'var(--surface2)',
      gap: 6,
    }}>
      <NavBtn label="← Previous" sub="←" onClick={onPrevious} disabled={recording || !canGoBack} align="left" />
      <NavBtn label="Skip for now" sub="S" onClick={onSkip} disabled={recording} align="center" />
      <NavBtn label="Next →" sub="→" onClick={onNext} disabled={recording || !canGoForward} align="right" />
    </div>
  );
}

function NavBtn({ label, sub, onClick, disabled, align }: {
  label: string; sub: string; onClick: () => void; disabled: boolean; align: 'left' | 'center' | 'right';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '5px 10px',
        background: 'transparent',
        border: 'none',
        color: 'var(--text3)',
        fontSize: '0.7rem',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'inherit',
        textAlign: align,
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
      }}
    >
      <span>{label}</span>
      <span style={{ fontSize: '0.55rem', opacity: 0.6, marginTop: 1 }}>[{sub}]</span>
    </button>
  );
}

function OutcomeBtn({ label, sub, onClick, disabled, accent, ghost }: {
  label: string; sub: string; onClick: () => void; disabled: boolean;
  accent?: 'red' | 'yellow' | 'green'; ghost?: boolean;
}) {
  const colors: Record<NonNullable<typeof accent>, { bg: string; border: string; color: string }> = {
    red: { bg: 'transparent', border: 'rgba(248,113,113,0.5)', color: 'var(--red)' },
    yellow: { bg: 'transparent', border: 'rgba(245,200,66,0.5)', color: 'var(--yellow)' },
    green: { bg: 'var(--green)', border: 'var(--green)', color: 'white' },
  };
  const style = accent ? colors[accent] : { bg: 'var(--surface)', border: 'var(--border)', color: 'var(--text)' };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: ghost ? '7px 12px' : '10px 12px',
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 4,
        color: style.color,
        fontSize: ghost ? '0.7rem' : '0.78rem',
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <span>{label}</span>
      <span style={{ fontSize: '0.6rem', opacity: 0.6, fontWeight: 400 }}>[{sub}]</span>
    </button>
  );
}

function BurnThroughComplete({
  sessionId, progress, onExtend, onWrap, onJumpNext, showToast,
}: {
  sessionId: number;
  progress: { total: number; called: number };
  showToast: ShowToast;
  onExtend: (count: number) => Promise<void>;
  onWrap: () => Promise<void>;
  onJumpNext: () => void;
}) {
  const [busy, setBusy] = useState<'extend' | 'wrap' | null>(null);

  async function handleExtend() {
    setBusy('extend');
    try { await onExtend(20); } catch (e) { showToast(`Extend failed: ${(e as Error).message}`, 'error'); }
    finally { setBusy(null); }
  }
  async function handleWrap() {
    setBusy('wrap');
    try { await onWrap(); } catch (e) { showToast(`Wrap failed: ${(e as Error).message}`, 'error'); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '24px 22px' }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 6 }}>
        ✓ Session burned through
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginBottom: 18 }}>
        {progress.called} / {progress.total} dialed in session {sessionId}. Three options:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button variant="primary" size="sm" onClick={handleExtend} disabled={busy !== null}>
          {busy === 'extend' ? <><Spinner /> Extending…</> : '+ Extend +20 (keep going)'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onJumpNext} disabled={busy !== null}>
          ▶ Jump to next block
        </Button>
        <Button variant="ghost" size="sm" onClick={handleWrap} disabled={busy !== null}>
          {busy === 'wrap' ? <><Spinner /> Wrapping…</> : '✓ Wrap & log'}
        </Button>
      </div>
    </div>
  );
}

// ---------- helpers ----------

const labelStyle: React.CSSProperties = {
  fontSize: '0.6rem',
  fontWeight: 700,
  letterSpacing: '0.5px',
  color: 'var(--text3)',
  textTransform: 'uppercase',
};

function defaultCallbackDate(): string {
  // 3 days out per spec default.
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
}

function normalizeUrl(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`;
}

function cleanDomain(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '');
}
