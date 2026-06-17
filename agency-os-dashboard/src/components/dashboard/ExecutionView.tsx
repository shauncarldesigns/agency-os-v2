import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Lead, ShowToast, Session, CallOutcome, SessionBlock } from '../../lib/types';
import { api, ApiError, type SessionOutcomeBody } from '../../lib/api';
import type {
  Stage, Script, Objection, BranchingObjection, BranchingPath, SimpleObjection,
  ObjectionsByCategory, ObjectionCategory,
  ObjectionHit, RebuttalVariant, LeadContext,
} from '../../lib/playbook';
import { interpolate, tradeLabel } from '../../lib/playbook';
import { usePlaybook } from '../../lib/usePlaybook';
import { Spinner } from '../shared/Spinner';
import { Badge } from '../shared/Badge';
import { InlineEditField } from '../shared/InlineEditField';
import { formatPhone, googleMapsUrl } from '../../lib/format';
import { BookingPane } from './BookingPane';

/**
 * Calling cockpit — the operator's whole world during an active session.
 *
 * Replaces the prior Brief-Studio-styled exec view with the spec's
 * lead-header / script-panel / objection-panel / notes / outcome-bar
 * layout. Preserves all session lifecycle plumbing (lead loading,
 * navigation, autosave drafts, booking pane, post-booking prompt,
 * burn-through completion).
 *
 * New behaviors:
 *   - Tap an objection chip → script panel swaps for the rebuttal card,
 *     chip highlights, [MM:SS · OBJECTION: ...] auto-logs to notes.
 *   - Branching objection → diagnostic prompt + 3 path cards; tap a path
 *     to reveal that rebuttal and log `→ {path label}` to notes.
 *   - ✨ Generate alternative calls /api/playbook/generate-rebuttal and
 *     renders 3 variant cards; "Use this" calls /mark-used and swaps
 *     the displayed rebuttal in place.
 *   - Outcome tap (Voicemail / Not interested / Callback / Booked)
 *     submits the call_log row with the objection_hits[] array attached.
 *
 * Keyboard shortcuts (preserved from prior version):
 *   1 = Voicemail, 2 = Not interested, 3 = Callback, 4 = Booked demo
 *   ← = Previous lead, → / S = Skip for now, Esc = close any picker
 */

interface ExecutionViewProps {
  sessionId: number;
  showToast: ShowToast;
  onClose: () => void;
  onPauseAndBuild?: (projectId: number) => void;
}

interface LeadWithSession extends Lead {
  position?: number;
  is_callback?: number;
  session_lead_id?: number;
  call_outcome?: CallOutcome | null;
  called_at?: string | null;
}

interface ActiveObjectionState {
  objectionId: string;
  pathId?: string;            // for branching, once operator picks
  variantLabel?: string;      // for SimpleObjection variants — which built-in chip the operator picked (undefined = canonical Default)
  variantOverride?: {         // when operator clicks "Use this" on a Claude generation
    angle: string;
    rebuttal: string;
    variantIndex: number;
    generationId: number;
  };
}

interface GeneratedState {
  generationId: number;
  variants: RebuttalVariant[];
  forObjectionId: string;
}

