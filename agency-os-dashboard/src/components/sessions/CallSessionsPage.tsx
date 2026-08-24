import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  CalendarClock,
  AlertCircle,
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Copy,
  Eye,
  Filter,
  LayoutGrid,
  Columns3,
  Mail,
  Loader2,
  MapPin,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Pause,
  Play,
  SkipForward,
  Square,
  Activity,
  Circle,
  Pencil,
  Star,
  X,
} from 'lucide-react';
import {
  api,
  ApiError,
  industryLabel,
  TRACKING_BASE,
  type EmailAutomationDetail,
  type EmailAutomationSummary,
} from '../../lib/api';
import type { CallEntry, Lead, Project } from '../../lib/types';
import type { CallOutcome, ShowToast } from '../../lib/types';
import { LeadDetailModal } from '../shared/LeadDetailModal';
import { QualifyLeadModal } from '../pipeline/QualifyLeadModal';
import type { Tier } from '../../lib/pricing';
import { Spinner } from '../shared/Spinner';
import {
  parseSiteReviewReasons,
  SiteReviewFixModal,
  SiteReviewIssueSummary,
} from '../shared/SiteReviewFixModal';
import { RecordButton, type RecordButtonHandle } from '../dashboard/RecordButton';
import { AuthenticatedAudioPlayer } from '../shared/AuthenticatedAudioPlayer';
import {
  mapLeadRow,
  OpenSalesCallModal,
  type PipelineLead,
  type SelectedPlan,
} from '../leadpipeline/AutomatedPipelinePanel';

interface Props {
  showToast: ShowToast;
  onStateChanged?: () => void;
  onQualified?: (project: Project, tier: Tier) => void;
}

type CardTone = 'emerald' | 'amber' | 'blue' | 'rose' | 'slate';

type BoardItem = {
  id: string;
  leadId: number;
  title: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  rating: number | null;
  reviews: number | null;
  eyebrow: string;
  detail: string;
  note?: string | null;
  ageLabel: string;
  activityLabel: string;
  outcomeLabel: string | null;
  callbackDate: string | null;
  siteUrl: string | null;
  rawSiteUrl: string | null;
  reviewStatus: Lead['site_review_status'];
  reviewReasons: string[];
  reviewNote: string | null;
  clarityTag: string | null;
  sessions: number;
  engagementScore: number;
  engagementGrade: string;
  noReplyStep: number;
  followupStep: number;
  emailOutreachStarted: boolean;
  lastActionAt: string | null;
  lastAction: string;
  pipelineStatus: Lead['pipeline_status'];
  tone: CardTone;
  sortAt?: string | null;
};

type BoardColumn = {
  id: string;
  title: string;
  description: string;
  icon: typeof CalendarClock;
  tone: CardTone;
  items: BoardItem[];
};

const ALL = 'all';
const CALL_OUTREACH_VIEW_KEY = 'agency-os-call-outreach-view';
type CallOutreachView = 'automation' | 'board';

export function CallSessionsPage({ showToast, onStateChanged, onQualified }: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [fixTarget, setFixTarget] = useState<Lead | null>(null);
  const [automations, setAutomations] = useState<EmailAutomationSummary[]>([]);
  const [view, setView] = useState<CallOutreachView>(() => {
    const saved = localStorage.getItem(CALL_OUTREACH_VIEW_KEY);
    return saved === 'automation' ? 'automation' : 'board';
  });
  const [industryFilter, setIndustryFilter] = useState(ALL);
  const [cityFilter, setCityFilter] = useState(ALL);
  // Site-built filter: leads arriving from Text Outreach (VoIP numbers that
  // don't take texts) often already have their site — the operator calls
  // those first since the build step is done.
  const [siteFilter, setSiteFilter] = useState(ALL);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [callModalLeadId, setCallModalLeadId] = useState<number | null>(null);
  const [salesFlowLeadId, setSalesFlowLeadId] = useState<number | null>(null);
  const emailCallRecorderRef = useRef<RecordButtonHandle>(null);
  const [emailCallNotes, setEmailCallNotes] = useState('');
  const [emailCallRecordingUrl, setEmailCallRecordingUrl] = useState<string | null>(null);
  const [emailCallRecordingId, setEmailCallRecordingId] = useState<number | null>(null);
  const [buildModalLeadId, setBuildModalLeadId] = useState<number | null>(null);
  const [emailModalLeadId, setEmailModalLeadId] = useState<number | null>(null);
  const [automationLeadId, setAutomationLeadId] = useState<number | null>(null);
  const [startingAutomationId, setStartingAutomationId] = useState<number | null>(null);
  const [viewLeadId, setViewLeadId] = useState<number | null>(null);
  const [qualifyLead, setQualifyLead] = useState<Lead | null>(null);
  const [returnUndo, setReturnUndo] = useState<{
    automationId: number;
    company: string;
    expiresAt: number;
  } | null>(null);

  const openEmailCall = useCallback((leadId: number) => {
    setEmailCallNotes('');
    setEmailCallRecordingUrl(null);
    setEmailCallRecordingId(null);
    setSalesFlowLeadId(null);
    setCallModalLeadId(leadId);
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [leadRes, automationRes] = await Promise.all([
        api.pipeline.list({ channel: 'email' }),
        api.emailOutreach.automations(),
      ]);
      setLeads(leadRes.leads);
      setAutomations(automationRes.automations);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load call board: ${msg}`, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const approveSite = useCallback(async (leadId: number) => {
    try {
      const { lead } = await api.pipeline.approveSite(leadId);
      setLeads((current) => current.map((item) => item.id === lead.id ? lead : item));
      showToast(`${lead.company} approved`, 'success');
      onStateChanged?.();
      void load(true);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not approve site: ${msg}`, 'error');
    }
  }, [load, onStateChanged, showToast]);

  const saveNeedsFix = useCallback(async (lead: Lead, reasons: string[], note: string) => {
    try {
      const { lead: updated } = await api.pipeline.updateSiteReview(lead.id, {
        status: 'needs_fix', reasons, note,
      });
      setLeads((current) => current.map((item) => item.id === updated.id ? updated : item));
      setFixTarget(null);
      showToast(`${lead.company} marked Needs fix`, 'success');
      onStateChanged?.();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      throw new Error(msg);
    }
  }, [onStateChanged, showToast]);

  const columns = useMemo(() => buildColumns(leads, automations), [leads, automations]);

  const filterOptions = useMemo(() => {
    const allItems = columns.flatMap((column) => column.items);
    return {
      industries: uniqueSorted(allItems.map((item) => item.industry).filter(Boolean) as string[]),
      cities: uniqueSorted(allItems.map((item) => formatPlace(item.city, item.state)).filter(Boolean)),
    };
  }, [columns]);

  const filteredColumns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return columns.map((column) => ({
      ...column,
      items: column.items.filter((item) => {
        const searchMatch = !query || [
          item.title, item.email, item.phone, item.industry, item.city, item.state,
        ].some((value) => value?.toLowerCase().includes(query));
        const industryMatch = industryFilter === ALL || item.industry === industryFilter;
        const cityMatch = cityFilter === ALL || formatPlace(item.city, item.state) === cityFilter;
        const hasSite = Boolean(item.siteUrl || item.rawSiteUrl);
        const siteMatch = siteFilter === ALL || (siteFilter === 'built' ? hasSite : !hasSite);
        return searchMatch && industryMatch && cityMatch && siteMatch;
      }),
    }));
  }, [columns, industryFilter, cityFilter, siteFilter, searchQuery]);

  const totalVisible = filteredColumns.reduce((sum, column) => sum + column.items.length, 0);
  const hasFilters = searchQuery.trim().length > 0 || industryFilter !== ALL || cityFilter !== ALL || siteFilter !== ALL;
  const filteredAutomationLeads = useMemo(() => {
    const automatedLeadIds = new Set(automations.map((automation) => automation.lead_id));
    const query = searchQuery.trim().toLowerCase();
    return leads.filter((lead) => {
      const canStartAutomation = Boolean(
        lead.email
        && lead.site_url
        && lead.outcome === 'Email Captured'
        && ['ready_to_send', 'sent_no_reply'].includes(lead.pipeline_status),
      );
      if (!automatedLeadIds.has(lead.id) && !canStartAutomation) return false;
      if (query && ![
        lead.company, lead.contact, lead.email, lead.phone, lead.industry,
        lead.city, lead.state, lead.address,
      ].some((value) => value?.toLowerCase().includes(query))) return false;
      if (industryFilter !== ALL && lead.industry !== industryFilter) return false;
      if (cityFilter !== ALL && formatPlace(lead.city, lead.state) !== cityFilter) return false;
      const hasSite = Boolean(lead.site_url || lead.site_url_raw);
      if (siteFilter !== ALL && (siteFilter === 'built' ? !hasSite : hasSite)) return false;
      return true;
    });
  }, [leads, automations, industryFilter, cityFilter, siteFilter, searchQuery]);

  function setViewPersist(next: CallOutreachView) {
    setView(next);
    localStorage.setItem(CALL_OUTREACH_VIEW_KEY, next);
  }

  async function openAutomationFlow(leadId: number) {
    if (startingAutomationId !== null) return;
    const existing = automations.some((automation) => automation.lead_id === leadId);
    if (!existing) {
      setStartingAutomationId(leadId);
      try {
        await api.emailOutreach.startAutomation(leadId);
        showToast('Email automation scheduled');
        await load(true);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : (error as Error).message;
        showToast(`Could not start automation: ${message}`, 'error');
        setStartingAutomationId(null);
        return;
      }
      setStartingAutomationId(null);
    }
    setAutomationLeadId(leadId);
  }

  if (loading && leads.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-slate-400">
        <Spinner /> Loading Email Outreach…
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search leads…"
              aria-label="Search email outreach leads"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-800 shadow-sm shadow-slate-200/50 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <BoardSelect
            icon={Filter}
            value={industryFilter}
            onChange={setIndustryFilter}
            label="Industry"
            options={filterOptions.industries.map((value) => ({ value, label: industryLabel(value) }))}
          />
          <BoardSelect
            icon={MapPin}
            value={cityFilter}
            onChange={setCityFilter}
            label="City"
            options={filterOptions.cities.map((value) => ({ value, label: value }))}
          />
          <BoardSelect
            icon={Globe}
            value={siteFilter}
            onChange={setSiteFilter}
            label="Sites"
            options={[
              { value: 'built', label: 'Site built' },
              { value: 'none', label: 'No site yet' },
            ]}
          />
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setIndustryFilter(ALL);
                setCityFilter(ALL);
                setSiteFilter(ALL);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm shadow-slate-200/60 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm shadow-slate-200/60 hover:bg-slate-50 disabled:opacity-60"
          >
            {refreshing ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
          <div className="flex shrink-0 gap-0.5 rounded-xl bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setViewPersist('automation')}
              title="Automation view"
              aria-label="Automation view"
              className={`rounded-[10px] p-2 transition ${
                view === 'automation'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewPersist('board')}
              title="Board view"
              aria-label="Board view"
              className={`rounded-[10px] p-2 transition ${
                view === 'board'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Columns3 className="h-4 w-4" />
            </button>
          </div>
      </div>

      {view === 'board' ? (
        <section className="flex items-start gap-3 overflow-x-auto pb-4">
          {filteredColumns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              onOpenLead={openEmailCall}
              onOpenBuild={setBuildModalLeadId}
              onApproveSite={(leadId) => void approveSite(leadId)}
              onNeedsFix={(leadId) => {
                const lead = leads.find((item) => item.id === leadId);
                if (lead) setFixTarget(lead);
              }}
              onOpenEmail={setEmailModalLeadId}
              onOpenAutomation={(leadId) => void openAutomationFlow(leadId)}
              onViewLead={setViewLeadId}
            />
          ))}
        </section>
      ) : (
        <AutomationGrid
          leads={filteredAutomationLeads}
          automations={automations}
          onOpen={setAutomationLeadId}
          onUpdateEmail={openEmailCall}
          onStarted={() => void load(true)}
          showToast={showToast}
        />
      )}

      {view === 'board' && totalVisible === 0 && (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-white/70 py-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
            <Search className="h-6 w-6 text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-slate-700">No cards match those filters</p>
          <p className="mt-1 text-xs text-slate-400">Clear the filters or refresh the board.</p>
        </div>
      )}

      {fixTarget && (
        <SiteReviewFixModal
          leadName={fixTarget.company}
          initialReasons={parseSiteReviewReasons(fixTarget.site_review_reasons)}
          initialNote={fixTarget.site_review_note ?? ''}
          onClose={() => setFixTarget(null)}
          onSave={(reasons, note) => saveNeedsFix(fixTarget, reasons, note)}
        />
      )}

      {automationLeadId !== null && (
        <EmailAutomationModal
          leadId={automationLeadId}
          onClose={() => setAutomationLeadId(null)}
          showToast={showToast}
          onChanged={() => void load(true)}
          onReturned={(automationId, company) => {
            setReturnUndo({ automationId, company, expiresAt: Date.now() + 15_000 });
          }}
        />
      )}

      {returnUndo && (
        <ReturnToCallUndo
          value={returnUndo}
          onExpire={() => setReturnUndo(null)}
          onUndo={async () => {
            try {
              await api.emailOutreach.automationAction(
                returnUndo.automationId,
                'undo_return_to_call',
              );
              setReturnUndo(null);
              showToast(`${returnUndo.company} restored to its previous email workflow`);
              await load(true);
            } catch (error) {
              setReturnUndo(null);
              const message = error instanceof ApiError ? error.message : (error as Error).message;
              showToast(`Could not undo: ${message}`, 'error');
            }
          }}
        />
      )}

      {viewLeadId !== null && (
        <LeadDetailModal
          leadId={viewLeadId}
          onClose={() => setViewLeadId(null)}
          showToast={showToast}
          onLeadUpdated={() => void load(true)}
          onQualify={(lead) => {
            setViewLeadId(null);
            setQualifyLead(lead);
          }}
          pipelineContext
        />
      )}

      <QualifyLeadModal
        open={qualifyLead !== null}
        lead={qualifyLead}
        onClose={() => setQualifyLead(null)}
        showToast={showToast}
        onQualified={(project, tier) => {
          setQualifyLead(null);
          void load(true);
          onStateChanged?.();
          onQualified?.(project, tier);
        }}
      />

      {callModalLeadId !== null && (
        (() => {
          const activeLead = leads.find((lead) => lead.id === callModalLeadId) ?? null;
          const isEngagedEmailLead = salesFlowLeadId === callModalLeadId
            || (activeLead?.pipeline_status === 'engaged' && activeLead.outcome === 'Email Captured');
          return isEngagedEmailLead && activeLead ? (
            <EmailEngagedSalesCall
              lead={activeLead}
              forceSalesFlow={salesFlowLeadId === activeLead.id}
              onClose={() => {
                setSalesFlowLeadId(null);
                setCallModalLeadId(null);
              }}
              showToast={showToast}
              recorderRef={emailCallRecorderRef}
              callNotes={emailCallNotes}
              onCallNotesChange={setEmailCallNotes}
              recordingCallId={emailCallRecordingId}
              onChanged={() => {
                setSalesFlowLeadId(null);
                setCallModalLeadId(null);
                void load(true);
                onStateChanged?.();
              }}
            />
          ) : (
            <CallOutreachModal
              lead={activeLead}
              previousAutomation={
                automations.find((automation) => automation.lead_id === callModalLeadId) ?? null
              }
              onClose={() => setCallModalLeadId(null)}
              showToast={showToast}
              recorderRef={emailCallRecorderRef}
              callNotes={emailCallNotes}
              onCallNotesChange={setEmailCallNotes}
              recordingUrl={emailCallRecordingUrl}
              recordingCallId={emailCallRecordingId}
              onSaved={(emailCaptured, keepOpen = false) => {
                if (emailCaptured && !keepOpen) setCallModalLeadId(null);
                void load(true);
                if (emailCaptured) onStateChanged?.();
              }}
              onAdvanceToSalesFlow={() => setSalesFlowLeadId(activeLead?.id ?? null)}
              onOutcomeRecorded={() => {
                setCallModalLeadId(null);
                void load(true);
                onStateChanged?.();
              }}
            />
          );
        })()
      )}

      {callModalLeadId !== null && (
        <div className="fixed right-16 top-4 z-[230] sm:right-20">
          <RecordButton
            ref={emailCallRecorderRef}
            leadId={callModalLeadId}
            showToast={showToast}
            resetKey={callModalLeadId}
            onRecorded={(url, callId) => {
              setEmailCallRecordingUrl(url);
              setEmailCallRecordingId(callId);
            }}
          />
        </div>
      )}

      {buildModalLeadId !== null && (
        <SiteUrlCaptureModal
          lead={leads.find((lead) => lead.id === buildModalLeadId) ?? null}
          onClose={() => setBuildModalLeadId(null)}
          onSaved={() => {
            setBuildModalLeadId(null);
            void load(true);
            onStateChanged?.();
          }}
        />
      )}

      {emailModalLeadId !== null && (
        <EmailComposerModal
          lead={leads.find((lead) => lead.id === emailModalLeadId) ?? null}
          onClose={() => setEmailModalLeadId(null)}
          showToast={showToast}
          onSent={() => {
            setEmailModalLeadId(null);
            void load(true);
            onStateChanged?.();
          }}
        />
      )}
    </div>
  );
}

