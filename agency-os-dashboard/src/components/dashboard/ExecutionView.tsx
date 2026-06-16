import { useState, useEffect, useCallback, useRef } from 'react';
import type { Lead, ShowToast, Session, CallOutcome, SessionBlock, CallEntry } from '../../lib/types';
import { api, ApiError, type SessionOutcomeBody } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { Badge } from '../shared/Badge';
import { formatPhone, parseList, googleMapsUrl } from '../../lib/format';
import { BookingPane } from './BookingPane';

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

// Log-a-call outcome dropdown options. Mirrors the Pipeline LeadModal's
// CallLogTab so call_log entries are consistent across surfaces. The 4
// session-action outcomes (voicemail/not_interested/callback/booked)
// remain distinct because they drive session_leads state — not part of
// this dropdown.
const LOG_OUTCOMES = [
  'No Answer',
  'Voicemail Left',
  'Spoke with Owner',
  'Spoke with Gatekeeper',
  'Callback Requested',
  'Not Interested',
  'Interested',
  'Qualified for Tier',
];

export function ExecutionView({ sessionId, showToast, onClose }: ExecutionViewProps) {
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

  // Booking-mode flag — when true, the main column swaps to the BookingPane
  // (split-pane HoneyBook embed + copy fields). Stays true until the operator
  // either confirms (advances) or cancels (back to outcome buttons). Auto-
  // resets when the lead changes so it doesn't leak across Previous/Next.
  const [bookingMode, setBookingMode] = useState(false);

  // Log-a-call form state. Outcome dropdown defaults to "Spoke with Owner" —
  // the richest path. Follow-up date is optional. Notes is the same textarea
  // the outcome buttons also pull from, so the operator can type once and
  // either Save Call Entry (just log) OR click an outcome button (log +
  // advance + drive session state).
  const [logOutcome, setLogOutcome] = useState(LOG_OUTCOMES[2]);
  const [logFollowup, setLogFollowup] = useState('');
  const [savingCall, setSavingCall] = useState(false);
  // Incremented each time a call entry is saved so the sidebar PriorCalls
  // card knows to refetch. Cheap pattern — no need for context or events.
  const [priorCallsRefresh, setPriorCallsRefresh] = useState(0);

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
  // notes survive navigation away and back. Also resets bookingMode, the
  // callback picker, and the log-a-call form fields so none leak across
  // navigation.
  useEffect(() => {
    if (!draftKey) { setNotes(''); return; }
    try {
      const saved = localStorage.getItem(draftKey);
      setNotes(saved ?? '');
    } catch { setNotes(''); }
    setCallbackOpen(false);
    setBookingMode(false);
    setLogOutcome(LOG_OUTCOMES[2]);
    setLogFollowup('');
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
  // Save Call Entry — writes a call_log row WITHOUT advancing or driving any
  // session_leads state. Used for richer in-between captures ("spoke with
  // receptionist, owner out till Thursday") that don't fit the 4 quick
  // outcome buttons. Operator can still click an outcome button afterward to
  // formally advance.
  const handleSaveCallEntry = useCallback(async () => {
    if (!lead || savingCall) return;
    if (!notesRef.current.trim()) {
      showToast('Add some notes before saving', 'error');
      return;
    }
    setSavingCall(true);
    try {
      await api.calls.create(lead.id, {
        outcome: logOutcome,
        notes: notesRef.current.trim(),
        followup_date: logFollowup || null,
      });
      clearDraft();
      setNotes('');
      setLogFollowup('');
      setPriorCallsRefresh((n) => n + 1);
      showToast('Call logged', 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Save failed: ${msg}`, 'error');
    } finally {
      setSavingCall(false);
    }
  }, [lead, savingCall, logOutcome, logFollowup, clearDraft, showToast]);

  // Booked demo opens the inline BookingPane. recordOutcome happens when the
  // operator hits "Mark booked & advance" inside the pane.
  const handleBookedDemo = useCallback(() => {
    if (!lead) return;
    setBookingMode(true);
  }, [lead]);
  const handleBookingConfirm = useCallback(async (scheduledFor: string, honeybookConfirmed: boolean) => {
    await recordOutcome('booked', { demoData: { scheduledFor, honeybookConfirmed } });
    // bookingMode auto-clears via the lead-change effect when recordOutcome
    // advances to the next lead. No explicit reset needed.
  }, [recordOutcome]);

  // Navigation handlers — no DB writes, pure index movement. "Skip for now"
  // is just Next that doesn't record an outcome; the lead stays in 'uncalled'
  // state and naturally cycles back via the recordOutcome wrap-around logic.
  const canGoBack = currentIndex > 0;
  const handlePrevious = useCallback(() => {
    if (canGoBack) setCurrentIndex((i) => i - 1);
  }, [canGoBack]);
  // Skip-for-now: advances to next uncalled (wraps if at end), matching
  // outcome-button advance semantics. The lead stays uncalled, so subsequent
  // cycles will surface it again. This replaces the old generic "Next" —
  // they overlapped enough that two buttons just confused the operator.
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
        case 's': case 'S': case 'ArrowRight': e.preventDefault(); handleSkip(); break;
        case 'ArrowLeft': e.preventDefault(); handlePrevious(); break;
        case 'Escape': e.preventDefault(); setCallbackOpen(false); break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording, loading, handleVoicemail, handleNotInterested, handleCallbackToggle, handleBookedDemo, handleSkip, handlePrevious]);

  if (loading) {
    return (
      <div className="exec-page">
        <div className="exec-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
          <Spinner /> Loading session…
        </div>
      </div>
    );
  }

  if (allDone || !lead) {
    return (
      <div className="exec-page">
        <div className="exec-card" style={{ width: 540 }}>
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
    <div className="exec-page">
      {/* Topbar — Brief-Studio style. Always visible above the 2-col layout. */}
      <div className="bs-topbar">
        <div>
          <button type="button" className="bs-back" onClick={onClose}>← Exit session</button>
          <div className="bs-breadcrumb">
            {session ? `${session.session_date} · ${session.block === 'morning' ? 'Morning' : 'Evening'}` : ''}
          </div>
          <h1 className="bs-title">{lead.company}</h1>
        </div>
        <div className="bs-topbar-meta">
          {lead.is_callback === 1 && <Badge color="yellow">Callback</Badge>}
          <ProgressDashes total={leads.length} called={calledCount} currentIndex={currentIndex} />
        </div>
      </div>

      {/* Sub-header — contact info strip under the title. Kept outside the
          2-col layout so it spans the full width and reads like a top-of-page
          contact card. */}
      <div style={{
        fontSize: '0.78rem', color: 'var(--text3)',
        padding: '0 0 14px',
        display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
      }}>
        <span>{[lead.city, lead.state].filter(Boolean).join(', ') || '—'}</span>
        {lead.phone && (
          <a href={`tel:${lead.phone}`} style={{ color: 'var(--text)', fontFamily: 'ui-monospace,monospace' }}>
            📞 {formatPhone(lead.phone)}
          </a>
        )}
        {lead.website && (
          <a href={normalizeUrl(lead.website)} target="_blank" rel="noreferrer" style={{ color: 'var(--text2)' }}>
            🌐 {cleanDomain(lead.website)} ↗
          </a>
        )}
        {(() => {
          const maps = googleMapsUrl(lead);
          if (!maps) return null;
          return (
            <a href={maps} target="_blank" rel="noreferrer" style={{ color: 'var(--text2)' }}>
              🗺️ Maps ↗
            </a>
          );
        })()}
        {lead.email && (
          <a href={`mailto:${lead.email}`} style={{ color: 'var(--text2)' }}>
            ✉ {lead.email}
          </a>
        )}
        {lead.contact && <span>👤 {lead.contact}</span>}
      </div>

      {/* Two-column body, Brief Studio classes. */}
      <div className="bs-layout">
        <main className="bs-main">
          {bookingMode ? (
            <BookingPane
              lead={lead}
              showToast={showToast}
              onConfirm={handleBookingConfirm}
              onCancel={() => setBookingMode(false)}
            />
          ) : (
            <>
              {/* Pitch card */}
              <PitchCard
                text={lead.pitch_card_text}
                generatedAt={lead.pitch_card_generated_at}
                onRegenerate={handleGeneratePitchCard}
                busy={generatingPitchCard}
              />

              {/* Log a Call form — capture detailed notes + optional follow-up.
                  Save Call Entry just writes call_log without advancing. The
                  outcome buttons below will use the same notes + advance + drive
                  session state. */}
              <LogACallCard
                outcome={logOutcome}
                setOutcome={setLogOutcome}
                followup={logFollowup}
                setFollowup={setLogFollowup}
                notes={notes}
                setNotes={setNotes}
                saving={savingCall}
                onClear={() => { setNotes(''); setLogFollowup(''); }}
                onSave={handleSaveCallEntry}
              />

              {/* Inline callback picker (visible on outcome=3) */}
              {callbackOpen && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(245,200,66,0.06)', border: '1px solid rgba(245,200,66,0.3)', borderRadius: 6 }}>
                  <div style={labelStyle}>Callback date</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
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

              {/* Outcome buttons — inline at the end of the workflow */}
              <div style={{ marginTop: 16 }}>
                <OutcomeButtons
                  recording={recording}
                  onVoicemail={handleVoicemail}
                  onNotInterested={handleNotInterested}
                  onCallback={handleCallbackToggle}
                  onBooked={handleBookedDemo}
                />
              </div>

              {/* Nav row — only when not booking */}
              <NavRow
                canGoBack={canGoBack}
                recording={recording}
                onPrevious={handlePrevious}
                onSkip={handleSkip}
              />
            </>
          )}
        </main>

        {/* Right sidebar — reference material. Same Brief Studio card pattern
            so it feels consistent across the app. */}
        <aside className="bs-sidebar">
          <ScoreSidebarCard lead={lead} reviewCount={reviewCount} rating={rating} tier={tier} />
          <SignalsSidebarCard lead={lead} />
          <PriorCallsSidebarCard leadId={lead.id} refreshKey={priorCallsRefresh} key={lead.id} />
        </aside>
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

// ============================================================================
// Sidebar cards — Brief Studio styled, reference material that updates as the
// operator navigates between leads. None of these allow editing; pure read.
// ============================================================================

function ScoreSidebarCard({ lead, reviewCount, rating, tier }: {
  lead: Lead;
  reviewCount: number;
  rating: number | null;
  tier: 1 | 2 | 3 | null;
}) {
  return (
    <div className="bs-side-card">
      <div className="bs-side-title">Scores</div>
      <div className="bs-side-row bs-side-row-status">
        <span>Reviews</span>
        <span className={reviewCount > 0 ? 'bs-side-status-ok' : 'bs-side-status-na'}>
          {reviewCount > 0 ? `${reviewCount}${rating != null ? ` · ${rating.toFixed(1)}★` : ''}` : '— none'}
        </span>
      </div>
      <div className="bs-side-row bs-side-row-status">
        <span>GBP</span>
        <span className={lead.gbp_claimed === 1 ? 'bs-side-status-ok' : 'bs-side-status-na'}>
          {lead.gbp_claimed === 1 ? '✓ Claimed' : '⚠ Unclaimed'}
        </span>
      </div>
      <div className="bs-side-row bs-side-row-status">
        <span>Website</span>
        <span className={lead.website ? 'bs-side-status-ok' : 'bs-side-status-na'}>
          {lead.website ? `PSI ${lead.pagespeed_mobile ?? '?'}` : '— none'}
        </span>
      </div>
      <div className="bs-side-row bs-side-row-status">
        <span>Opportunity</span>
        <span className="bs-side-status-ok">
          {lead.opportunity_score != null ? lead.opportunity_score : '—'}
          {tier ? ` · Tier ${tier}` : ''}
        </span>
      </div>
    </div>
  );
}

function SignalsSidebarCard({ lead }: { lead: Lead }) {
  const signals: Array<{ text: string; severity: 'high' | 'normal' }> = [];
  if (lead.gbp_claimed === 0) signals.push({ text: 'Unclaimed GBP', severity: 'high' });
  if (!lead.website) signals.push({ text: 'No website', severity: 'high' });
  else if (lead.pagespeed_mobile != null) {
    signals.push({ text: `Mobile PSI ${lead.pagespeed_mobile}`, severity: lead.pagespeed_mobile < 50 ? 'high' : 'normal' });
  }
  if (lead.gbp_photos_count != null && lead.gbp_photos_count < 5) {
    signals.push({ text: `${lead.gbp_photos_count} GBP photos`, severity: 'normal' });
  }
  const owners = parseList<string>(lead.owner_names);
  if (owners.length > 0) signals.push({ text: `Owner: ${owners[0]}`, severity: 'normal' });

  if (signals.length === 0) {
    return (
      <div className="bs-side-card">
        <div className="bs-side-title">Signals</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text3)', padding: '6px 0' }}>
          No flagged signals.
        </div>
      </div>
    );
  }
  return (
    <div className="bs-side-card">
      <div className="bs-side-title">Signals</div>
      {signals.map((s, i) => (
        <div key={i} className="bs-side-row" style={{
          color: s.severity === 'high' ? 'var(--text)' : 'var(--text2)',
          fontWeight: s.severity === 'high' ? 600 : 400,
        }}>
          • {s.text}
        </div>
      ))}
    </div>
  );
}

function PriorCallsSidebarCard({ leadId, refreshKey = 0 }: { leadId: number; refreshKey?: number }) {
  // Inline render of the call history in sidebar-card style. Lazy-loads on
  // first mount per lead (key={lead.id} at the call site resets this).
  // refreshKey is bumped by the parent after a Save Call Entry so the list
  // refetches without needing a manual reload.
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [calls, setCalls] = useState<CallEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load count eagerly so the sidebar title can show "(N)" without a click.
  // Re-fetches when leadId or refreshKey change.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    api.leads.get(leadId)
      .then((res) => { if (!cancelled) setCalls(res.calls); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : (err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [leadId, refreshKey]);

  const count = calls?.length ?? 0;
  const hasAny = count > 0;

  return (
    <div className="bs-side-card">
      <div className="bs-side-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Prior calls{calls != null ? ` (${count})` : ''}</span>
        {hasAny && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text2)',
              cursor: 'pointer', fontSize: '0.66rem', padding: '0 4px',
              fontFamily: 'inherit', textTransform: 'none', letterSpacing: 0,
            }}
          >
            {expanded ? '▾ Hide' : '▸ Show'}
          </button>
        )}
      </div>

      {loading && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text3)', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Spinner /> Loading…
        </div>
      )}

      {!loading && error && (
        <div style={{ fontSize: '0.68rem', color: 'var(--red)', padding: '6px 0' }}>
          {error}
        </div>
      )}

      {!loading && !error && !hasAny && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text3)', padding: '6px 0', fontStyle: 'italic' }}>
          No prior calls logged.
        </div>
      )}

      {!loading && !error && hasAny && expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, maxHeight: 320, overflowY: 'auto' }}>
          {/* Newest first — backend returns ORDER BY created_at DESC. */}
          {calls!.map((c) => (
            <div key={c.id} style={{
              padding: '7px 9px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: '0.72rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                <span style={{ fontWeight: 600 }}>{c.outcome}</span>
                <span style={{ color: 'var(--text3)', fontSize: '0.64rem' }}>{formatCallTimestamp(c.created_at)}</span>
              </div>
              {c.notes && (
                <div style={{ color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                  {c.notes}
                </div>
              )}
              {c.followup_date && (
                <div style={{ color: 'var(--text3)', fontSize: '0.64rem', marginTop: 3 }}>
                  Followup: {c.followup_date}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// "Log a Call" form — flexible call-entry capture inside the execution view.
// Mirrors the Pipeline LeadModal's CallLogTab look (orange-tinted header bar,
// outcome dropdown + follow-up date row, free-form notes). Two save paths:
//   1. "Save Call Entry" button — just writes call_log, doesn't advance
//   2. Outcome buttons below — write call_log AND advance + drive session state
// Both share the notes textarea, so the operator types once and picks an
// action.
interface LogACallCardProps {
  outcome: string;
  setOutcome: (v: string) => void;
  followup: string;
  setFollowup: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  saving: boolean;
  onClear: () => void;
  onSave: () => void;
}

function LogACallCard({
  outcome, setOutcome, followup, setFollowup, notes, setNotes, saving, onClear, onSave,
}: LogACallCardProps) {
  const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return (
    <div style={{
      marginTop: 14,
      padding: '14px 16px',
      background: 'rgba(255,107,43,0.06)',
      border: '1px solid rgba(255,107,43,0.25)',
      borderRadius: 8,
    }}>
      {/* Header strip */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--accent)' }}>
          📞 Log a call
        </div>
        <div style={{ fontSize: '0.62rem', color: 'var(--text3)' }}>Today · {now}</div>
      </div>

      {/* Outcome + Follow-up date row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginBottom: 10 }}>
        <div>
          <div style={fieldLabelStyle}>Outcome</div>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            style={fieldInputStyle}
          >
            {LOG_OUTCOMES.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <div style={fieldLabelStyle}>Follow-up date</div>
          <input
            type="date"
            value={followup}
            onChange={(e) => setFollowup(e.target.value)}
            style={fieldInputStyle}
          />
        </div>
      </div>

      {/* Notes */}
      <div style={{ marginBottom: 10 }}>
        <div style={fieldLabelStyle}>Call notes</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did they say? What's the next action? Any objections to handle?"
          rows={3}
          style={{ ...fieldInputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      {/* Footer — Clear + Save Call Entry. Outcome buttons live below this
          card in the main column and will use the same `notes` value. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }}>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={saving}>Clear</Button>
        <Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
          {saving ? <><Spinner /> Saving…</> : '💾 Save Call Entry'}
        </Button>
      </div>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.4px',
  color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4,
};
const fieldInputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface2)',
  border: '1px solid var(--border)', borderRadius: 4,
  padding: '7px 10px', fontSize: '0.78rem',
  color: 'var(--text)', fontFamily: 'inherit',
};

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

function formatCallTimestamp(iso: string): string {
  try {
    return new Date(iso.replace(' ', 'T')).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
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

// Nav row — sits below outcome buttons. Neither button writes to the DB.
// Previous walks back through positions (sees called + uncalled). Skip-for-now
// advances to the next uncalled lead, wrapping if at the end so skipped leads
// naturally come back around. The generic "Next" was removed — it duplicated
// Skip enough to confuse the operator without earning the screen space.
interface NavRowProps {
  canGoBack: boolean;
  recording: boolean;
  onPrevious: () => void;
  onSkip: () => void;
}
function NavRow({ canGoBack, recording, onPrevious, onSkip }: NavRowProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      padding: '8px 18px 12px',
      borderTop: '1px solid var(--border)',
      background: 'var(--surface2)',
      gap: 6,
    }}>
      <NavBtn label="← Previous" sub="←" onClick={onPrevious} disabled={recording || !canGoBack} align="left" />
      <NavBtn label="Skip for now →" sub="S" onClick={onSkip} disabled={recording} align="right" />
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