export function ExecutionView({ sessionId, showToast, onClose, onPauseAndBuild }: ExecutionViewProps) {
  const { data: playbook, loading: playbookLoading, error: playbookError } = usePlaybook();

  const [session, setSession] = useState<Session | null>(null);
  const [leads, setLeads] = useState<LeadWithSession[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);

  const lead = leads[currentIndex] ?? null;
  const calledCount = leads.filter((l) => l.call_outcome != null).length;
  const allDone = leads.length > 0 && calledCount === leads.length;

  // Per-lead notes (auto-saved to localStorage, restored on navigation).
  const [notes, setNotes] = useState('');
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  const draftKey = lead?.session_lead_id ? `exec-notes-${lead.session_lead_id}` : null;
  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => {
      try {
        if (notes.trim()) localStorage.setItem(draftKey, notes);
        else localStorage.removeItem(draftKey);
      } catch { /* silent */ }
    }, 500);
    return () => clearTimeout(t);
  }, [notes, draftKey]);
  const clearDraft = useCallback(() => {
    if (!draftKey) return;
    try { localStorage.removeItem(draftKey); } catch { /* silent */ }
  }, [draftKey]);

  // Per-call objection hit log + active objection state.
  const [objectionHits, setObjectionHits] = useState<ObjectionHit[]>([]);
  const objectionHitsRef = useRef(objectionHits);
  useEffect(() => { objectionHitsRef.current = objectionHits; }, [objectionHits]);
  const [activeObj, setActiveObj] = useState<ActiveObjectionState | null>(null);
  const [generated, setGenerated] = useState<GeneratedState | null>(null);
  const [generating, setGenerating] = useState(false);
  const [marking, setMarking] = useState<number | null>(null);

  // Per-lead call timer (used for MM:SS in objection-hit log and notes tags).
  const [callStartMs, setCallStartMs] = useState<number>(() => Date.now());
  // Tick once per second so the utility-row "ON CALL 1:48" updates live.
  const [tickSeconds, setTickSeconds] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTickSeconds((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const callElapsedS = Math.max(0, Math.floor((Date.now() - callStartMs) / 1000)) + (tickSeconds * 0);

  // Script + stage state.
  const script: Script | null = playbook?.defaultScript ?? null;
  const linearStages = useMemo(() => (script?.stages ?? []).filter((s) => !s.branch), [script]);

  // Token-interpolation context — feeds [Company Name] / [Name] / [city] /
  // [state] / [their trade] / [review_count] / [review_avg] / [reviews]
  // across every script + rebuttal render. scores.reviews uses the same
  // combined "41 · 4.9★" format the lead-header chip shows so the parsing
  // helper in playbook.ts can split it.
  const leadCtx: LeadContext = useMemo(() => {
    const reviewCount = lead?.google_review_count ?? null;
    const rating = lead?.google_rating ?? null;
    const reviewsCombined = reviewCount != null && rating != null
      ? `${reviewCount} · ${rating}★`
      : reviewCount != null
        ? String(reviewCount)
        : undefined;
    return {
      company: lead?.company ?? '',
      contact_name: lead?.contact ?? undefined,
      city: lead?.city ?? undefined,
      state: lead?.state ?? undefined,
      trade: tradeLabel(lead?.industry),
      scores: reviewsCombined ? { reviews: reviewsCombined } : undefined,
    };
  }, [lead]);
  const [currentStageId, setCurrentStageId] = useState<string | null>(null);
  useEffect(() => {
    if (script && currentStageId === null) {
      setCurrentStageId(linearStages[0]?.id ?? script.stages[0]?.id ?? null);
    }
  }, [script, currentStageId, linearStages]);

  const currentStage = script?.stages.find((s) => s.id === currentStageId) ?? null;
  const linearIdx = linearStages.findIndex((s) => s.id === currentStageId);
  const nextStage = linearIdx >= 0 ? linearStages[linearIdx + 1] ?? null : null;

  // Inline callback picker.
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [callbackDate, setCallbackDate] = useState(defaultCallbackDate());
  const [callbackBlock, setCallbackBlock] = useState<SessionBlock>('morning');

  // Booking mode (BookingPane takeover when operator hits Booked).
  const [bookingMode, setBookingMode] = useState(false);

  // Pending post-booking prompt (offer Pause & build demo path).
  const [pendingBooked, setPendingBooked] = useState<{ projectId: number; company: string } | null>(null);

  // ===========================================================================
  // SESSION LOADING + LEAD NAVIGATION
  // ===========================================================================

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.sessions.get(sessionId);
      setSession(res.session);
      setLeads(res.leads);
      const firstUncalled = res.leads.findIndex((l) => l.call_outcome == null);
      setCurrentIndex(firstUncalled === -1 ? 0 : firstUncalled);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load session: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [sessionId, showToast]);

  useEffect(() => { void load(); }, [load]);

  // Reset per-lead state when the active lead changes (navigation, advance).
  useEffect(() => {
    if (!draftKey) { setNotes(''); }
    else {
      try { setNotes(localStorage.getItem(draftKey) ?? ''); }
      catch { setNotes(''); }
    }
    setObjectionHits([]);
    setActiveObj(null);
    setGenerated(null);
    setCallbackOpen(false);
    setBookingMode(false);
    setCallStartMs(Date.now());
    setCurrentStageId(linearStages[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.session_lead_id]);

  // Persist an inline edit (owner name / email) on the active lead. PUTs the
  // partial to /api/leads/:id, merges the server response into the local
  // leads array so both the cockpit header AND BookingPane (which reads the
  // same lead prop) see the new value immediately.
  const handleLeadFieldUpdate = useCallback(async (field: 'contact' | 'email', value: string | null) => {
    if (!lead) return;
    try {
      const res = await api.leads.update(lead.id, { [field]: value });
      setLeads((prev) => {
        const next = prev.slice();
        const idx = next.findIndex((l) => l.id === lead.id);
        if (idx >= 0) next[idx] = { ...next[idx], ...res.lead };
        return next;
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not save: ${msg}`, 'error');
    }
  }, [lead, showToast]);

  const findNextUncalled = useCallback((fromIndex: number, list: LeadWithSession[]): number => {
    const total = list.length;
    for (let i = fromIndex + 1; i < total; i++) {
      if (list[i].call_outcome == null) return i;
    }
    for (let i = 0; i <= fromIndex; i++) {
      if (list[i].call_outcome == null) return i;
    }
    return total;
  }, []);

  const recordOutcome = useCallback(async (
    outcome: CallOutcome,
    extra: Partial<SessionOutcomeBody> = {},
  ) => {
    if (!lead || recording) return;
    setRecording(true);
    try {
      const hits = objectionHitsRef.current;
      const res = await api.sessions.outcome(sessionId, {
        leadId: lead.id,
        outcome,
        notes: notesRef.current.trim() || undefined,
        objectionHits: hits.length ? hits : undefined,
        ...extra,
      });
      clearDraft();
      if (outcome === 'booked' && res.project) {
        setPendingBooked({ projectId: res.project.id, company: lead.company });
      }
      const updated = leads.slice();
      updated[currentIndex] = { ...updated[currentIndex], call_outcome: outcome, called_at: new Date().toISOString() };
      setLeads(updated);
      setCurrentIndex(findNextUncalled(currentIndex, updated));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not record outcome: ${msg}`, 'error');
    } finally {
      setRecording(false);
    }
  }, [lead, sessionId, recording, leads, currentIndex, clearDraft, showToast, findNextUncalled]);

  // ===========================================================================
  // OBJECTION HANDLING
  // ===========================================================================

  // Append a line to notes without trampling existing content. Used for both
  // objection-hit auto-tags and path selection.
  const appendNote = useCallback((line: string) => {
    setNotes((prev) => prev ? `${prev}\n${line}` : line);
  }, []);

  const handleObjectionTap = useCallback((objection: Objection) => {
    const ts = Math.max(0, Math.floor((Date.now() - callStartMs) / 1000));
    setActiveObj({ objectionId: objection.id });
    setGenerated(null);
    setObjectionHits((prev) => [
      ...prev,
      { objection_id: objection.id, handled: null, timestamp_s: ts },
    ]);
    appendNote(`[${formatMMSS(ts)} · OBJECTION: ${objection.label}]`);
  }, [callStartMs, appendNote]);

  // Operator picks a stock variant chip on a simple objection. Updates the
  // active state + stamps variant_label onto the most recent objection_hit
  // for that objection so the call-log captures which angle was used.
  // Passing label=undefined returns to the canonical Default rebuttal.
  const handleVariantTap = useCallback((objectionId: string, label: string | undefined) => {
    setActiveObj((prev) => prev && prev.objectionId === objectionId
      ? { ...prev, variantLabel: label }
      : prev);
    setObjectionHits((prev) => {
      const next = prev.slice();
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].objection_id === objectionId) {
          next[i] = { ...next[i], variant_label: label };
          break;
        }
      }
      return next;
    });
  }, []);

  const handlePathTap = useCallback((objection: BranchingObjection, path: BranchingPath) => {
    setActiveObj((prev) => prev ? { ...prev, pathId: path.id } : prev);
    // Update last objection-hit with the path.
    setObjectionHits((prev) => {
      const next = prev.slice();
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].objection_id === objection.id) {
          next[i] = { ...next[i], path_id: path.id };
          break;
        }
      }
      return next;
    });
    appendNote(`→ ${path.short_label}`);
  }, [appendNote]);

  const handleHandled = useCallback(() => {
    if (!activeObj) return;
    setObjectionHits((prev) => {
      const next = prev.slice();
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].objection_id === activeObj.objectionId) {
          next[i] = { ...next[i], handled: true };
          break;
        }
      }
      return next;
    });
    setActiveObj(null);
    setGenerated(null);
  }, [activeObj]);

  const handleDidntLand = useCallback(() => {
    if (!activeObj) return;
    setObjectionHits((prev) => {
      const next = prev.slice();
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].objection_id === activeObj.objectionId) {
          next[i] = { ...next[i], handled: false };
          break;
        }
      }
      return next;
    });
    setActiveObj(null);
    setGenerated(null);
  }, [activeObj]);

  const stockRebuttalFor = useCallback((objectionId: string, pathId?: string, variantLabel?: string): string => {
    const obj = playbook?.objections
      ? (Object.values(playbook.objections).flat() as Objection[]).find((o) => o.id === objectionId)
      : null;
    if (!obj) return '';
    let raw: string;
    if (obj.type === 'simple') {
      const v = variantLabel ? obj.variants?.find((x) => x.label === variantLabel) : null;
      raw = v?.rebuttal ?? obj.rebuttal;
    } else {
      raw = !pathId
        ? obj.diagnostic.prompt
        : obj.paths.find((p) => p.id === pathId)?.rebuttal ?? obj.diagnostic.prompt;
    }
    return interpolate(raw, leadCtx);
  }, [playbook, leadCtx]);

  const handleGenerate = useCallback(async () => {
    if (!activeObj || !lead || generating) return;
    const objection = findObjection(playbook?.objections, activeObj.objectionId);
    if (!objection) return;
    setGenerating(true);
    try {
      const ctx: LeadContext = {
        company: lead.company,
        contact_name: lead.contact ?? undefined,
        city: lead.city ?? undefined,
        state: lead.state ?? undefined,
        trade: lead.industry ?? undefined,
      };
      const stock = stockRebuttalFor(activeObj.objectionId, activeObj.pathId, activeObj.variantLabel);
      const resp = await api.playbook.generateRebuttal({
        objection_id: activeObj.objectionId,
        lead_id: lead.id,
        lead_context: ctx,
        current_stage: currentStageId ?? undefined,
        call_duration_seconds: Math.floor((Date.now() - callStartMs) / 1000),
        free_text_notes: notesRef.current || undefined,
        stock_rebuttal_already_tried: stock,
      });
      setGenerated({
        generationId: resp.generation_id,
        variants: resp.variants,
        forObjectionId: activeObj.objectionId,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not generate alternatives: ${msg}`, 'error');
    } finally {
      setGenerating(false);
    }
  }, [activeObj, lead, generating, playbook, stockRebuttalFor, currentStageId, callStartMs, showToast]);

  const handleUseVariant = useCallback(async (variantIndex: number) => {
    if (!generated || !activeObj) return;
    const variant = generated.variants[variantIndex];
    if (!variant) return;
    setMarking(variantIndex);
    try {
      await api.playbook.markUsed(generated.generationId, variantIndex);
      setActiveObj({
        ...activeObj,
        variantOverride: {
          angle: variant.angle,
          rebuttal: variant.rebuttal,
          variantIndex,
          generationId: generated.generationId,
        },
      });
      // Stamp generation id onto the most recent objection_hit for this objection.
      setObjectionHits((prev) => {
        const next = prev.slice();
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].objection_id === activeObj.objectionId) {
            next[i] = { ...next[i], generation_id: generated.generationId };
            break;
          }
        }
        return next;
      });
      setGenerated(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not mark variant: ${msg}`, 'error');
    } finally {
      setMarking(null);
    }
  }, [generated, activeObj, showToast]);

  // ===========================================================================
  // STAGE NAVIGATION
  // ===========================================================================

  const advanceStage = useCallback(() => {
    if (!nextStage) return;
    setCurrentStageId(nextStage.id);
  }, [nextStage]);

  const backStage = useCallback(() => {
    if (linearIdx <= 0) return;
    const prev = linearStages[linearIdx - 1];
    if (prev) setCurrentStageId(prev.id);
  }, [linearIdx, linearStages]);

  // ===========================================================================
  // OUTCOME HANDLERS
  // ===========================================================================

  const handleVoicemail = useCallback(() => void recordOutcome('voicemail'), [recordOutcome]);
  const handleNotInterested = useCallback(() => void recordOutcome('not_interested'), [recordOutcome]);
  const handleCallbackToggle = useCallback(() => setCallbackOpen((v) => !v), []);
  const handleCallbackConfirm = useCallback(async () => {
    await recordOutcome('callback', { callbackDate, blockHint: callbackBlock });
    setCallbackOpen(false);
  }, [recordOutcome, callbackDate, callbackBlock]);
  const handleBookedDemo = useCallback(() => {
    if (!lead) return;
    setBookingMode(true);
  }, [lead]);
  const handleBookingConfirm = useCallback(async (scheduledFor: string, honeybookConfirmed: boolean) => {
    await recordOutcome('booked', { demoData: { scheduledFor, honeybookConfirmed } });
  }, [recordOutcome]);

  // ===========================================================================
  // NAVIGATION
  // ===========================================================================

  const canGoBack = currentIndex > 0;
  const handlePrevious = useCallback(() => {
    if (canGoBack) setCurrentIndex((i) => i - 1);
  }, [canGoBack]);
  const handleSkip = useCallback(() => {
    setCurrentIndex(findNextUncalled(currentIndex, leads));
  }, [findNextUncalled, currentIndex, leads]);

  // ===========================================================================
  // KEYBOARD SHORTCUTS
  // ===========================================================================

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (recording || loading) return;
      switch (e.key) {
        case '1': e.preventDefault(); handleVoicemail(); break;
        case '2': e.preventDefault(); handleNotInterested(); break;
        case '3': e.preventDefault(); handleCallbackToggle(); break;
        case '4': e.preventDefault(); handleBookedDemo(); break;
        case 's': case 'S': case 'ArrowRight': e.preventDefault(); handleSkip(); break;
        case 'ArrowLeft': e.preventDefault(); handlePrevious(); break;
        case 'Escape': e.preventDefault(); setCallbackOpen(false); setActiveObj(null); setGenerated(null); break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording, loading, handleVoicemail, handleNotInterested, handleCallbackToggle, handleBookedDemo, handleSkip, handlePrevious]);

  // ===========================================================================
  // RENDER
  // ===========================================================================

  if (loading || playbookLoading) {
    return (
      <div className="cockpit-page" style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spinner /> <span style={{ marginLeft: 8, color: 'var(--text3)' }}>Loading…</span>
      </div>
    );
  }

  if (playbookError) {
    return (
      <div className="cockpit-page" style={{ textAlign: 'center', paddingTop: 80, color: 'var(--red)' }}>
        Could not load playbook content: {playbookError.message}
      </div>
    );
  }

  if (allDone || !lead) {
    return (
      <div className="cockpit-page">
        <BurnThroughComplete
          sessionId={sessionId}
          progress={{ total: leads.length, called: calledCount }}
          showToast={showToast}
          onExtend={async (count) => {
            const r = await api.sessions.extend(sessionId, count);
            showToast(`Added ${r.added} leads${r.widened.length ? ` (widened: ${r.widened.length})` : ''}`, 'success');
            await load();
          }}
          onWrap={async () => {
            await api.sessions.complete(sessionId);
            showToast('Session complete', 'success');
            onClose();
          }}
        />
      </div>
    );
  }

  const objection = activeObj ? findObjection(playbook?.objections, activeObj.objectionId) : null;
  const totalHits = objectionHits.length;

  return (
    <div className="cockpit-page">
      {pendingBooked && (
        <PostBookingPrompt
          company={pendingBooked.company}
          onContinue={() => setPendingBooked(null)}
          onPauseAndBuild={() => {
            const id = pendingBooked.projectId;
            setPendingBooked(null);
            onPauseAndBuild?.(id);
          }}
        />
      )}

      <div className="cockpit-utility">
        <span>
          <button className="cockpit-exit" type="button" onClick={onClose}>← Exit</button>
          {session && ` · ${session.session_date} · ${session.block === 'morning' ? 'Morning' : 'Evening'}`}
        </span>
        <span>
          {currentIndex + 1} of {leads.length} · {calledCount} called · ON CALL {formatMMSS(callElapsedS)}
        </span>
      </div>

      <div className="cockpit-leadhead">
        <div className="cockpit-leadhead-grid">
          <div>
            <div className="cockpit-company-label">
              {[lead.industry, lead.city, lead.state].filter(Boolean).join(' · ')}
              {lead.is_callback === 1 && <> · <Badge color="yellow">Callback</Badge></>}
            </div>
            <div className="cockpit-company-name">{lead.company}</div>
            <div className="cockpit-company-meta">
              {lead.website && <a href={normalizeUrl(lead.website)} target="_blank" rel="noreferrer">🌐 {cleanDomain(lead.website)} ↗</a>}
              {(() => {
                const maps = googleMapsUrl(lead);
                return maps ? <a href={maps} target="_blank" rel="noreferrer">🗺️ Maps ↗</a> : null;
              })()}
            </div>
          </div>
          <div className="cockpit-call-cluster">
            <div className="cockpit-phone-hero">
              <div className="cockpit-phone-label">📞 CALL</div>
              <div className="cockpit-phone-number">
                {lead.phone ? <a href={`tel:${lead.phone}`}>{formatPhone(lead.phone)}</a> : '—'}
              </div>
            </div>
            <InlineEditField
              label="Owner"
              variant="boxed"
              value={lead.contact}
              suggested={firstMinedOwner(lead.owner_names)}
              placeholder="+ add owner name"
              onSave={(v) => handleLeadFieldUpdate('contact', v)}
            />
            <InlineEditField
              label="Email"
              variant="boxed"
              type="email"
              value={lead.email}
              placeholder="+ add email"
              onSave={(v) => handleLeadFieldUpdate('email', v)}
            />
          </div>
          <div className="cockpit-scores">
            <ScoreChip label="REVIEWS" value={`${lead.google_review_count ?? 0}${lead.google_rating ? ` · ${lead.google_rating}★` : ''}`} kind={reviewKind(lead.google_review_count)} />
            <ScoreChip label="GBP" value={lead.gbp_claimed ? '✓ Claimed' : '— Unclaimed'} kind={lead.gbp_claimed ? 'good' : 'warn'} />
            <ScoreChip label="WEBSITE" value={lead.website ? '✓ Has site' : '— none'} kind={lead.website ? 'good' : 'bad'} />
            <ScoreChip
              label="SCORE"
              value={`${lead.opportunity_score ?? '—'}${lead.recommended_tier ? ` · T${lead.recommended_tier}` : ''}`}
              kind={scoreKind(lead.opportunity_score)}
            />
          </div>
        </div>
      </div>

      {bookingMode ? (
        <BookingPane
          lead={lead}
          showToast={showToast}
          onConfirm={handleBookingConfirm}
          onCancel={() => setBookingMode(false)}
        />
      ) : (
        <>
          <div className="cockpit-grid">
            <ScriptPanel
              script={script}
              linearStages={linearStages}
              currentStage={currentStage}
              currentStageIdx={linearIdx}
              nextStage={nextStage}
              ctx={leadCtx}
              onBack={backStage}
              onAdvance={advanceStage}
              onJumpToStage={(id) => setCurrentStageId(id)}
            />
            <ObjectionPanel
              byCategory={playbook?.objections ?? emptyByCategory()}
              activeObjectionId={activeObj?.objectionId ?? null}
              hits={objectionHits}
              totalHits={totalHits}
              onTap={handleObjectionTap}
            />
          </div>

          {activeObj && objection && (
            <ActiveObjectionPanel
              objection={objection}
              activePath={activeObj.pathId}
              activeVariantLabel={activeObj.variantLabel}
              variantOverride={activeObj.variantOverride}
              generated={generated && generated.forObjectionId === activeObj.objectionId ? generated : null}
              generating={generating}
              marking={marking}
              ctx={leadCtx}
              onPathTap={(p) => handlePathTap(objection as BranchingObjection, p)}
              onVariantTap={(label) => handleVariantTap(activeObj.objectionId, label)}
              onHandled={handleHandled}
              onDidntLand={handleDidntLand}
              onGenerate={handleGenerate}
              onUseVariant={handleUseVariant}
              onBack={() => { setActiveObj(null); setGenerated(null); }}
            />
          )}
        </>
      )}

      <div className="cockpit-notes-panel">
        <div className="cockpit-panel-header">
          <span className="cockpit-panel-title orange">📝 NOTES</span>
          <span className="cockpit-panel-meta">auto-saves · objection chips auto-tag in</span>
        </div>
        <textarea
          className="cockpit-notes-textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Start typing or tap an objection to log it..."
        />
      </div>

      {callbackOpen && (
        <div className="cockpit-callback-row">
          <span style={{ fontSize: '0.72rem', color: 'var(--text2)' }}>Callback on:</span>
          <input type="date" value={callbackDate} onChange={(e) => setCallbackDate(e.target.value)} />
          <select value={callbackBlock} onChange={(e) => setCallbackBlock(e.target.value as SessionBlock)}>
            <option value="morning">Morning</option>
            <option value="evening">Evening</option>
          </select>
          <button type="button" className="cockpit-btn-primary" onClick={() => void handleCallbackConfirm()} disabled={recording}>
            Confirm callback
          </button>
          <button type="button" className="cockpit-btn" onClick={() => setCallbackOpen(false)}>Cancel</button>
        </div>
      )}

      <div className="cockpit-outcome-bar">
        <button type="button" className="cockpit-outcome-btn cockpit-outcome-voicemail" onClick={handleVoicemail} disabled={recording || bookingMode}>📵 Voicemail</button>
        <button type="button" className="cockpit-outcome-btn cockpit-outcome-not-interested" onClick={handleNotInterested} disabled={recording || bookingMode}>✕ Not interested</button>
        <button type="button" className={`cockpit-outcome-btn cockpit-outcome-callback${callbackOpen ? ' active' : ''}`} onClick={handleCallbackToggle} disabled={recording || bookingMode}>↻ Callback</button>
        <button type="button" className="cockpit-outcome-btn cockpit-outcome-booked" onClick={handleBookedDemo} disabled={recording || bookingMode}>✓ Booked demo</button>
      </div>

      <div className="cockpit-navrow">
        <button type="button" className="cockpit-btn" onClick={handlePrevious} disabled={!canGoBack}>← Previous</button>
        <ProgressDashes total={leads.length} called={calledCount} currentIndex={currentIndex} />
        <button type="button" className="cockpit-btn" onClick={handleSkip}>Skip for now →</button>
      </div>
    </div>
  );
}