function EmailEngagedSalesCall({
  lead,
  forceSalesFlow = false,
  onClose,
  showToast,
  onChanged,
  recorderRef,
  callNotes,
  onCallNotesChange,
  recordingCallId,
}: {
  lead: Lead;
  forceSalesFlow?: boolean;
  onClose: () => void;
  showToast: ShowToast;
  onChanged: () => void;
  recorderRef: RefObject<RecordButtonHandle | null>;
  callNotes: string;
  onCallNotesChange: (value: string) => void;
  recordingCallId: number | null;
}) {
  const pipelineLead: PipelineLead = mapLeadRow(lead);

  async function recordCall(
    activeLead: PipelineLead,
    outcome: 'no_answer' | 'voicemail' | 'busy' | 'talk_later' | 'feedback_only' | 'interested',
    selectedPlan?: SelectedPlan,
    notes?: string,
    recordingCallId?: number,
  ): Promise<boolean> {
    try {
      await api.pipeline.action(activeLead.id, {
        action: 'call_outcome',
        meta: {
          outcome,
          selected_plan: selectedPlan ?? null,
          notes: notes ?? null,
          recording_call_id: recordingCallId ?? null,
          channel: 'email',
        },
      });
      if (outcome !== 'interested') {
        showToast('Call outcome recorded');
        onChanged();
      }
      return true;
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Could not record call', 'error');
      return false;
    }
  }

  async function moveToClients(activeLead: PipelineLead, selectedPlan: SelectedPlan, commitmentTerm: 'ongoing_hosting' | '6_months' | '12_months') {
    const tier: 2 | 3 = selectedPlan === 'Growth' ? 3 : 2;
    try {
      await api.leads.convertToClient(activeLead.id, {
        tier,
        initialStatus: 'prospect',
        clientEmail: lead.email ?? undefined,
        selectedPlan,
        commitmentTerm,
        note: `${selectedPlan} selected during engaged Email Outreach sales call.`,
      });
      showToast(`${activeLead.name} moved to Clients — agreement pending`, 'success');
      onChanged();
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Could not create pending client', 'error');
    }
  }

  async function archiveLead(activeLead: PipelineLead, notes?: string, recordingCallId?: number) {
    if (!window.confirm(`Archive ${activeLead.name} as not interested?`)) return;
    try {
      await api.pipeline.action(activeLead.id, {
        action: 'call_outcome',
        meta: { outcome: 'not_interested', notes: notes ?? null, recording_call_id: recordingCallId ?? null, channel: 'email' },
      });
      await api.pipeline.action(activeLead.id, {
        action: 'archived',
        meta: { reason: 'not_interested_after_email_engagement_call' },
      });
      showToast('Call recorded and lead archived');
      onChanged();
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Could not archive lead', 'error');
    }
  }

  return (
    <OpenSalesCallModal
      lead={pipelineLead}
      initialWarm={forceSalesFlow}
      initialEmailBridge={forceSalesFlow}
      onClose={onClose}
      onCallOutcome={recordCall}
      onMoveToClients={moveToClients}
      onNotInterested={archiveLead}
      showToast={showToast}
      externalRecorderRef={recorderRef}
      externalNotes={callNotes}
      onExternalNotesChange={onCallNotesChange}
      externalRecordingCallId={recordingCallId}
    />
  );
}

function CallOutreachModal({
  lead,
  previousAutomation,
  onClose,
  showToast,
  onSaved,
  onAdvanceToSalesFlow,
  onOutcomeRecorded,
  recorderRef,
  callNotes,
  onCallNotesChange,
  recordingUrl,
  recordingCallId,
}: {
  lead: Lead | null;
  previousAutomation: EmailAutomationSummary | null;
  onClose: () => void;
  showToast: ShowToast;
  onSaved: (emailCaptured: boolean, keepOpen?: boolean) => void;
  onAdvanceToSalesFlow: () => void;
  onOutcomeRecorded: () => void;
  recorderRef: RefObject<RecordButtonHandle | null>;
  callNotes: string;
  onCallNotesChange: (value: string) => void;
  recordingUrl: string | null;
  recordingCallId: number | null;
}) {
  const [email, setEmail] = useState(lead?.email ?? '');
  const [callbackDate, setCallbackDate] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [sendingIntro, setSendingIntro] = useState(false);
  const [recordingOutcome, setRecordingOutcome] = useState<CallOutcome | null>(null);
  const [callHistory, setCallHistory] = useState<CallEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!lead) return;
    let cancelled = false;
    setHistoryLoading(true);
    void api.calls.list(lead.id)
      .then((response) => { if (!cancelled) setCallHistory(response.calls); })
      .catch(() => { if (!cancelled) setCallHistory([]); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [lead?.id]);

  if (!lead) return null;

  const activeLeadId = lead.id;
  const firstName = lead.contact?.trim().split(/\s+/)[0] || 'there';
  const place = formatPlace(lead.city, lead.state);
  const opener = lead.pitch_card_text?.trim()
    || `Hi ${firstName}, this is Shaun. I was looking at ${lead.company}${place ? ` in ${place}` : ''} and had a quick idea that could help you turn more local searches into calls. Did I catch you at a bad time?`;
  const returnedFromAutomation = Boolean(
    previousAutomation
    && (
      lead.outcome?.startsWith('Final Review')
      || lead.outcome === 'Awaiting Final Review'
    ),
  );

  async function saveEmail(keepOpen = false): Promise<boolean> {
    if (!lead) return false;
    const nextEmail = email.trim();
    if (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      showToast('Enter a valid email address', 'error');
      return false;
    }
    setSavingEmail(true);
    try {
      const nextStatus = lead.pipeline_status === 'built_needs_review'
        ? 'built_needs_review'
        : lead.site_url
          ? 'ready_to_send'
          : 'awaiting_build';
      await api.leads.update(lead.id, nextEmail
        ? { email: nextEmail, pipeline_status: nextStatus, outcome: 'Email Captured' }
        : { email: null });
      showToast(
        nextEmail
          ? `Email captured — ${
              nextStatus === 'ready_to_send'
                ? 'moved to Ready to Send'
                : nextStatus === 'built_needs_review'
                  ? 'site still needs review'
                  : 'moved to Awaiting Build'
            }`
          : 'Email removed',
      );
      onSaved(Boolean(nextEmail), keepOpen);
      return true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not save email: ${msg}`, 'error');
      return false;
    } finally {
      setSavingEmail(false);
    }
  }

  async function saveToFollowUp() {
    if (!lead) return;
    const saved = await saveEmail(true);
    if (!saved) return;
    try {
      // Automation can begin only after the operator approves the built site.
      if (lead.site_url && lead.pipeline_status === 'ready_to_send') {
        // Start explicitly so an unsupported/dev-mode recipient produces a
        // truthful error instead of a success toast with no automation row.
        await api.emailOutreach.startAutomation(activeLeadId);
      }
      const savedRecording = await recorderRef.current?.stopAndSave();
      await api.pipeline.action(activeLeadId, {
        action: 'call_outcome',
        meta: {
          outcome: 'review_later',
          notes: callNotes.trim() || null,
          recording_call_id: savedRecording?.callId ?? recordingCallId ?? null,
          channel: 'email',
        },
      });
      showToast(lead.site_url && lead.pipeline_status === 'ready_to_send'
        ? 'Email saved — follow-up queued and call recorded'
        : lead.pipeline_status === 'built_needs_review'
          ? 'Email saved — site still needs review'
          : 'Email saved — awaiting site build and call recorded');
      onSaved(true);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not queue follow-up: ${msg}`, 'error');
    }
  }

  async function advanceToSalesFlow() {
    const nextEmail = email.trim();
    if (!nextEmail) {
      showToast('Capture their email before advancing to the sales flow', 'error');
      return;
    }
    if (nextEmail && nextEmail !== (lead?.email ?? '')) {
      const saved = await saveEmail(true);
      if (!saved) return;
    }
    setSendingIntro(true);
    try {
      const { automation } = await api.emailOutreach.startAutomation(activeLeadId);
      const sendResult = await api.emailOutreach.automationAction(automation.id, 'send_now');
      const result = sendResult.result as { sent?: number; failed?: number } | undefined;
      if (!result || result.sent !== 1) {
        throw new Error(result?.failed ? 'The email provider rejected the send.' : 'No email was sent.');
      }
      showToast('Intro email sent — stay on the call while they open it');
      onAdvanceToSalesFlow();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not send the intro email: ${msg}`, 'error');
    } finally {
      setSendingIntro(false);
    }
  }

  async function recordOutcome(outcome: CallOutcome) {
    if (!lead) return;
    if (outcome === 'callback' && !callbackDate) {
      showToast('Choose a follow-up date first', 'error');
      return;
    }
    setRecordingOutcome(outcome);
    try {
      const savedRecording = await recorderRef.current?.stopAndSave();
      const hot = await api.sessions.hotAdd([lead.id]);
      await api.sessions.outcome(hot.session_id, {
        leadId: lead.id,
        outcome,
        notes: callNotes.trim() || undefined,
        recordingUrl: savedRecording?.url ?? recordingUrl ?? undefined,
        recordingCallId: savedRecording?.callId ?? recordingCallId ?? undefined,
        callbackDate: outcome === 'callback' ? callbackDate : undefined,
        preserveFinalReview: returnedFromAutomation,
      });
      const label = {
        no_answer: 'No answer recorded',
        voicemail: 'Voicemail recorded',
        callback: 'Follow-up scheduled',
        not_interested: 'Lead marked not interested',
        booked: 'Demo booked',
        skipped: 'Lead skipped',
      }[outcome];
      showToast(label);
      onOutcomeRecorded();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not record call: ${msg}`, 'error');
    } finally {
      setRecordingOutcome(null);
    }
  }

  async function archiveLead() {
    if (!previousAutomation || recordingOutcome !== null) return;
    if (!window.confirm('Archive this lead? It will leave the active outreach board.')) return;
    setRecordingOutcome('not_interested');
    try {
      await api.emailOutreach.automationAction(previousAutomation.id, 'archive');
      showToast('Lead archived');
      onOutcomeRecorded();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not archive lead: ${msg}`, 'error');
      setRecordingOutcome(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-slate-900/40 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${returnedFromAutomation ? 'sm:max-w-2xl' : 'sm:max-w-5xl'}`}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">Open call</h2>
            <p className="text-xs text-slate-500">
              {lead.company} · {returnedFromAutomation ? 'Final Review' : 'To Call'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lead.phone ? (
              <a
                href={`tel:${lead.phone}`}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                <PhoneCall className="h-3.5 w-3.5" /> Call {lead.phone}
              </a>
            ) : (
              <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-400">No phone number</span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close call"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 px-5 py-4">
            {returnedFromAutomation && previousAutomation && (
              <ReturnedAutomationAlert
                automation={previousAutomation}
                archiving={recordingOutcome !== null}
                onArchive={() => void archiveLead()}
              />
            )}

            {!returnedFromAutomation && (
              <EmailCaptureSplitScript
                firstName={firstName}
                leadId={lead.id}
                email={email}
                savingEmail={savingEmail}
                lead={lead}
                callHistory={callHistory}
                historyLoading={historyLoading}
                callNotes={callNotes}
                recordingUrl={recordingUrl}
                callbackDate={callbackDate}
                recordingOutcome={recordingOutcome}
                sendingIntro={sendingIntro}
                onEmailChange={setEmail}
                onCallbackDateChange={setCallbackDate}
                onCallNotesChange={onCallNotesChange}
                onSave={() => void saveToFollowUp()}
                onAdvanceToSalesFlow={() => void advanceToSalesFlow()}
                onRecordOutcome={(outcome) => void recordOutcome(outcome)}
              />
            )}

            {returnedFromAutomation && <section className="rounded-xl border border-blue-100 bg-blue-50 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
                <PhoneCall className="h-3.5 w-3.5" />
                After the call, what happened?
              </div>
              <p className="mt-1 text-[11px] text-blue-600">
                Tag the result so this card moves to the correct next step.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <OutcomeButton
                  label="No answer"
                  active={recordingOutcome === 'no_answer'}
                  disabled={recordingOutcome !== null}
                  onClick={() => void recordOutcome('no_answer')}
                />
                <OutcomeButton
                  label="Left voicemail"
                  active={recordingOutcome === 'voicemail'}
                  disabled={recordingOutcome !== null}
                  onClick={() => void recordOutcome('voicemail')}
                />
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  type="date"
                  value={callbackDate}
                  min={localDateIso()}
                  onChange={(event) => setCallbackDate(event.target.value)}
                  className="h-9 rounded-lg border border-blue-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-blue-100"
                  aria-label="Follow-up date"
                />
                <button
                  type="button"
                  onClick={() => void recordOutcome('callback')}
                  disabled={recordingOutcome !== null}
                  className="h-9 rounded-lg border border-amber-200 bg-amber-50 px-3 text-left text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                >
                  {recordingOutcome === 'callback' ? 'Recording…' : 'Follow up later'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => void recordOutcome('not_interested')}
                disabled={recordingOutcome !== null}
                className="mt-2 w-full rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-left text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
              >
                {recordingOutcome === 'not_interested' ? 'Recording…' : 'Not interested — remove from board'}
              </button>
            </section>}

            {returnedFromAutomation && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Suggested opener
                </h3>
                <div className="whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
                  {opener}
                </div>
              </section>
            )}
          </div>

          {returnedFromAutomation && <section className="border-t border-slate-100 px-5 py-4">
            <div className="mb-2 flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-slate-400" />
              <label htmlFor={`call-email-${lead.id}`} className="text-xs font-medium text-slate-500">
                Capture email
              </label>
            </div>
            <div className="flex gap-2">
              <input
                id={`call-email-${lead.id}`}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="owner@business.com"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => void saveEmail()}
                disabled={savingEmail}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {savingEmail ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
                Save
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Saving the email moves this built site to Ready to Send.
            </p>
          </section>}
        </div>

      </div>
    </div>
  );
}

const EMAIL_CAPTURE_RESPONSES = [
  {
    title: 'Why did you build it?',
    body: 'I build examples for businesses that already have a great reputation but don’t have a website that reflects it. I figured it would be more helpful to show you an example than try to describe it over the phone.',
  },
  {
    title: 'They hesitate',
    body: 'No problem at all. I’m not asking you to buy anything today. I simply wanted to show you what I put together and get your honest opinion.',
  },
  {
    title: 'They’re busy',
    body: 'No worries. What’s the best email address to send it to? You can look at it whenever it’s convenient, and if you have any thoughts afterward, just reply to the email or text me.',
  },
  {
    title: 'Calls all the time',
    body: 'I get it! Have you taken a look at any of the sites people have put together for ya?',
  },
] as const;