// ============================================================================
// SCRIPT PANEL
// ============================================================================

function ScriptPanel({
  script, linearStages, currentStage, currentStageIdx, nextStage, ctx, onBack, onAdvance, onJumpToStage,
}: {
  script: Script | null;
  linearStages: Stage[];
  currentStage: Stage | null;
  currentStageIdx: number;
  nextStage: Stage | null;
  ctx: LeadContext;
  onBack: () => void;
  onAdvance: () => void;
  onJumpToStage: (id: string) => void;
}) {
  if (!script) {
    return (
      <div className="cockpit-panel">
        <div className="cockpit-panel-header">
          <span className="cockpit-panel-title blue">📖 SCRIPT</span>
        </div>
        <div style={{ fontSize: '0.74rem', color: 'var(--text3)' }}>No script loaded.</div>
      </div>
    );
  }
  return (
    <div className="cockpit-panel">
      <div className="cockpit-panel-header">
        <span className="cockpit-panel-title blue">📖 {script.label.toUpperCase()}</span>
        <span className="cockpit-panel-meta">
          Stage {Math.max(currentStageIdx + 1, 1)} of {linearStages.length}
        </span>
      </div>
      <div className="cockpit-stage-crumbs">
        {linearStages.map((s, i) => {
          const isActive = s.id === currentStage?.id;
          const isDone = i < currentStageIdx;
          return (
            <button
              key={s.id}
              type="button"
              className={`cockpit-stage-chip${isActive ? ' active' : isDone ? ' done' : ''}`}
              onClick={() => onJumpToStage(s.id)}
            >
              {isDone ? '✓ ' : isActive ? '● ' : ''}{s.short_label}
            </button>
          );
        })}
      </div>
      {currentStage && (
        <div className="cockpit-stage-active">
          <div className="cockpit-stage-heading">Say this · {currentStage.label}</div>
          <div className="cockpit-stage-body">{interpolate(currentStage.body, ctx)}</div>
          {currentStage.note && <div className="cockpit-stage-note">↳ {interpolate(currentStage.note, ctx)}</div>}
        </div>
      )}
      {nextStage && (
        <div className="cockpit-stage-next">
          <div className="cockpit-stage-next-heading">Next · {nextStage.label}</div>
          <div className="cockpit-stage-next-body">{truncate(interpolate(nextStage.body, ctx), 120)}</div>
        </div>
      )}
      <div className="cockpit-stage-controls">
        <button type="button" className="cockpit-btn" onClick={onBack} disabled={currentStageIdx <= 0}>← Back</button>
        <button type="button" className="cockpit-btn-primary" onClick={onAdvance} disabled={!nextStage}>Advance →</button>
      </div>
    </div>
  );
}

// ============================================================================
// OBJECTION PANEL
// ============================================================================

const CAT_LABEL: Record<ObjectionCategory, string> = {
  'standard': 'Standard',
  'deep-dive': 'Deep dive · branches',
  'closing': 'Closing',
};

function ObjectionPanel({
  byCategory, activeObjectionId, hits, totalHits, onTap,
}: {
  byCategory: ObjectionsByCategory;
  activeObjectionId: string | null;
  hits: ObjectionHit[];
  totalHits: number;
  onTap: (o: Objection) => void;
}) {
  const cats: ObjectionCategory[] = ['standard', 'deep-dive', 'closing'];
  return (
    <div className="cockpit-panel">
      <div className="cockpit-panel-header">
        <span className="cockpit-panel-title coral">🎯 OBJECTIONS</span>
        <span className="cockpit-panel-meta" style={{ color: totalHits ? 'var(--yellow)' : undefined }}>
          {totalHits} hit{totalHits === 1 ? '' : 's'}
        </span>
      </div>
      {cats.map((cat) => {
        const items = byCategory[cat] ?? [];
        if (!items.length) return null;
        return (
          <div key={cat}>
            <div className="cockpit-obj-cat">{CAT_LABEL[cat]}</div>
            <div className="cockpit-obj-grid">
              {items.map((o) => {
                const isActive = o.id === activeObjectionId;
                const wasHit = hits.some((h) => h.objection_id === o.id);
                const isWide = items.length % 2 === 1 && items.indexOf(o) === items.length - 1;
                return (
                  <button
                    key={o.id}
                    type="button"
                    className={`cockpit-obj-chip${isActive ? ' active' : ''}${wasHit && !isActive ? ' hit' : ''}${isWide ? ' full' : ''}`}
                    onClick={() => onTap(o)}
                  >
                    {isActive ? '● ' : ''}{o.label}{o.type === 'branching' ? ' ↗' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// ACTIVE OBJECTION PANEL (simple OR branching)
// ============================================================================

function ActiveObjectionPanel({
  objection, activePath, activeVariantLabel, variantOverride, generated, generating, marking, ctx,
  onPathTap, onVariantTap, onHandled, onDidntLand, onGenerate, onUseVariant, onBack,
}: {
  objection: Objection;
  activePath?: string;
  activeVariantLabel?: string;
  variantOverride?: ActiveObjectionState['variantOverride'];
  generated: GeneratedState | null;
  generating: boolean;
  marking: number | null;
  ctx: LeadContext;
  onPathTap: (p: BranchingPath) => void;
  onVariantTap: (label: string | undefined) => void;
  onHandled: () => void;
  onDidntLand: () => void;
  onGenerate: () => void;
  onUseVariant: (index: number) => void;
  onBack: () => void;
}) {
  const isBranching = objection.type === 'branching';
  const path = isBranching ? (objection as BranchingObjection).paths.find((p) => p.id === activePath) : null;
  // Simple-objection variants — only meaningful when objection.type === 'simple'
  const simpleVariants = !isBranching && (objection as SimpleObjection).variants?.length
    ? (objection as SimpleObjection).variants!
    : null;
  const activeVariant = simpleVariants?.find((v) => v.label === activeVariantLabel);
  const simpleRebuttal = activeVariant?.rebuttal ?? (objection as { rebuttal: string }).rebuttal;
  return (
    <div className="cockpit-active-obj">
      <div className="cockpit-panel-header">
        <span className="cockpit-panel-title coral">
          🎯 {isBranching ? 'BRANCHING REBUTTAL' : 'REBUTTAL'} · "{objection.label.toUpperCase()}"
        </span>
        <button type="button" className="cockpit-btn" style={{ padding: '3px 8px' }} onClick={onBack}>← back</button>
      </div>

      {variantOverride ? (
        <div className="cockpit-rebuttal-card" style={{ borderColor: '#afa9ec' }}>
          <div className="cockpit-rebuttal-heading" style={{ color: '#afa9ec' }}>
            ✨ Using generated variant — {variantOverride.angle}
          </div>
          <div className="cockpit-rebuttal-body">{interpolate(variantOverride.rebuttal, ctx)}</div>
        </div>
      ) : isBranching ? (
        <>
          <div className="cockpit-rebuttal-card">
            <div className="cockpit-rebuttal-heading">Diagnose first — say this:</div>
            <div className="cockpit-rebuttal-body">{interpolate((objection as BranchingObjection).diagnostic.prompt, ctx)}</div>
          </div>
          {!path ? (
            <>
              <div className="cockpit-path-label">↓ Then branch on their answer:</div>
              <div className="cockpit-path-grid">
                {(objection as BranchingObjection).paths.map((p, i) => (
                  <button key={p.id} type="button" className="cockpit-path-card" onClick={() => onPathTap(p)}>
                    <div className="cockpit-path-tag">Path {String.fromCharCode(65 + i)}</div>
                    <div className="cockpit-path-name">{p.label} →</div>
                    {(p.drop_ask_to || p.follow_up_note || p.sets_followup_days) && (
                      <div className="cockpit-path-desc">
                        {p.drop_ask_to && `Drop ask to ${p.drop_ask_to}`}
                        {p.follow_up_note && p.follow_up_note}
                        {p.sets_followup_days && `Set ${p.sets_followup_days}-day followup`}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="cockpit-rebuttal-card">
              <div className="cockpit-rebuttal-heading">{path.label} — say this:</div>
              <div className="cockpit-rebuttal-body">{interpolate(path.rebuttal, ctx)}</div>
              {path.note && <div className="cockpit-rebuttal-note">↳ {interpolate(path.note, ctx)}</div>}
            </div>
          )}
        </>
      ) : (
        <>
          {simpleVariants && (
            <div className="cockpit-variant-row">
              <span className="cockpit-variant-row-label">Angle:</span>
              <button
                type="button"
                className={`cockpit-variant-chip${!activeVariantLabel ? ' active' : ''}`}
                onClick={() => onVariantTap(undefined)}
              >Default</button>
              {simpleVariants.map((v) => (
                <button
                  key={v.label}
                  type="button"
                  className={`cockpit-variant-chip${activeVariantLabel === v.label ? ' active' : ''}`}
                  onClick={() => onVariantTap(v.label)}
                >{v.label}</button>
              ))}
            </div>
          )}
          <div className="cockpit-rebuttal-card">
            <div className="cockpit-rebuttal-heading">
              {simpleVariants
                ? activeVariant ? `${activeVariant.label} — say this:` : 'Default rebuttal — say this:'
                : 'Stock rebuttal — say this:'}
            </div>
            <div className="cockpit-rebuttal-body">{interpolate(simpleRebuttal, ctx)}</div>
            {('note' in objection && objection.note) && <div className="cockpit-rebuttal-note">↳ {interpolate(objection.note, ctx)}</div>}
          </div>
        </>
      )}

      <div className="cockpit-obj-actions">
        <button type="button" className="cockpit-btn-success" onClick={onHandled}>✓ Handled — continue</button>
        <button type="button" className="cockpit-btn-danger" onClick={onDidntLand}>✕ Didn't land</button>
        <button type="button" className="cockpit-btn-generate" onClick={onGenerate} disabled={generating}>
          {generating ? '✨ Generating…' : '✨ Generate alternative'}
        </button>
      </div>

      {generated && (
        <div className="cockpit-gen-results">
          <div className="cockpit-gen-label">✨ Generated alternatives · {generated.variants.length} angles</div>
          {generated.variants.map((v, i) => (
            <div key={i} className="cockpit-gen-variant">
              <div className="cockpit-gen-angle">{v.angle}</div>
              <div className="cockpit-gen-rebuttal">{interpolate(v.rebuttal, ctx)}</div>
              <button type="button" className="cockpit-btn-use" onClick={() => onUseVariant(i)} disabled={marking === i}>
                {marking === i ? 'Using…' : 'Use this'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SMALL SHARED COMPONENTS + HELPERS
// ============================================================================

function ScoreChip({ label, value, kind }: { label: string; value: string; kind: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const cls = kind === 'good' ? 'cockpit-score-good' : kind === 'warn' ? 'cockpit-score-warn' : kind === 'bad' ? 'cockpit-score-bad' : '';
  return (
    <div>
      <div className="cockpit-score-label">{label}</div>
      <div className={`cockpit-score-val ${cls}`}>{value}</div>
    </div>
  );
}

function ProgressDashes({ total, called, currentIndex }: { total: number; called: number; currentIndex: number }) {
  const cap = Math.min(total, 30);
  const items = Array.from({ length: cap });
  return (
    <div className="cockpit-progress-dashes" title={`${called} of ${total} called`}>
      {items.map((_, i) => {
        const cls = i < called ? 'done' : i === currentIndex ? 'now' : '';
        return <span key={i} className={`cockpit-progress-dash${cls ? ` ${cls}` : ''}`} />;
      })}
    </div>
  );
}

function PostBookingPrompt({ company, onContinue, onPauseAndBuild }: {
  company: string; onContinue: () => void; onPauseAndBuild: () => void;
}) {
  return (
    <div className="cockpit-overlay">
      <div className="cockpit-overlay-card">
        <div className="cockpit-overlay-title">✓ DEMO BOOKED</div>
        <div className="cockpit-overlay-sub">Booked a demo with <strong>{company}</strong>. Build the demo site now, or keep calling?</div>
        <div className="cockpit-overlay-actions">
          <button type="button" className="cockpit-btn-success" onClick={onPauseAndBuild}>🛠 Pause & build demo</button>
          <button type="button" className="cockpit-btn" onClick={onContinue}>Keep calling →</button>
        </div>
      </div>
    </div>
  );
}

function BurnThroughComplete({
  sessionId: _sid, progress, showToast: _t, onExtend, onWrap,
}: {
  sessionId: number;
  progress: { total: number; called: number };
  showToast: ShowToast;
  onExtend: (count: number) => Promise<void>;
  onWrap: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const wrap = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  return (
    <div style={{ textAlign: 'center', maxWidth: 480, margin: '60px auto', padding: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)' }}>
      <div style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '1.6rem', letterSpacing: 2, color: 'var(--accent)', marginBottom: 10 }}>
        🔥 SESSION COMPLETE
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: 20 }}>
        Called {progress.called} of {progress.total} leads. Nothing left in the queue.
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button type="button" className="cockpit-btn" onClick={wrap(() => onExtend(20))} disabled={busy}>+20 leads</button>
        <button type="button" className="cockpit-btn-primary" onClick={wrap(onWrap)} disabled={busy}>Wrap session →</button>
      </div>
    </div>
  );
}

// ----- helpers -----

function findObjection(byCat: ObjectionsByCategory | undefined, id: string | null | undefined): Objection | null {
  if (!byCat || !id) return null;
  for (const cat of Object.keys(byCat) as ObjectionCategory[]) {
    const o = byCat[cat].find((x) => x.id === id);
    if (o) return o;
  }
  return null;
}

function emptyByCategory(): ObjectionsByCategory {
  return { 'standard': [], 'deep-dive': [], 'closing': [] };
}

function formatMMSS(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function truncate(s: string, n: number): string {
  const trimmed = s.trim();
  return trimmed.length > n ? trimmed.slice(0, n - 1) + '…' : trimmed;
}

function defaultCallbackDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function normalizeUrl(url: string): string {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function cleanDomain(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

// Pull the first owner name from the JSON-stringified owner_names column
// (enrichment writes a string[] mined from reviews). Returned as null when
// unparseable / empty so it cleanly falls back to the placeholder.
function firstMinedOwner(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0];
  } catch { /* fall through */ }
  return null;
}

function reviewKind(count: number | null | undefined): 'good' | 'warn' | 'bad' | 'neutral' {
  if (count == null) return 'neutral';
  if (count >= 25) return 'good';
  if (count >= 10) return 'warn';
  return 'bad';
}

function scoreKind(score: number | null | undefined): 'good' | 'warn' | 'bad' | 'neutral' {
  if (score == null) return 'neutral';
  if (score >= 70) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}