function EmailCaptureSplitScript({
  firstName,
  leadId,
  email,
  savingEmail,
  lead,
  callHistory,
  historyLoading,
  callNotes,
  recordingUrl,
  callbackDate,
  recordingOutcome,
  sendingIntro,
  onEmailChange,
  onCallbackDateChange,
  onCallNotesChange,
  onSave,
  onAdvanceToSalesFlow,
  onRecordOutcome,
}: {
  firstName: string;
  leadId: number;
  email: string;
  savingEmail: boolean;
  lead: Lead;
  callHistory: CallEntry[];
  historyLoading: boolean;
  callNotes: string;
  recordingUrl: string | null;
  callbackDate: string;
  recordingOutcome: CallOutcome | null;
  sendingIntro: boolean;
  onEmailChange: (value: string) => void;
  onCallbackDateChange: (value: string) => void;
  onCallNotesChange: (value: string) => void;
  onSave: () => void;
  onAdvanceToSalesFlow: () => void;
  onRecordOutcome: (outcome: CallOutcome) => void;
}) {
  const latestCall = callHistory[0] ?? null;

  return (
    <section className="overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="p-5 sm:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Email capture call</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">Create curiosity. Get permission to send.</h3>
          </div>

          <div className="mt-5 border-l-2 border-blue-200 pl-4 sm:pl-5">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Opening</p>
            <div className="text-[17px] leading-8 text-slate-700">
              <p>Hey {firstName}, I know you weren’t expecting my call, so I’ll be quick. I put together a website for your business and wanted to see if you’d be open to taking a look.</p>
            </div>
          </div>

          <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">If they say “No thanks”</p>
            <p className="mt-2 border-l-2 border-blue-200 pl-3 text-[17px] leading-8 text-slate-700">
              Totally fair. Would it be worth a quick look before you rule it out? It’s really just meant to help you look more professional and bring in more business. You might actually like it.
            </p>
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">If they hesitate again</p>
              <p className="mt-1 text-[17px] leading-7 text-slate-700">
                Listen, there’s no cost to take a look. Worst case scenario, you hate it and you tell me to go pound sand. Best case scenario, you like it and we can move forward and turn the cold calls into customer calls.
              </p>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">If they still say no</p>
                <p className="mt-1 text-[17px] leading-7 text-slate-600">No problem at all. Have a good one.</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">If they say yes</p>
                <p className="mt-1 text-[17px] font-semibold leading-7 text-emerald-900">Great, what’s a good email for you?</p>
              </div>
            </div>
          </section>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-slate-500" />
              <label htmlFor={`split-call-email-${leadId}`} className="text-xs font-semibold text-slate-700">Capture email</label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id={`split-call-email-${leadId}`}
                type="email"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && email.trim()) onSave(); }}
                placeholder="owner@business.com"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={onAdvanceToSalesFlow}
                disabled={savingEmail || sendingIntro || !email.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
              >
                {sendingIntro ? <Spinner /> : <PhoneCall className="h-4 w-4" />}
                {sendingIntro ? 'Sending intro email…' : 'Send now and stay on the call'}
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={savingEmail || sendingIntro || !email.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-50"
              >
                {savingEmail ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
                Save and send to follow-up
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-slate-400">
              Follow-up saves the call and queues the normal email workflow. Send now keeps the conversation open and moves to the inbox-and-reaction bridge—not the sales close.
            </p>
          </div>

          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">After they give their email</p>
            <p className="mt-1.5 text-[17px] leading-7 text-emerald-900">Perfect, thank you. I’ll send it over as soon as we hang up. Take a look whenever you have a few minutes, and let me know what stands out—or what you’d change. I’d genuinely appreciate your feedback.</p>
          </div>

          {recordingUrl && (
            <div className="mt-3"><AuthenticatedAudioPlayer url={recordingUrl} /></div>
          )}
        </div>

        <aside className="overflow-visible border-t border-slate-200 bg-slate-50/80 p-4 lg:border-l lg:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Objection responses</p>
          <p className="mt-1 text-[11px] leading-4 text-slate-400">Click a response to see what to say.</p>
          <div className="mt-3 space-y-1.5">
            {EMAIL_CAPTURE_RESPONSES.map((response) => (
              <ScriptResponseDropdown key={response.title} label={response.title} body={response.body} />
            ))}
          </div>

          <div className="mt-2.5 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Call context</p>
                <p className="mt-1 text-xs text-slate-400">Useful details while you’re talking.</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg font-bold leading-none text-slate-900">{lead.google_review_count ?? 0}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Reviews</p>
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <strong>{lead.google_rating != null ? lead.google_rating.toFixed(1) : 'No rating'}</strong>
              <span className="text-amber-700">Google reputation</span>
            </div>

            <div className="mt-3 border-t border-slate-100 pt-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Previous call</p>
              {historyLoading ? (
                <p className="mt-2 text-xs text-slate-400">Loading call history…</p>
              ) : latestCall ? (
                <div className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">{latestCall.outcome}</span>
                    <span className="text-[10px] text-slate-400">{new Date(latestCall.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-4 text-slate-500">{latestCall.notes || 'No notes were recorded.'}</p>
                  {latestCall.recording_url && (
                    <div className="mt-2"><AuthenticatedAudioPlayer url={latestCall.recording_url} compact /></div>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-400">No previous calls recorded.</p>
              )}
            </div>

            {lead.notes && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lead notes</p>
                <p className="mt-1.5 max-h-20 overflow-y-auto whitespace-pre-wrap text-[11px] leading-4 text-slate-500">{lead.notes}</p>
              </div>
            )}

            <div className="mt-2.5 border-t border-slate-100 pt-2.5">
              <label htmlFor={`split-call-notes-${lead.id}`} className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes for this call</label>
              <textarea
                id={`split-call-notes-${lead.id}`}
                value={callNotes}
                onChange={(event) => onCallNotesChange(event.target.value)}
                rows={3}
                placeholder="Add context, concerns, or what to remember next time…"
                className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1.5 text-[10px] leading-4 text-slate-400">Saved with the call when you choose an outcome below.</p>
            </div>
          </div>

          <section className="mt-2.5 rounded-xl border border-blue-100 bg-blue-50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
              <PhoneCall className="h-3.5 w-3.5" />
              After the call, what happened?
            </div>
            <p className="mt-0.5 text-[10px] leading-4 text-blue-600">Tag the result so this card moves to the correct next step.</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <OutcomeButton label="No answer" active={recordingOutcome === 'no_answer'} disabled={recordingOutcome !== null} onClick={() => onRecordOutcome('no_answer')} />
              <OutcomeButton label="Left voicemail" active={recordingOutcome === 'voicemail'} disabled={recordingOutcome !== null} onClick={() => onRecordOutcome('voicemail')} />
            </div>
            <input
              type="date"
              value={callbackDate}
              min={localDateIso()}
              onChange={(event) => onCallbackDateChange(event.target.value)}
              className="mt-2 h-9 w-full rounded-lg border border-blue-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-blue-100"
              aria-label="Follow-up date"
            />
            <button
              type="button"
              onClick={() => onRecordOutcome('callback')}
              disabled={recordingOutcome !== null}
              className="mt-2 w-full rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-left text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              {recordingOutcome === 'callback' ? 'Recording…' : 'Follow up later'}
            </button>
            <button
              type="button"
              onClick={() => onRecordOutcome('not_interested')}
              disabled={recordingOutcome !== null}
              className="mt-2 w-full rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-left text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
            >
              {recordingOutcome === 'not_interested' ? 'Recording…' : 'Not interested — remove from board'}
            </button>
          </section>
        </aside>
      </div>
    </section>
  );
}

function ScriptResponseDropdown({ label, body }: { label: string; body: string }) {
  return (
    <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white open:border-blue-200 open:shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-blue-50 marker:content-none">
        {label}
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <p className="border-t border-slate-100 bg-white px-4 py-3.5 text-[17px] leading-7 text-slate-600">{body}</p>
    </details>
  );
}

function ReturnedAutomationAlert({
  automation,
  archiving,
  onArchive,
}: {
  automation: EmailAutomationSummary;
  archiving: boolean;
  onArchive: () => void;
}) {
  const sends = [
    {
      label: 'Initial email',
      sentAt: automation.initial_sent_at,
      deliveredAt: automation.initial_delivered_at,
      openedAt: automation.initial_opened_at,
      clickedAt: automation.initial_clicked_at,
      status: automation.initial_status,
    },
    {
      label: 'Follow-up',
      sentAt: automation.followup_sent_at,
      deliveredAt: automation.followup_delivered_at,
      openedAt: automation.followup_opened_at,
      clickedAt: automation.followup_clicked_at,
      status: automation.followup_status,
    },
    {
      label: 'Final touch',
      sentAt: automation.final_sent_at,
      deliveredAt: automation.final_delivered_at,
      openedAt: automation.final_opened_at,
      clickedAt: automation.final_clicked_at,
      status: automation.final_status,
    },
  ].filter((send) => send.sentAt || send.status);

  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50 p-3.5">
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-bold text-rose-800">
            Previously in email automation
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-rose-700">
            This lead completed or left email automation and is here for a final call decision.
            The sequence is stopped; do not treat this as a first cold call.
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <AutomationHistoryChip label={`Last step: ${automationStepLabel(automation.current_step)}`} />
            <AutomationHistoryChip label={`Score: ${automation.engagement_score || 0}`} />
            <AutomationHistoryChip label={`${automation.pipeline_sessions || 0} demo session${automation.pipeline_sessions === 1 ? '' : 's'}`} />
          </div>

          {sends.length > 0 ? (
            <div className="mt-3 space-y-2 border-t border-rose-200/80 pt-3">
              {sends.map((send) => {
                const state = send.clickedAt
                  ? 'Clicked'
                  : send.openedAt
                    ? 'Opened'
                    : send.deliveredAt
                      ? 'Delivered'
                      : send.status
                        ? send.status.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())
                        : 'Sent';
                const at = send.clickedAt || send.openedAt || send.deliveredAt || send.sentAt;
                return (
                  <div key={send.label} className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="font-semibold text-rose-800">{send.label}</span>
                    <span className="text-right text-rose-700">
                      {state}{at ? ` · ${formatRelativeTime(at)}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 border-t border-rose-200/80 pt-3 text-[11px] text-rose-700">
              The workflow was started but no email send was recorded.
            </p>
          )}
          <button
            type="button"
            disabled={archiving}
            onClick={onArchive}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5" />
            {archiving ? 'Archiving…' : 'Archive lead'}
          </button>
        </div>
      </div>
    </section>
  );
}

function AutomationHistoryChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-rose-200 bg-white/70 px-2 py-1 text-[10px] font-semibold text-rose-700">
      {label}
    </span>
  );
}

function OutcomeButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-blue-200 bg-white px-2.5 py-2 text-left text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
    >
      {active ? 'Recording…' : label}
    </button>
  );
}

type EmailOutreachAction = 'email_sent' | 'email_followed_up' | 'email_final_touch';

function EmailComposerModal({
  lead,
  onClose,
  showToast,
  onSent,
}: {
  lead: Lead | null;
  onClose: () => void;
  showToast: ShowToast;
  onSent: () => void;
}) {
  const template = lead ? emailTemplateForLead(lead) : null;
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [sending, setSending] = useState(false);

  if (!lead || !template) return null;

  async function sendEmail() {
    if (!lead || !template || sending || !subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      await api.emailOutreach.send(lead.id, {
        subject: subject.trim(),
        text: body.trim(),
        templateKey: `stage_${template.stage}`,
        action: template.action,
      });
      showToast(`${template.activityLabel} sent`);
      onSent();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not send email: ${msg}`, 'error');
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{template.title}</h2>
            <p className="text-xs text-slate-500">{lead.company} · {lead.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close email composer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className={`mb-4 rounded-xl border px-3 py-2.5 text-xs ${template.tone}`}>
            <strong>{template.stageLabel}</strong>
            <p className="mt-1 opacity-80">{template.guidance}</p>
          </div>

          <label className="mb-1.5 block text-xs font-medium text-slate-500">Subject</label>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />

          <label className="mb-1.5 block text-xs font-medium text-slate-500">Email</label>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={14}
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />

          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
              <span className="text-slate-400">↗</span>
              Tracked demo link included
            </div>
            <p className="mt-1 truncate text-[11px] text-slate-400">{template.demoLink}</p>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Agency OS sends this directly through Resend and records delivery activity on the lead.
            Review the recipient, subject, and message before sending.
          </p>
        </div>

        <footer className="border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={() => void sendEmail()}
            disabled={sending || !subject.trim() || !body.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {sending ? 'Sending…' : 'Send email'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function emailTemplateForLead(lead: Lead): {
  action: EmailOutreachAction;
  stage: number;
  title: string;
  stageLabel: string;
  guidance: string;
  tone: string;
  subject: string;
  body: string;
  demoLink: string;
  activityLabel: string;
} {
  const firstName = lead.contact?.trim().split(/\s+/)[0] || 'there';
  const business = lead.company;
  const demoLink = `${TRACKING_BASE}/r/${lead.id}?channel=email`;
  const signature = 'Thanks,\nShaun Gehrke\nShaun Carl Designs';
  const finalTouch = (
    lead.pipeline_status === 'sent_no_reply' && (lead.pipeline_no_reply_step ?? 0) >= 1
  ) || (
    lead.pipeline_status === 'engaged' && (lead.pipeline_followup_step ?? 0) >= 1
  );

  if (lead.pipeline_status === 'ready_to_send') {
    return {
      action: 'email_sent',
      stage: 1,
      title: 'Send intro email',
      stageLabel: 'Email 1 — the website concept',
      guidance: 'Send the promised concept, make no sales ask, and invite an easy reply.',
      tone: 'border-blue-100 bg-blue-50 text-blue-700',
      subject: `I built something for ${business}`,
      body: `Hi ${firstName},

Thanks again for taking a minute to speak with me today.

As promised, I put together a website concept specifically for ${business}. It's not live, and there's no obligation—I simply wanted to show you what your online presence could look like if it matched the reputation you've already built.

You can view it here:

${demoLink}

I'm genuinely curious...

What stood out?

Even if it's just one thing you like—or one thing you'd change—I’d love to hear your thoughts.

${signature}`,
      demoLink,
      activityLabel: 'Initial email',
    };
  }

  if (finalTouch) {
    return {
      action: 'email_final_touch',
      stage: 5,
      title: 'Send final touch',
      stageLabel: 'Final touch — one week later',
      guidance: 'Close the loop respectfully and give them one final path back to the concept.',
      tone: 'border-rose-100 bg-rose-50 text-rose-700',
      subject: 'Should I archive it?',
      body: `Hi ${firstName},

Just wanted to check in one last time before I remove the website concept I built for ${business}.

If now isn't the right time, that's completely okay.

If you'd still like to take a look, here's the link again:

${demoLink}

Either way, thanks for taking a few minutes to talk with me.

Have a great week.

${signature}`,
      demoLink,
      activityLabel: 'Final-touch email',
    };
  }

  if (lead.pipeline_status === 'engaged') {
    const lowEngagement = (lead.engagement_score ?? 0) < 70;
    return lowEngagement ? {
      action: 'email_followed_up',
      stage: 3,
      title: 'Follow up after demo view',
      stageLabel: 'Demo viewed — low engagement',
      guidance: 'They took a quick look. Ask for a first impression without pushing for a decision.',
      tone: 'border-amber-100 bg-amber-50 text-amber-700',
      subject: 'Curious what your first impression was',
      body: `Hi ${firstName},

I noticed you had a chance to take a quick look at the website concept.

I'm curious...

Was there anything that stood out?

Or was there something that immediately made you think,

"I'd want this changed."

I'm always looking to improve these demos, so I'd appreciate the feedback.

${signature}`,
      demoLink,
      activityLabel: 'Demo-view follow-up email',
    } : {
      action: 'email_followed_up',
      stage: 4,
      title: 'Follow up with engaged lead',
      stageLabel: 'Engaged — meaningful site activity',
      guidance: 'They spent time with the concept. Invite feedback and offer a short live walkthrough.',
      tone: 'border-emerald-100 bg-emerald-50 text-emerald-700',
      subject: 'Thoughts on your website concept?',
      body: `Hi ${firstName},

I noticed you've spent a little time looking through the demo site.

I'd love to hear your thoughts.

What did you like?

What would you change?

If you'd like, we can jump on a quick 10-minute screen share and make changes live so you can see exactly how it could work for your business.

No pressure either way—I just enjoy getting feedback.

${signature}`,
      demoLink,
      activityLabel: 'Engaged follow-up email',
    };
  }

  return {
    action: 'email_followed_up',
    stage: 2,
    title: 'Send follow-up email',
    stageLabel: 'Sent — no reply · 24–48 hours',
    guidance: 'Resurface the concept and ask for feedback without asking for a decision.',
    tone: 'border-blue-100 bg-blue-50 text-blue-700',
    subject: 'Just making sure you saw it',
    body: `Hi ${firstName},

Just wanted to make sure the demo site I built for ${business} didn't get buried in your inbox.

Here's the link again:

${demoLink}

I'm not expecting a decision—I’m honestly just curious what you think.

What did you like?

What would you change?

I'd appreciate any feedback.

${signature}`,
    demoLink,
    activityLabel: 'Follow-up email',
  };
}

function SiteUrlCaptureModal({
  lead,
  onClose,
  onSaved,
}: {
  lead: Lead | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [subtitleCopied, setSubtitleCopied] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [briefText, setBriefText] = useState<string | null>(lead?.pipeline_brief ?? null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const leadId = lead?.id;
  const runGenerate = useCallback(async (regenerate: boolean) => {
    if (!leadId) return;
    setBriefLoading(true);
    setBriefError(null);
    try {
      const { lead: updated } = await api.pipeline.generateBrief(leadId, { regenerate });
      setBriefText(updated.pipeline_brief ?? '');
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : 'Brief generation failed';
      setBriefError(msg);
    } finally {
      setBriefLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    if (briefText === null && !briefLoading && !briefError) {
      void runGenerate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!lead) return null;

  async function handleCopy() {
    if (!briefText) return;
    try {
      await navigator.clipboard.writeText(briefText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function handleSubtitleCopy() {
    if (!lead) return;
    try {
      await navigator.clipboard.writeText(lead.company);
      setSubtitleCopied(true);
      setTimeout(() => setSubtitleCopied(false), 1500);
    } catch {
      setSubtitleCopied(false);
    }
  }

  async function handleSave() {
    if (!lead) return;
    const nextUrl = urlInput.trim();
    if (!nextUrl || saving) return;
    setSaving(true);
    setErr(null);
    try {
      await api.pipeline.saveSiteUrl(lead.id, nextUrl);
      setSaved(true);
      setTimeout(onSaved, 700);
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : 'Save failed';
      setErr(msg);
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">Site brief</h2>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              {lead.company}
              <button
                type="button"
                onClick={() => void handleSubtitleCopy()}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Copy business name"
                aria-label="Copy business name"
              >
                {subtitleCopied
                  ? <Check className="h-3 w-3 text-emerald-500" />
                  : <Copy className="h-3 w-3" />}
              </button>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close site URL capture"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4">
            {briefLoading && briefText === null ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-100 bg-slate-50 py-10 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                <div>
                  <p className="text-sm font-medium text-slate-700">Generating brief…</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Claude is drafting from the enrichment data. Usually ~10 seconds — up to a
                    minute or two if we're also pulling the full review set.
                  </p>
                </div>
              </div>
            ) : briefError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-rose-800">Couldn't generate the brief.</p>
                    <p className="mt-0.5 text-xs text-rose-600">{briefError}</p>
                    <button
                      type="button"
                      onClick={() => void runGenerate(true)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/70 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-white"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Try again
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    disabled={!briefText}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-100 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-500" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        Copy brief to clipboard
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runGenerate(true)}
                    disabled={briefLoading}
                    className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                    title="Generate a fresh brief"
                  >
                    {briefLoading
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <RefreshCw className="h-4 w-4" />}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-4 font-sans text-[13px] leading-relaxed text-slate-700">
                  {briefText}
                </pre>
                <p className="mt-3 text-xs text-slate-400">
                  Paste this into landingsite.ai to build the site. Once it's live, drop the URL below —
                  this tags it for tracking and schedules the email automation review window.
                </p>
              </>
            )}
          </div>
        </div>

        <footer className="border-t border-slate-100 px-5 py-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Live site URL</label>
            <div className="flex gap-2">
              <input
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://yourbusiness.landingsite.ai"
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!urlInput.trim() || saving}
                className="shrink-0 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20 disabled:opacity-40 disabled:shadow-none"
              >
                {saved ? <Check className="h-4 w-4" /> : saving ? '…' : 'Save'}
              </button>
            </div>
            {err && <p className="mt-2 text-[11px] text-rose-500">{err}</p>}
            <p className="mt-2 text-[11px] text-slate-400">
              Saving auto-tags the link with UTM + Clarity tracking, moves this lead to "Ready to
              send," and starts a 10-minute automation review window.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

function AutomationGrid({
  leads,
  automations,
  onOpen,
  onUpdateEmail,
  onStarted,
  showToast,
}: {
  leads: Lead[];
  automations: EmailAutomationSummary[];
  onOpen: (leadId: number) => void;
  onUpdateEmail: (leadId: number) => void;
  onStarted: () => void;
  showToast: ShowToast;
}) {
  const automationByLead = useMemo(
    () => new Map(automations.map((automation) => [automation.lead_id, automation])),
    [automations],
  );
  const [startingId, setStartingId] = useState<number | null>(null);

  async function start(lead: Lead) {
    if (startingId !== null) return;
    setStartingId(lead.id);
    try {
      await api.emailOutreach.startAutomation(lead.id);
      showToast(`Automation scheduled for ${lead.company}`);
      onStarted();
      onOpen(lead.id);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : (error as Error).message;
      showToast(`Could not start automation: ${message}`, 'error');
    } finally {
      setStartingId(null);
    }
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 py-14 text-center">
        <Activity className="mx-auto h-7 w-7 text-slate-300" />
        <p className="mt-3 text-sm font-semibold text-slate-700">No email automations yet</p>
        <p className="mt-1 text-xs text-slate-400">
          A lead appears here after both an email and tracked site URL are saved.
        </p>
      </div>
    );
  }

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {leads.map((lead) => {
        const automation = automationByLead.get(lead.id);
        const recipientError = outreachRecipientError(lead.email);
        const score = lead.engagement_score ?? automation?.engagement_score ?? 0;
        const grade = lead.engagement_grade || automation?.engagement_grade || 'nurture';
        const status = automation
          ? isFinalReviewAutomation(automation) ? 'review_required' : automation.status
          : 'not_started';
        return (
          <article
            key={lead.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-slate-900">{lead.company}</h3>
                <p className="mt-0.5 truncate text-xs text-slate-400">{lead.email}</p>
              </div>
              <EngagementScore score={score} grade={grade} />
            </div>

            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Current node
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    {automation
                      ? isFinalReviewAutomation(automation)
                        ? 'Final review required'
                        : automationStepLabel(automation.current_step)
                      : recipientError
                        ? 'Email needs attention'
                        : 'Ready to start'}
                  </p>
                </div>
                <AutomationStatusBadge status={status} />
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {automation
                  ? automationTimingLabel(automation)
                  : recipientError
                    ? recipientError
                    : 'Starts automatically with a 10-minute review window before the first email.'}
              </p>
            </div>

            <AutomationProgress automation={automation} />

            <div className="mt-4 flex gap-2">
              {automation ? (
                <button
                  type="button"
                  onClick={() => onOpen(lead.id)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  <Activity className="h-3.5 w-3.5" />
                  View workflow
                </button>
              ) : recipientError ? (
                <button
                  type="button"
                  onClick={() => onUpdateEmail(lead.id)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Update email
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void start(lead)}
                  disabled={startingId !== null}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {startingId === lead.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Start automation
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function EngagementScore({ score, grade }: { score: number; grade: string }) {
  const tone = score >= 90
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : score >= 70
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : score >= 40
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-slate-200 bg-slate-50 text-slate-500';
  return (
    <div className={`shrink-0 rounded-xl border px-2.5 py-1.5 text-center ${tone}`} title={`Engagement grade: ${grade}`}>
      <div className="text-sm font-bold leading-none">{score}</div>
      <div className="mt-1 text-[9px] font-semibold uppercase tracking-wide">{engagementGradeLabel(grade)}</div>
    </div>
  );
}

function AutomationStatusBadge({ status }: { status: string }) {
  const tone = status === 'active'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'paused'
      ? 'bg-amber-100 text-amber-700'
      : status === 'failed'
        ? 'bg-rose-100 text-rose-700'
        : status === 'review_required'
          ? 'bg-violet-100 text-violet-700'
          : status === 'completed'
          ? 'bg-blue-100 text-blue-700'
          : 'bg-slate-200 text-slate-600';
  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold capitalize ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function AutomationProgress({ automation }: { automation?: EmailAutomationSummary }) {
  const completed = automation
    ? automation.current_step === 'complete'
      ? 5
      : ['review_wait', 'signal_wait', 'final_wait', 'archive_wait'].indexOf(automation.current_step) + 1
    : 0;
  return (
    <div className="mt-4 flex items-center gap-1.5" aria-label={`Automation progress ${completed} of 5`}>
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          className={`h-1.5 flex-1 rounded-full ${
            index < completed ? 'bg-emerald-400' : index === completed ? 'bg-blue-400' : 'bg-slate-100'
          }`}
        />
      ))}
    </div>
  );
}

function EmailAutomationModal({
  leadId,
  onClose,
  showToast,
  onChanged,
  onReturned,
}: {
  leadId: number;
  onClose: () => void;
  showToast: ShowToast;
  onChanged: () => void;
  onReturned: (automationId: number, company: string) => void;
}) {
  const [detail, setDetail] = useState<EmailAutomationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [selectedSendId, setSelectedSendId] = useState<number | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.emailOutreach.automation(leadId);
      setDetail(next);
      setSubject(next.automation.pending_subject || next.nextTemplate?.subject || '');
      setText(next.automation.pending_text || next.nextTemplate?.text || '');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : (error as Error).message;
      showToast(`Could not load automation: ${message}`, 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [leadId, onClose, showToast]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function runAction(
    action:
      | 'pause'
      | 'resume'
      | 'send_now'
      | 'skip'
      | 'stop'
      | 'return_to_call'
      | 'undo_return_to_call'
      | 'extend_review'
      | 'archive',
    successMessage: string,
  ) {
    if (!detail || working) return;
    setWorking(action);
    try {
      await api.emailOutreach.automationAction(detail.automation.id, action);
      showToast(successMessage);
      onChanged();
      if (action === 'return_to_call') {
        onReturned(detail.automation.id, detail.lead.company);
        onClose();
      } else {
        await loadDetail();
      }
    } catch (error) {
      const message = error instanceof ApiError ? error.message : (error as Error).message;
      showToast(`Automation action failed: ${message}`, 'error');
    } finally {
      setWorking(null);
    }
  }

  async function saveEdit() {
    if (!detail || working || !subject.trim() || !text.trim()) return;
    setWorking('edit');
    try {
      await api.emailOutreach.updateScheduledEmail(detail.automation.id, subject, text);
      showToast('Scheduled email updated');
      setEditing(false);
      await loadDetail();
      onChanged();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : (error as Error).message;
      showToast(`Could not update email: ${message}`, 'error');
    } finally {
      setWorking(null);
    }
  }

  const selectedSend = detail?.sends.find((send) => send.id === selectedSendId) ?? null;

  return (
    <div
      className="fixed inset-0 z-[220] flex items-end justify-center bg-slate-900/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[94dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">Email automation</h2>
            <p className="text-xs text-slate-500">
              {detail ? `${detail.lead.company} · ${detail.lead.email}` : 'Loading workflow…'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label="Close automation"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {loading || !detail ? (
          <div className="flex min-h-72 items-center justify-center text-sm text-slate-400">
            <Spinner /> Loading automation…
          </div>
        ) : (
          <>
            <div className="grid min-h-0 flex-1 md:grid-cols-[1fr_280px]">
              <div className="overflow-y-auto px-5 py-5">
                <div className="mb-5 flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-700">
                      {isFinalReviewAutomation(detail.automation)
                        ? 'Final review required'
                        : automationStepLabel(detail.automation.current_step)}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">{automationTimingLabel(detail.automation)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <AutomationStatusBadge
                      status={isFinalReviewAutomation(detail.automation) ? 'review_required' : detail.automation.status}
                    />
                    <EngagementScore
                      score={detail.lead.engagement_score ?? 0}
                      grade={detail.lead.engagement_grade}
                    />
                  </div>
                </div>

                <WorkflowNodes
                  detail={detail}
                  selectedSendId={selectedSendId}
                  onSelectSend={setSelectedSendId}
                />
              </div>

              <aside className="overflow-y-auto border-t border-slate-100 bg-slate-50/70 p-4 md:border-l md:border-t-0">
                {selectedSend ? (
                  <EmailSendInspector send={selectedSend} events={detail.events.filter((event) => event.email_send_id === selectedSend.id)} />
                ) : editing ? (
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-700">Edit scheduled email</h3>
                      <button type="button" onClick={() => setEditing(false)} className="text-[11px] text-slate-400">Cancel</button>
                    </div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Subject</label>
                    <input
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-blue-400"
                    />
                    <label className="mb-1 mt-3 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Email</label>
                    <textarea
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      rows={14}
                      className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-blue-400"
                    />
                    <button
                      type="button"
                      onClick={() => void saveEdit()}
                      disabled={working !== null}
                      className="mt-3 w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {working === 'edit' ? 'Saving…' : 'Save scheduled email'}
                    </button>
                  </div>
                ) : (
                  <AutomationControls
                    detail={detail}
                    working={working}
                    onAction={runAction}
                    onEdit={() => {
                      setSelectedSendId(null);
                      setEditing(true);
                    }}
                  />
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function WorkflowNodes({
  detail,
  selectedSendId,
  onSelectSend,
}: {
  detail: EmailAutomationDetail;
  selectedSendId: number | null;
  onSelectSend: (sendId: number | null) => void;
}) {
  const { automation } = detail;
  const initial = detail.sends.find((send) => send.id === automation.initial_send_id);
  const followup = detail.sends.find((send) => send.id === automation.followup_send_id);
  const final = detail.sends.find((send) => send.id === automation.final_send_id);
  const nodes = [
    {
      key: 'ready',
      title: 'Email captured + site URL saved',
      subtitle: 'Entry conditions satisfied',
      state: 'completed',
      send: null,
    },
    {
      key: 'review',
      title: 'Wait 10 minutes',
      subtitle: initial ? 'Review window completed' : automation.current_step === 'review_wait' ? automationTimingLabel(automation) : 'Skipped',
      state: initial ? 'completed' : automation.current_step === 'review_wait' ? currentNodeState(automation) : 'completed',
      send: null,
    },
    {
      key: 'initial',
      title: 'Send initial email',
      subtitle: initial ? sendStateLabel(initial) : 'Scheduled after review window',
      state: initial ? sendNodeState(initial.status) : automation.current_step === 'review_wait' ? 'upcoming' : currentNodeState(automation),
      send: initial ?? null,
    },
    {
      key: 'signal',
      title: 'Wait 48 hours · check engagement',
      subtitle: automation.branch
        ? automation.branch === 'opened_no_click' ? 'Opened, no demo click' : automation.branch === 'no_open' ? 'No open detected' : 'Demo clicked'
        : automation.current_step === 'signal_wait' ? automationTimingLabel(automation) : 'Checks open and demo-click signals',
      state: followup || automation.branch ? 'completed' : automation.current_step === 'signal_wait' ? currentNodeState(automation) : 'upcoming',
      send: null,
    },
    {
      key: 'followup',
      title: automation.branch === 'opened_no_click' ? 'Send curiosity follow-up' : 'Send new-subject follow-up',
      subtitle: followup ? sendStateLabel(followup) : 'Branch selected from engagement',
      state: followup ? sendNodeState(followup.status) : automation.current_step === 'signal_wait' ? 'upcoming' : automation.current_step === 'complete' && automation.branch === 'demo_clicked' ? 'skipped' : 'upcoming',
      send: followup ?? null,
    },
    {
      key: 'finalwait',
      title: 'Wait 5 days',
      subtitle: automation.current_step === 'final_wait' ? automationTimingLabel(automation) : final ? 'Wait completed' : 'Before final touch',
      state: final ? 'completed' : automation.current_step === 'final_wait' ? currentNodeState(automation) : 'upcoming',
      send: null,
    },
    {
      key: 'final',
      title: 'Final touch',
      subtitle: final ? sendStateLabel(final) : 'Last email before archive',
      state: final ? sendNodeState(final.status) : automation.current_step === 'archive_wait' ? 'completed' : 'upcoming',
      send: final ?? null,
    },
    {
      key: 'archive',
      title: 'Final operator review',
      subtitle: isFinalReviewAutomation(automation)
        ? 'Review required — call, wait longer, stop, or archive manually'
        : automation.status === 'completed'
        ? automation.branch === 'demo_clicked' ? 'Stopped — demo clicked' : 'Sequence completed'
        : automation.current_step === 'archive_wait' ? automationTimingLabel(automation) : 'No automatic archive',
      state: isFinalReviewAutomation(automation)
        ? 'current'
        : automation.status === 'completed'
          ? 'completed'
          : automation.current_step === 'archive_wait'
            ? currentNodeState(automation)
            : 'upcoming',
      send: null,
    },
  ];

  return (
    <div>
      {nodes.map((node, index) => (
        <div key={node.key} className="relative flex gap-3 pb-4 last:pb-0">
          {index < nodes.length - 1 && (
            <span className="absolute left-[15px] top-8 h-[calc(100%-16px)] w-px bg-slate-200" />
          )}
          <WorkflowNodeIcon state={node.state} />
          <button
            type="button"
            onClick={() => node.send && onSelectSend(node.send.id === selectedSendId ? null : node.send.id)}
            disabled={!node.send}
            className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-left ${
              node.send && node.send.id === selectedSendId
                ? 'border-blue-300 bg-blue-50'
                : node.state === 'failed'
                  ? 'border-rose-200 bg-rose-50'
                  : node.state === 'current' || node.state === 'paused'
                    ? 'border-blue-200 bg-blue-50/60'
                    : 'border-slate-100 bg-white'
            } ${node.send ? 'hover:border-blue-200' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">{node.title}</span>
              <span className="text-[10px] font-medium capitalize text-slate-400">{node.state}</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">{node.subtitle}</p>
          </button>
        </div>
      ))}
    </div>
  );
}

function WorkflowNodeIcon({ state }: { state: string }) {
  const cls = state === 'completed'
    ? 'bg-emerald-500 text-white'
    : state === 'failed'
      ? 'bg-rose-500 text-white'
      : state === 'current'
        ? 'bg-blue-600 text-white ring-4 ring-blue-100'
        : state === 'paused'
          ? 'bg-amber-500 text-white ring-4 ring-amber-100'
          : 'border border-slate-200 bg-white text-slate-300';
  return (
    <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cls}`}>
      {state === 'completed'
        ? <Check className="h-4 w-4" />
        : state === 'failed'
          ? <AlertCircle className="h-4 w-4" />
          : state === 'paused'
            ? <Pause className="h-3.5 w-3.5" />
            : <Circle className="h-3 w-3" fill={state === 'current' ? 'currentColor' : 'none'} />}
    </span>
  );
}

function AutomationControls({
  detail,
  working,
  onAction,
  onEdit,
}: {
  detail: EmailAutomationDetail;
  working: string | null;
  onAction: (
    action:
      | 'pause'
      | 'resume'
      | 'send_now'
      | 'skip'
      | 'stop'
      | 'return_to_call'
      | 'undo_return_to_call'
      | 'extend_review'
      | 'archive',
    successMessage: string,
  ) => void;
  onEdit: () => void;
}) {
  const status = detail.automation.status;
  const canRun = status === 'active' || status === 'paused';
  const finalReview = isFinalReviewAutomation(detail.automation);

  if (finalReview) {
    return (
      <div>
        <h3 className="text-xs font-semibold text-slate-700">Final review controls</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          This lead will remain visible until you explicitly choose what happens next.
        </p>
        <div className="mt-4 space-y-2">
          <ControlButton
            icon={Clock}
            label="Review again in 3 days"
            disabled={working !== null}
            onClick={() => onAction('extend_review', 'Final review extended by 3 days')}
          />
          <ControlButton
            icon={Square}
            label="Stop automation · keep lead"
            disabled={working !== null}
            onClick={() => onAction('stop', 'Automation stopped; lead remains in Final Review')}
          />
          <ControlButton
            icon={Archive}
            label="Archive lead"
            disabled={working !== null}
            danger
            onClick={() => {
              if (window.confirm('Archive this lead? It will leave the active outreach board.')) {
                onAction('archive', 'Lead archived');
              }
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-700">Workflow controls</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
        Controls apply only to this lead. No general workflow structure is changed.
      </p>
      <div className="mt-4 space-y-2">
        {status === 'paused' || status === 'stopped' || status === 'failed' ? (
          <ControlButton
            icon={Play}
            label={
              status === 'failed'
                ? 'Retry automation'
                : status === 'stopped'
                  ? 'Restart automation'
                  : 'Resume automation'
            }
            disabled={working !== null}
            onClick={() => onAction(
              'resume',
              status === 'failed'
                ? 'Automation ready to retry'
                : status === 'stopped'
                  ? 'Automation restarted'
                  : 'Automation resumed',
            )}
          />
        ) : (
          <ControlButton icon={Pause} label="Pause automation" disabled={working !== null || status !== 'active'} onClick={() => onAction('pause', 'Automation paused')} />
        )}
        <ControlButton
          icon={SkipForward}
          label={status === 'failed' ? 'Retry and send now' : 'Skip wait & send now'}
          disabled={working !== null || (!canRun && status !== 'failed') || detail.automation.current_step === 'archive_wait'}
          onClick={() => onAction('send_now', 'Wait skipped and next email sent')}
        />
        <ControlButton icon={Pencil} label="Edit scheduled email" disabled={working !== null || !canRun || !detail.nextTemplate} onClick={onEdit} />
        <ControlButton icon={Square} label="Stop sequence" disabled={working !== null || !canRun} onClick={() => onAction('stop', 'Automation stopped')} danger />
        <ControlButton icon={RotateCcw} label="Move to Final Review" disabled={working !== null} onClick={() => onAction('return_to_call', 'Lead moved to Final Review')} />
        <p className="-mt-1 px-1 text-[10px] leading-relaxed text-slate-400">
          Stops this email automation and queues the lead for a final call decision.
        </p>
      </div>
      {detail.automation.last_error && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-700">
          {detail.automation.last_error}
        </div>
      )}
    </div>
  );
}

function ReturnToCallUndo({
  value,
  onUndo,
  onExpire,
}: {
  value: { automationId: number; company: string; expiresAt: number };
  onUndo: () => Promise<void>;
  onExpire: () => void;
}) {
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.ceil((value.expiresAt - Date.now()) / 1000)),
  );
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    const update = () => {
      const remaining = Math.max(0, Math.ceil((value.expiresAt - Date.now()) / 1000));
      setSeconds(remaining);
      if (remaining === 0) onExpire();
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [onExpire, value.expiresAt]);

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex max-w-[min(420px,calc(100vw-2.5rem))] items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-white shadow-2xl">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{value.company} moved to Final Review</p>
        <p className="mt-0.5 text-[10px] text-slate-300">Email and site details were kept.</p>
      </div>
      <button
        type="button"
        disabled={undoing}
        onClick={() => {
          setUndoing(true);
          void onUndo();
        }}
        className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-slate-900 transition hover:bg-blue-50 disabled:opacity-60"
      >
        {undoing ? 'Restoring…' : `Undo · ${seconds}s`}
      </button>
    </div>
  );
}

function ControlButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger = false,
}: {
  icon: typeof Play;
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-lg border bg-white px-3 py-2 text-left text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function EmailSendInspector({
  send,
  events,
}: {
  send: EmailAutomationDetail['sends'][number];
  events: EmailAutomationDetail['events'];
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-700">Email details</h3>
      <dl className="mt-3 space-y-2 text-[11px]">
        <InspectorRow label="Status" value={send.status} />
        <InspectorRow label="Recipient" value={send.recipient} />
        <InspectorRow label="Sent" value={formatDateTime(send.sent_at)} />
        <InspectorRow label="Delivered" value={formatDateTime(send.delivered_at)} />
        <InspectorRow label="Opened" value={formatDateTime(send.opened_at)} />
        <InspectorRow label="Clicked" value={formatDateTime(send.clicked_at)} />
        <InspectorRow label="Provider ID" value={send.provider_message_id || 'Pending'} mono />
      </dl>
      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Subject</p>
        <p className="mt-1 text-xs font-medium text-slate-700">{send.subject}</p>
      </div>
      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Message</p>
        <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-2.5 font-sans text-[11px] leading-relaxed text-slate-600">
          {send.text_body}
        </pre>
      </div>
      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Delivery events</p>
        {events.length === 0 ? (
          <p className="mt-2 text-[11px] text-slate-400">No webhook events received yet.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {events.map((event) => (
              <div key={event.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                <p className="text-[11px] font-medium text-slate-600">{event.event_type}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">{formatDateTime(event.event_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InspectorRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[70px_1fr] gap-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`break-all text-slate-600 ${mono ? 'font-mono text-[9px]' : ''}`}>{value}</dd>
    </div>
  );
}

function automationStepLabel(step: EmailAutomationSummary['current_step']): string {
  if (step === 'review_wait') return 'Review window';
  if (step === 'signal_wait') return 'Waiting for engagement';
  if (step === 'final_wait') return 'Waiting before final touch';
  if (step === 'archive_wait') return 'Waiting to archive';
  return 'Sequence complete';
}

function formatFinalReviewCallback(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `Callback ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

function outreachRecipientError(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase() ?? '';
  const domain = normalized.split('@')[1] ?? '';
  if (!normalized.includes('@') || !domain.includes('.')) {
    return 'Add a valid recipient email before automation can start.';
  }
  if (['example.com', 'example.org', 'example.net', 'test.com'].includes(domain)) {
    return 'Replace the placeholder email before automation can start.';
  }
  if (['gmal.com', 'gmial.com', 'gmai.com', 'gmail.co', 'hotmal.com', 'outlok.com'].includes(domain)) {
    return 'Confirm and correct the likely mistyped email before automation can start.';
  }
  return null;
}

function isFinalReviewAutomation(automation: EmailAutomationSummary): boolean {
  return Boolean(
    (automation.status === 'paused' || automation.status === 'stopped')
    && automation.current_step === 'archive_wait'
    && automation.final_send_id,
  );
}

function automationTimingLabel(automation: EmailAutomationSummary): string {
  if (isFinalReviewAutomation(automation)) return 'Waiting for your decision · this lead will not auto-archive';
  if (automation.status === 'paused') return 'Paused — schedule will resume when you choose';
  if (automation.status === 'failed') return automation.last_error || 'Stopped by a delivery failure';
  if (automation.status === 'completed') return automation.branch === 'demo_clicked'
    ? 'Stopped automatically after demo engagement'
    : 'Automation completed';
  if (automation.status === 'stopped') return 'Stopped manually';
  if (!automation.next_run_at) return 'No next action scheduled';
  const next = new Date(normalizeSqlDate(automation.next_run_at));
  if (Number.isNaN(next.getTime())) return `Scheduled ${automation.next_run_at}`;
  const diff = next.getTime() - Date.now();
  if (diff <= 0) return 'Due now';
  const minutes = Math.ceil(diff / 60_000);
  const relative = minutes < 60
    ? `in ${minutes} min`
    : minutes < 1_440
      ? `in ${Math.ceil(minutes / 60)} hr`
      : `in ${Math.ceil(minutes / 1_440)} days`;
  return `Scheduled ${relative} · ${next.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function currentNodeState(automation: EmailAutomationSummary): string {
  if (automation.status === 'failed') return 'failed';
  if (automation.status === 'paused') return 'paused';
  return 'current';
}

function sendNodeState(status: string): string {
  if (['failed', 'bounced', 'complained', 'suppressed'].includes(status)) return 'failed';
  return 'completed';
}

function sendStateLabel(send: EmailAutomationDetail['sends'][number]): string {
  const timestamp = send.clicked_at || send.opened_at || send.delivered_at || send.sent_at || send.created_at;
  const label = send.clicked_at
    ? 'Clicked'
    : send.opened_at
      ? 'Opened'
    : send.delivered_at
      ? 'Delivered'
      : send.status.charAt(0).toUpperCase() + send.status.slice(1);
  return `${label} · ${formatRelativeTime(timestamp)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Not yet';
  const date = new Date(normalizeSqlDate(value));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', { timeZone: 'America/Chicago' });
}

function normalizeSqlDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
}

function engagementGradeLabel(grade: string): string {
  if (grade === 'hot') return 'Hot';
  if (grade === 'walkthrough') return 'Walkthrough';
  if (grade === 'follow_up') return 'Follow up';
  return 'Nurture';
}

function buildColumns(
  leads: Lead[],
  automations: EmailAutomationSummary[],
): BoardColumn[] {
  const columns: BoardColumn[] = [
    { id: 'awaiting-build', title: 'Awaiting Build', description: 'Site not built—queued for Builder', icon: Mail, tone: 'amber', items: [] },
    { id: 'built-needs-review', title: 'Built Needs Review', description: 'Open and approve the finished site', icon: Eye, tone: 'amber', items: [] },
    { id: 'to-call', title: 'To Call', description: 'Site built—call to capture email', icon: PhoneCall, tone: 'blue', items: [] },
    { id: 'ready-to-send', title: 'Ready to Send', description: 'Site built, email ready next', icon: Send, tone: 'emerald', items: [] },
    { id: 'sent-no-reply', title: 'Sent — No Reply', description: 'Email sent, awaiting response', icon: Clock, tone: 'slate', items: [] },
    { id: 'final-review', title: 'Final Review', description: 'Sequence complete, operator decision needed', icon: AlertCircle, tone: 'amber', items: [] },
    { id: 'engaged', title: 'Engaged', description: 'Replied or showed interest', icon: MessageSquareText, tone: 'rose', items: [] },
  ];
  const byId = Object.fromEntries(columns.map((column) => [column.id, column]));
  const automationByLead = new Map(
    automations.map((automation) => [automation.lead_id, automation]),
  );

  leads.forEach((lead) => {
    if (lead.status === 'not_interested' || lead.pipeline_status === 'archived') {
      return;
    }

    if (lead.phone_route !== 'call') {
      return;
    }

    if (lead.status === 'client' || lead.status === 'qualified' || lead.pipeline_status === 'booked') {
      return;
    }

    const automation = automationByLead.get(lead.id);
    const activeAutomation = Boolean(
      automation
      && ['active', 'paused', 'failed'].includes(automation.status),
    );

    const needsFinalReview = Boolean(
      lead.outcome?.startsWith('Final Review')
      || lead.outcome === 'Awaiting Final Review',
    );

    const hasBuiltSite = Boolean(lead.site_url_raw?.trim() || lead.site_url?.trim());
    const hasUsableEmail = outreachRecipientError(lead.email) === null;

    // The board order is build first, then call only when a finished demo is
    // waiting for an email address. This prevents raw prospects from flooding
    // To Call before the Builder has produced something for the operator to send.
    if (!hasBuiltSite) {
      byId['awaiting-build'].items.push(leadItem(lead, {
        eyebrow: 'Site needed',
        detail: lead.email || lead.phone || 'Outreach prospect',
        note: 'Included in the Builder Employee queue',
        activityLabel: 'Awaiting build',
        tone: 'amber',
        sortAt: lead.updated_at,
        emailOutreachStarted: Boolean(lead.email),
      }));
      return;
    }

    if (lead.pipeline_status === 'built_needs_review') {
      byId['built-needs-review'].items.push(leadItem(lead, {
        eyebrow: 'Review required',
        detail: lead.site_url_raw || lead.site_url || 'Demo site complete',
        note: 'Open the site, confirm it looks right, then approve it',
        activityLabel: 'Built — needs review',
        tone: 'amber',
        sortAt: lead.updated_at,
      }));
      return;
    }

    if (!hasUsableEmail) {
      byId['to-call'].items.push(leadItem(lead, {
        eyebrow: lead.status === 'contacted' ? 'Call again' : 'Site ready',
        detail: lead.site_url_raw || lead.site_url || 'Demo site complete',
        note: 'Call to capture a valid email address for this finished demo',
        activityLabel: lead.last_called_at ? 'Retry call' : 'Ready to call',
        tone: 'blue',
        sortAt: lead.last_called_at ?? lead.updated_at,
      }));
      return;
    }

    if (lead.email && needsFinalReview) {
      byId['final-review'].items.push(leadItem(lead, {
        eyebrow: 'Final review',
        detail: lead.email,
        note: lead.outcome?.startsWith('Final Review')
          ? 'Email sequence complete — decide whether to call, wait, stop, or archive'
          : 'Review scheduled again before any archive decision',
        activityLabel: 'Review required',
        tone: 'amber',
        sortAt: lead.pipeline_last_action_at ?? lead.updated_at,
        emailOutreachStarted: true,
      }));
      return;
    }

    if (activeAutomation && automation && !automation.initial_send_id) {
      byId['ready-to-send'].items.push(leadItem(lead, {
        eyebrow: 'Ready to email',
        detail: lead.site_url_raw || lead.site_url || 'Site build complete',
        note: automation.status === 'failed'
          ? automation.last_error
          : 'Automation begins with a 10-minute review window',
        activityLabel: automation.status === 'failed' ? 'Automation needs attention' : 'Automation ready',
        tone: automation.status === 'failed' ? 'rose' : 'emerald',
        sortAt: automation.updated_at,
        emailOutreachStarted: true,
      }));
      return;
    }

    if (activeAutomation && automation?.initial_send_id) {
      byId['sent-no-reply'].items.push(leadItem(lead, {
        eyebrow: 'Email sent',
        detail: lead.email ?? 'Awaiting reply',
        note: automationTimingLabel(automation),
        activityLabel: 'Automation active',
        tone: 'slate',
        sortAt: automation.updated_at,
        emailOutreachStarted: true,
      }));
      return;
    }

    if (automation?.status === 'stopped' && lead.outcome === 'Automation Stopped') {
      byId['final-review'].items.push(leadItem(lead, {
        eyebrow: 'Final review',
        detail: lead.email ?? 'Email automation stopped',
        note: 'Legacy automation stop — make the final call or archive',
        activityLabel: 'Review required',
        tone: 'amber',
        sortAt: automation.updated_at,
        emailOutreachStarted: true,
      }));
      return;
    }

    // A valid email is enough to enter the build-first email motion. Waiting
    // for a call outcome here meant prospects with an email could not get a
    // demo site until after we called them—the opposite of the outreach plan.
    // Site approval schedules email automation server-side.
    const enteredEmailFlow = hasUsableEmail && hasBuiltSite;
    if (enteredEmailFlow && lead.pipeline_status === 'engaged') {
      byId.engaged.items.push(leadItem(lead, {
        eyebrow: 'Engaged',
        detail: lead.email ?? 'Email contact',
        note: lead.engagement_reasons || lead.notes,
        activityLabel: 'Engaged',
        tone: 'rose',
        sortAt: lead.pipeline_last_action_at ?? lead.updated_at,
        emailOutreachStarted: true,
      }));
      return;
    }

    if (enteredEmailFlow && lead.pipeline_status === 'sent_no_reply') {
      byId['sent-no-reply'].items.push(leadItem(lead, {
        eyebrow: 'Email sent',
        detail: lead.email ?? 'Awaiting reply',
        note: lead.notes,
        activityLabel: 'No reply',
        tone: 'slate',
        sortAt: lead.pipeline_last_action_at ?? lead.updated_at,
        emailOutreachStarted: true,
      }));
      return;
    }

    if (
      enteredEmailFlow
      && lead.pipeline_status === 'ready_to_send'
    ) {
      byId['ready-to-send'].items.push(leadItem(lead, {
        eyebrow: 'Ready to email',
        detail: lead.site_url_raw || lead.site_url || 'Site build complete',
        note: 'Automation begins with a 10-minute review window',
        activityLabel: 'Automation ready',
        tone: 'emerald',
        sortAt: lead.updated_at,
        emailOutreachStarted: true,
      }));
      return;
    }

    // A built site with a valid email but no later-stage status is ready for
    // the email review window; it should never fall backward into To Call.
    byId['ready-to-send'].items.push(leadItem(lead, {
      eyebrow: 'Ready to email',
      detail: lead.site_url_raw || lead.site_url || lead.email || 'Site build complete',
      note: 'Automation begins with a 10-minute review window',
      activityLabel: 'Automation ready',
      tone: 'emerald',
      sortAt: lead.last_called_at ?? lead.updated_at,
      emailOutreachStarted: true,
    }));
  });

  columns.forEach((column) => {
    column.items.sort(bySortAtDesc);
  });
  return columns;
}

function emailBoardActionLabel(columnId: string, item: BoardItem): string {
  if (columnId === 'to-call') return 'Open call';
  if (columnId === 'awaiting-build') return 'Copy brief';
  if (columnId === 'built-needs-review') return 'Approve site';
  if (columnId === 'ready-to-send') {
    return outreachRecipientError(item.email) ? 'Update email' : 'View automation';
  }
  if (columnId === 'sent-no-reply') {
    return 'View automation';
  }
  if (columnId === 'final-review') return 'Call now';
  if (columnId === 'engaged') {
    if (item.engagementScore >= 90) return 'Call immediately';
    if (item.engagementScore >= 70) return 'Call now';
    if (item.followupStep === 1) return 'Send final follow-up';
    return 'Send follow-up';
  }
  return 'Open lead';
}

function leadItem(
  lead: Lead,
  overrides: Pick<BoardItem, 'eyebrow' | 'detail' | 'note' | 'tone' | 'sortAt'> & {
    activityLabel?: string;
    emailOutreachStarted?: boolean;
  }
): BoardItem {
  return {
    id: `${lead.id}-${overrides.eyebrow}`,
    leadId: lead.id,
    title: lead.company,
    email: lead.email,
    phone: lead.phone,
    city: lead.city,
    state: lead.state,
    industry: lead.industry,
    rating: lead.google_rating,
    reviews: lead.google_review_count,
    ageLabel: formatAgeLabel(lead),
    activityLabel: overrides.activityLabel ?? 'Ready',
    outcomeLabel: callOutcomeLabel(lead),
    callbackDate: lead.followup,
    siteUrl: lead.site_url,
    rawSiteUrl: lead.site_url_raw,
    reviewStatus: lead.site_review_status ?? 'pending',
    reviewReasons: parseSiteReviewReasons(lead.site_review_reasons),
    reviewNote: lead.site_review_note,
    clarityTag: lead.clarity_tag,
    sessions: lead.pipeline_sessions ?? 0,
    engagementScore: lead.engagement_score ?? 0,
    engagementGrade: lead.engagement_grade ?? 'nurture',
    noReplyStep: lead.pipeline_no_reply_step ?? 0,
    followupStep: lead.pipeline_followup_step ?? 0,
    emailOutreachStarted: overrides.emailOutreachStarted ?? false,
    lastActionAt: lead.pipeline_last_action_at
      ?? (lead.outcome === 'Email Captured' ? lead.updated_at : null),
    lastAction: emailLastActionLabel(lead),
    pipelineStatus: lead.pipeline_status,
    ...overrides,
  };
}

function KanbanColumn({
  column,
  onOpenLead,
  onOpenBuild,
  onApproveSite,
  onNeedsFix,
  onOpenEmail,
  onOpenAutomation,
  onViewLead,
}: {
  column: BoardColumn;
  onOpenLead: (leadId: number) => void;
  onOpenBuild: (leadId: number) => void;
  onApproveSite: (leadId: number) => void;
  onNeedsFix: (leadId: number) => void;
  onOpenEmail: (leadId: number) => void;
  onOpenAutomation: (leadId: number) => void;
  onViewLead: (leadId: number) => void;
}) {
  const cls = toneClasses(column.tone);
  return (
    <div className="w-72 shrink-0 rounded-2xl bg-slate-100/80 p-2.5">
      <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${cls.solidIconBg}`}>
              <column.icon className="h-3 w-3 text-white" strokeWidth={2.5} />
            </span>
            {column.title}
          </span>
          <p className="mt-0.5 truncate pl-6 text-[11px] text-slate-400">{column.description}</p>
          {column.id === 'built-needs-review' && column.items.length > 0 && (
            <p className="mt-0.5 pl-6 text-[10px] font-medium text-rose-500">
              {column.items.filter((item) => item.reviewStatus === 'needs_fix').length} needs fix · {column.items.filter((item) => item.reviewStatus !== 'needs_fix').length} awaiting review
            </p>
          )}
        </div>
        <span className="text-xs font-medium text-slate-400">
          {column.items.length}
        </span>
      </div>
      <div className="space-y-2">
        {column.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
            No leads
          </div>
        ) : (
          column.items.map((item) => (
            <BoardCard
              key={item.id}
              item={item}
              showCallOutcome={column.id === 'to-call'}
              primaryLabel={
                emailBoardActionLabel(column.id, item)
              }
              onOpen={() => {
                if (column.id === 'to-call') onOpenLead(item.leadId);
                else if (column.id === 'awaiting-build') onOpenBuild(item.leadId);
                else if (column.id === 'built-needs-review') onApproveSite(item.leadId);
                else if (column.id === 'final-review') onOpenLead(item.leadId);
                else if (
                  column.id === 'ready-to-send'
                  && outreachRecipientError(item.email)
                ) onOpenLead(item.leadId);
                else if (
                  column.id === 'ready-to-send'
                  || column.id === 'sent-no-reply'
                ) onOpenAutomation(item.leadId);
                else if (emailBoardActionLabel(column.id, item).startsWith('Call')) onOpenLead(item.leadId);
                else onOpenEmail(item.leadId);
              }}
              onCardOpen={column.id === 'built-needs-review'
                ? () => {
                    const url = cleanSiteUrl(item.rawSiteUrl, item.siteUrl);
                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                  }
                : undefined}
              onViewLead={() => onViewLead(item.leadId)}
              onNeedsFix={column.id === 'built-needs-review' ? () => onNeedsFix(item.leadId) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BoardCard({
  item,
  primaryLabel,
  showCallOutcome,
  onOpen,
  onCardOpen,
  onViewLead,
  onNeedsFix,
}: {
  item: BoardItem;
  primaryLabel: string;
  showCallOutcome: boolean;
  onOpen: () => void;
  onCardOpen?: () => void;
  onViewLead: () => void;
  onNeedsFix?: () => void;
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onCardOpen ?? onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          (onCardOpen ?? onOpen)();
        }
      }}
      className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60 transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 truncate text-sm font-semibold text-slate-900">{item.title}</h4>
        <div className="flex shrink-0 items-center gap-1.5">
          {item.engagementScore > 0 && (
            <CompactEngagementScore score={item.engagementScore} grade={item.engagementGrade} />
          )}
          <EngagementDot sessions={item.sessions} />
        </div>
      </div>

      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-slate-500">
        <span className="truncate">{item.industry ? industryLabel(item.industry) : item.eyebrow}</span>
        <span className="text-slate-300">·</span>
        <RatingSummary rating={item.rating} reviews={item.reviews} />
      </div>

      {item.siteUrl && (
        <div className="mt-2 flex flex-wrap gap-1">
          <a
            href={cleanSiteUrl(item.rawSiteUrl, item.siteUrl) ?? undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            title="Open the site without outreach tracking"
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              item.reviewStatus === 'needs_fix'
                ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800'
                : item.pipelineStatus === 'built_needs_review'
                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800'
            }`}
          >
            {item.reviewStatus === 'needs_fix' ? 'Edit fix note' : item.pipelineStatus === 'built_needs_review' ? 'Review site' : 'Site built'}
          </a>
        </div>
      )}

      {item.pipelineStatus === 'built_needs_review' && item.reviewStatus === 'needs_fix' && (
        <SiteReviewIssueSummary reasons={item.reviewReasons} note={item.reviewNote} />
      )}

      {showCallOutcome && item.outcomeLabel && (
        <div className="mt-2 w-fit rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
          {item.outcomeLabel}
          {item.outcomeLabel === 'Callback requested' && item.callbackDate
            ? ` · ${formatFinalReviewCallback(item.callbackDate)}`
            : ''}
        </div>
      )}

      <EmailSequencePanel item={item} />

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            className="flex w-fit min-w-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-2 py-1 text-xs font-medium text-white shadow-sm shadow-blue-600/20"
          >
            <span className="truncate">{primaryLabel}</span>
            <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2.5} />
          </button>
          {onNeedsFix && (
            <button type="button" onClick={(event) => { event.stopPropagation(); onNeedsFix(); }} className="shrink-0 rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-50">
              {item.reviewStatus === 'needs_fix' ? 'Edit fix note' : 'Needs fix'}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onViewLead();
          }}
          title="View lead"
          aria-label={`View ${item.title}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50 hover:text-blue-700"
        >
          <Eye className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      </div>

      <div className="mt-2">
        <EmailLastTouchIndicator item={item} />
      </div>
    </article>
  );
}

function CompactEngagementScore({ score, grade }: { score: number; grade: string }) {
  const tone = score >= 90
    ? 'bg-rose-50 text-rose-700 ring-rose-200'
    : score >= 70
      ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : score >= 40
        ? 'bg-blue-50 text-blue-700 ring-blue-200'
        : 'bg-slate-50 text-slate-500 ring-slate-200';
  return (
    <span
      title={`Engagement score ${score} · ${engagementGradeLabel(grade)}`}
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${tone}`}
    >
      {score}
    </span>
  );
}

function EngagementDot({ sessions }: { sessions: number }) {
  if (sessions === 0) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        No visits
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-emerald-600">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {sessions} visit{sessions === 1 ? '' : 's'}
    </span>
  );
}

function EmailSequencePanel({ item }: { item: BoardItem }) {
  if (!item.emailOutreachStarted) return null;

  if (item.eyebrow === 'Final review') {
    const callback = item.outcomeLabel === 'Callback requested' && item.callbackDate
      ? ` · ${formatFinalReviewCallback(item.callbackDate)}`
      : '';
    return (
      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-700">
        {item.outcomeLabel || 'Final call needed'}{callback}
      </div>
    );
  }
  if (item.pipelineStatus === 'sent_no_reply') {
    const state =
      item.noReplyStep >= 2
        ? { label: 'Final nudge sent', cls: 'border-rose-200 bg-rose-50 text-rose-700' }
        : item.noReplyStep === 1
          ? { label: 'Follow-up sent', cls: 'border-amber-200 bg-amber-50 text-amber-700' }
          : { label: 'Email sent — awaiting reply', cls: 'border-blue-200 bg-blue-50 text-blue-700' };
    return (
      <div className={`mt-2 rounded-lg border px-2 py-1.5 text-[10px] font-semibold ${state.cls}`}>
        {state.label}
      </div>
    );
  }
  if (item.pipelineStatus === 'engaged' && item.followupStep > 0) {
    const state = item.followupStep >= 2
      ? { label: 'Final follow-up sent', cls: 'border-rose-200 bg-rose-50 text-rose-700' }
      : { label: 'Follow-up sent — awaiting reply', cls: 'border-amber-200 bg-amber-50 text-amber-700' };
    return (
      <div className={`mt-2 rounded-lg border px-2 py-1.5 text-[10px] font-semibold ${state.cls}`}>
        {state.label}
      </div>
    );
  }
  return null;
}

function EmailLastTouchIndicator({ item }: { item: BoardItem }) {
  const followupCount = Math.max(item.followupStep, item.noReplyStep);
  if (!item.emailOutreachStarted || !item.lastActionAt) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-600">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[10px] font-semibold">No outreach yet</span>
              <span className="text-[9px] font-medium">Start sequence</span>
            </div>
            <div className="mt-1 flex gap-0.5">
              {[1, 2, 3, 4].map((segment) => (
                <span key={segment} className="h-1 flex-1 rounded-full bg-white/80" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const ageHours = Math.max(0, Date.now() - new Date(item.lastActionAt).getTime()) / 3_600_000;
  const decay =
    ageHours < 24
      ? { active: 1, pill: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-400' }
      : ageHours < 72
        ? { active: 2, pill: 'border-blue-200 bg-blue-50 text-blue-700', dot: 'bg-blue-500', bar: 'bg-blue-400' }
        : ageHours < 168
          ? { active: 3, pill: 'border-amber-200 bg-amber-50 text-amber-800', dot: 'bg-amber-500', bar: 'bg-amber-400' }
          : { active: 4, pill: 'border-rose-200 bg-rose-50 text-rose-700', dot: 'bg-rose-500', bar: 'bg-rose-400' };

  return (
    <div
      className={`rounded-lg border px-2 py-1.5 ${decay.pill}`}
      title={`Last email outreach activity: ${item.lastAction}`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${decay.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[10px] font-semibold">{item.lastAction}</span>
            <div className="flex shrink-0 items-center gap-1.5">
              {followupCount > 0 && (
                <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[8px] font-semibold">
                  {followupCount} follow-up{followupCount === 1 ? '' : 's'}
                </span>
              )}
              <span className="text-[9px] font-medium">{formatRelativeTime(item.lastActionAt)}</span>
            </div>
          </div>
          <div className="mt-1 flex gap-0.5" aria-label={`Touch decay: ${decay.active} of 4`}>
            {[1, 2, 3, 4].map((segment) => (
              <span
                key={segment}
                className={`h-1 flex-1 rounded-full ${
                  segment <= decay.active ? decay.bar : 'bg-white/80'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function cleanSiteUrl(rawUrl: string | null, taggedUrl: string | null): string | null {
  if (rawUrl) return rawUrl;
  if (!taggedUrl) return null;
  try {
    const url = new URL(taggedUrl);
    url.searchParams.delete('utm_source');
    url.searchParams.delete('utm_medium');
    url.searchParams.delete('utm_campaign');
    return url.toString();
  } catch {
    return taggedUrl.split('?')[0] || taggedUrl;
  }
}

function RatingSummary({ rating, reviews }: { rating: number | null; reviews: number | null }) {
  if (rating === null || reviews === null) return null;
  const rounded = Math.round(rating);
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="inline-flex items-center gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star
            key={i}
            className={`h-3 w-3 ${i < rounded ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}`}
          />
        ))}
      </span>
      <span className="font-medium text-amber-500">{rating.toFixed(1)}</span>
      <span>({reviews})</span>
    </span>
  );
}

function BoardSelect({
  icon: Icon,
  value,
  onChange,
  label,
  options,
}: {
  icon: typeof Filter;
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm shadow-slate-200/60">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-xs font-semibold text-slate-700 outline-none"
      >
        <option value={ALL}>All {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function toneClasses(tone: CardTone) {
  return {
    emerald: { iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', solidIconBg: 'bg-emerald-500', dotBg: 'bg-emerald-500' },
    amber: { iconBg: 'bg-amber-50', iconText: 'text-amber-600', solidIconBg: 'bg-amber-500', dotBg: 'bg-amber-500' },
    blue: { iconBg: 'bg-blue-50', iconText: 'text-blue-600', solidIconBg: 'bg-blue-500', dotBg: 'bg-blue-500' },
    rose: { iconBg: 'bg-rose-50', iconText: 'text-rose-600', solidIconBg: 'bg-rose-500', dotBg: 'bg-rose-500' },
    slate: { iconBg: 'bg-slate-100', iconText: 'text-slate-600', solidIconBg: 'bg-slate-500', dotBg: 'bg-slate-400' },
  }[tone];
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function bySortAtDesc(a: BoardItem, b: BoardItem) {
  return timeOf(b.sortAt) - timeOf(a.sortAt);
}

function timeOf(value: string | null | undefined) {
  return value ? new Date(value).getTime() : 0;
}

function formatPlace(city: string | null | undefined, state: string | null | undefined): string {
  return [city, state].filter(Boolean).join(', ');
}

function formatAgeLabel(lead: Lead): string {
  const label = lead.enrichment_status === 'enriched' ? 'Enriched' : 'Updated';
  return `${label} ${formatRelativeTime(lead.updated_at ?? lead.created_at)}`;
}

function emailLastActionLabel(lead: Lead): string {
  switch (lead.pipeline_last_action) {
    case 'email_captured': return 'Email captured';
    case 'email_sent': return 'Email sent';
    case 'email_followed_up':
      return `Email follow-up #${Math.max(1, lead.pipeline_no_reply_step ?? lead.pipeline_followup_step ?? 1)} sent`;
    case 'email_final_touch': return 'Final email sent';
    case 'brief_generated': return 'Brief generated';
    case 'url_saved': return 'Site URL saved';
    case 'site_approved': return 'Site approved';
    case 'intro_sent': return 'Email sent';
    case 'followed_up':
      return `Email follow-up #${Math.max(1, lead.pipeline_no_reply_step ?? lead.pipeline_followup_step ?? 1)} sent`;
    case 'reply_received': return 'Reply received';
    case 'called': return 'Called';
    case 'call_outcome': return callOutcomeLabel(lead) ?? 'Call outcome recorded';
  }
  if (lead.pipeline_status === 'engaged') return 'Engagement recorded';
  if (lead.pipeline_status === 'sent_no_reply') {
    const step = lead.pipeline_no_reply_step ?? 0;
    return step > 0 ? `Email follow-up #${step} sent` : 'Email sent';
  }
  if (lead.site_url) return 'Site URL saved';
  if (lead.outcome === 'Email Captured') return 'Email captured';
  return 'No outreach yet';
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return 'recently';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 'recently';
  const diffMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 45) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} mo ago`;
}

function localDateIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function callOutcomeLabel(lead: Lead): string | null {
  const raw = [lead.outcome, lead.followup, lead.notes].filter(Boolean).join(' ').toLowerCase();
  if (!raw && !lead.last_called_at) return null;
  if (lead.status === 'not_interested' || raw.includes('not interested')) return 'Not interested';
  if (raw.includes('no answer')) return 'No answer';
  if (raw.includes('voicemail') || raw.includes('vm')) return 'Voicemail left';
  if (raw.includes('callback') || raw.includes('call back') || lead.followup) return 'Callback requested';
  if (raw.includes('owner') || raw.includes('spoke') || raw.includes('conversation')) return 'Spoke with owner';
  if (lead.last_called_at) return 'No answer';
  return null;
}
