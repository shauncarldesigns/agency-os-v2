import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Bot, CirclePause, CirclePlay, Copy,
  ChevronDown, ChevronUp, ExternalLink, FileWarning, Loader2,
  RefreshCw, RotateCcw, ShieldCheck, Square, Wifi, WifiOff, X,
} from 'lucide-react';
import { api, ApiError, type BuilderJob, type BuilderStatus } from '../../lib/api';
import type { ShowToast } from '../../lib/types';

const duration = (ms?: number | null) => {
  if (!ms) return '—';
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const sqlDate = (value?: string | null) => value
  ? new Date(/^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(' ', 'T')}Z` : value)
  : null;

const relative = (value?: string | null) => {
  const date = sqlDate(value);
  if (!date || Number.isNaN(date.getTime())) return 'Never';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1_000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3_600)}h ago`;
};

const stamp = (value?: string | null) => {
  const date = sqlDate(value);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
};

const tone: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  building: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  running: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  starting: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  waiting: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  retry: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  skipped: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  paused: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  failed: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  error: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  offline: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  idle: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  stopped: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  login_required: 'bg-amber-50 text-amber-700 ring-amber-600/20',
};

const Badge = ({ value }: { value: string }) => (
  <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset ${tone[value] ?? tone.idle}`}>
    {value.replaceAll('_', ' ')}
  </span>
);

const BUILD_STEPS = [
  'Opening LandingSite.ai', 'Checking login', 'Creating new project', 'Pasting brief',
  'Starting generation', 'Waiting for website', 'Capturing demo URL', 'Saving URL', 'Completing job',
];

const isEligibilitySkip = (job: BuilderJob) => job.failure_reason?.startsWith('Eligibility guard:') ?? false;

function JobRow({ job, showToast }: { job: BuilderJob; showToast: ShowToast }) {
  const [expanded, setExpanded] = useState(false);
  const resultUrl = job.site_url_raw || job.demo_url;
  const displayStatus = isEligibilitySkip(job) ? 'skipped' : job.status;
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    showToast('URL copied');
  };
  return <>
    <tr className="border-t border-slate-100 text-sm">
      <td className="px-4 py-3">
        <button type="button" onClick={() => setExpanded(v => !v)} className="text-left">
          <span className="font-semibold text-slate-900">{job.business_name}</span>
          {job.email && <span className="mt-0.5 block text-xs text-slate-400">{job.email}</span>}
        </button>
      </td>
      <td className="px-4 py-3"><Badge value={displayStatus} /></td>
      <td className="px-4 py-3 text-slate-600">{Math.max(job.attempt_count, 1)}/3</td>
      <td className="px-4 py-3 text-slate-600">{duration(job.duration_ms)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {resultUrl && <>
            <a href={resultUrl} target="_blank" rel="noreferrer" title="Open preview" className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-blue-600"><ExternalLink className="h-3.5 w-3.5" /></a>
            <button type="button" title="Copy preview URL" onClick={() => void copy(resultUrl)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-blue-600"><Copy className="h-3.5 w-3.5" /></button>
          </>}
          {(job.failure_reason || job.artifact_path) && <button type="button" onClick={() => setExpanded(v => !v)} className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50" title="View diagnostics"><FileWarning className="h-3.5 w-3.5" /></button>}
        </div>
      </td>
    </tr>
    {expanded && <tr className="bg-slate-50/80"><td colSpan={5} className="px-4 py-3 text-xs text-slate-600">
      {job.failure_reason && <div><span className="font-semibold text-rose-700">Failure:</span> {job.failure_reason}</div>}
      {job.artifact_path && <div className="mt-1 break-all"><span className="font-semibold">Artifact on Builder host:</span> {job.artifact_path}</div>}
      {job.started_at && <div className="mt-1">Started {stamp(job.started_at)}{job.ended_at ? ` · Ended ${stamp(job.ended_at)}` : ''}</div>}
    </td></tr>}
  </>;
}

export function BuilderStatusPanel({ showToast, onChanged }: { showToast: ShowToast; onChanged: () => void }) {
  const [data, setData] = useState<BuilderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [batchSize, setBatchSize] = useState(20);
  const [excludedLeadIds, setExcludedLeadIds] = useState<Set<number>>(() => new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [preparing, setPreparing] = useState<{ current: number; total: number; company: string } | null>(null);
  const [, setClock] = useState(0);

  const load = useCallback(async (quiet = false, runId = selectedRunId) => {
    try {
      const next = await api.builder.status(runId ?? undefined);
      setData(next);
      setLoadError(null);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not load Builder';
      setLoadError(message);
      if (!quiet) showToast(message, 'error');
    }
  }, [selectedRunId, showToast]);

  useEffect(() => {
    void load(false);
    const poll = window.setInterval(() => void load(true), 5_000);
    const tick = window.setInterval(() => setClock(value => value + 1), 1_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  const counts = useMemo(() => ({
    queued: data?.jobs.filter(job => job.status === 'waiting' || job.status === 'retry').length ?? 0,
    completed: data?.jobs.filter(job => job.status === 'completed').length ?? 0,
    failed: data?.jobs.filter(job => job.status === 'failed' && !isEligibilitySkip(job)).length ?? 0,
    skipped: data?.jobs.filter(isEligibilitySkip).length ?? 0,
    building: data?.jobs.find(job => job.status === 'building'),
  }), [data]);

  const act = async (action: 'start' | 'pause' | 'resume' | 'stop' | 'retry' | 'resumeBuild') => {
    if (busy || !data) return;
    setBusy(true);
    try {
      if (action === 'start') {
        setSelectedRunId(null);
        const selectedBatch = data.nextBatchLeads.slice(0, batchSize).filter(lead => !excludedLeadIds.has(lead.id));
        if (!selectedBatch.length) throw new Error('Select at least one lead for this Builder batch.');
        const missing = selectedBatch.filter(lead => !lead.has_brief);
        for (let index = 0; index < missing.length; index++) {
          const lead = missing[index];
          setPreparing({ current: index + 1, total: missing.length, company: lead.company });
          await api.pipeline.generateBrief(lead.id);
        }
        setPreparing(null);
        const result = await api.builder.start(selectedBatch.map(lead => lead.id), batchSize);
        setExcludedLeadIds(new Set());
        showToast(`Builder batch started — ${result.queued} queued`, 'success');
      } else if (action === 'retry') {
        const result = await api.builder.retryFailed(data.run?.id);
        showToast(`${result.retried} failed build${result.retried === 1 ? '' : 's'} queued`, 'success');
      } else if (action === 'resumeBuild') {
        const result = await api.builder.resumeStuck();
        showToast(`Resuming ${result.businessName} from its open LandingSite project`, 'success');
      } else {
        await api.builder.control(action);
      }
      await load(false, null);
      onChanged();
    } catch (error) {
      setPreparing(null);
      showToast(error instanceof ApiError ? error.message : 'Builder action failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="page-container"><p className="text-sm text-slate-500">Loading Builder Employee…</p></div>;

  const effectiveState = data.control.effective_state;
  const employeeState = effectiveState === 'building' ? 'running' : effectiveState;
  const batchCandidates = data.nextBatchLeads.slice(0, batchSize);
  const selectedBatch = batchCandidates.filter(lead => !excludedLeadIds.has(lead.id));
  const nextBatchCount = selectedBatch.length;
  const nextBatchMissingBriefs = selectedBatch.filter(lead => !lead.has_brief).length;
  const removedBatchCount = batchCandidates.length - nextBatchCount;
  const remaining = counts.queued + (counts.building ? 1 : 0);
  const completed = counts.completed;
  const total = data.run?.total_jobs ?? data.jobs.length;
  const progress = total ? Math.round(((completed + counts.failed + counts.skipped) / total) * 100) : 0;
  const currentStepIndex = Math.max(0, BUILD_STEPS.findIndex(step => data.control.current_step?.toLowerCase().includes(step.toLowerCase())));
  const currentProgress = data.control.current_step ? Math.max(8, Math.round(((currentStepIndex + 1) / BUILD_STEPS.length) * 100)) : 0;
  const elapsed = counts.building?.started_at ? Date.now() - (sqlDate(counts.building.started_at)?.getTime() ?? Date.now()) : null;
  const startBlockedReason = data.control.active_run_id
    ? 'A Builder run is already active.'
    : data.awaitingBuild === 0
      ? 'No eligible leads are awaiting a website build.'
      : nextBatchCount === 0
        ? 'Select at least one lead for this Builder batch.'
      : !data.health.workerOnline
        ? 'Start the Builder worker before beginning a run.'
        : !data.health.landingSiteAuthenticated
          ? 'Sign in to LandingSite.ai before beginning a run.'
          : null;

  return <div className="page-container space-y-5">
    {loadError && <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><span><AlertTriangle className="mr-2 inline h-4 w-4" />{loadError}</span><button type="button" onClick={() => void load(false)} className="font-semibold">Retry</button></div>}

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex items-start gap-3">
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${data.health.workerOnline ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}><Bot /></span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Builder Employee</p>
            <div className="mt-1 flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold text-slate-900">{data.health.workerOnline ? 'Online' : 'Offline'}</h2><Badge value={employeeState} /></div>
            <p className="mt-1 text-xs text-slate-500">Last heartbeat {relative(data.control.last_worker_seen_at)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!data.control.active_run_id && <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            <span className="font-medium">Batch</span>
            <select value={batchSize} disabled={busy} onChange={event => setBatchSize(Number(event.target.value))} className="bg-transparent font-semibold text-slate-900 outline-none">
              <option value={20}>20 sites</option>
              <option value={40}>40 sites</option>
              <option value={60}>60 sites</option>
            </select>
          </label>}
          {!data.control.active_run_id && <button disabled={busy || !!startBlockedReason} onClick={() => void act('start')} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
            {preparing ? <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" /> : <CirclePlay className="mr-1.5 inline h-4 w-4" />}
            {preparing ? `Preparing ${preparing.current}/${preparing.total}` : nextBatchMissingBriefs ? `Prepare ${nextBatchMissingBriefs} Brief${nextBatchMissingBriefs === 1 ? '' : 's'} & Start ${nextBatchCount}` : `Start ${nextBatchCount}-Site Batch`}
          </button>}
          {!!data.control.active_run_id && !data.control.paused && <button disabled={busy} onClick={() => void act('pause')} className="rounded-xl border px-4 py-2 text-sm font-medium"><CirclePause className="mr-1.5 inline h-4 w-4" />Pause after current</button>}
          {!!data.control.active_run_id && !!data.control.paused && <button disabled={busy} onClick={() => void act('resume')} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"><CirclePlay className="mr-1.5 inline h-4 w-4" />Resume</button>}
          {!!data.control.active_run_id && <button disabled={busy} onClick={() => void act('stop')} className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-medium text-rose-700"><Square className="mr-1.5 inline h-4 w-4" />Stop after current</button>}
          {counts.failed > 0 && <button disabled={busy} onClick={() => void act('retry')} className="rounded-xl border px-4 py-2 text-sm font-medium"><RotateCcw className="mr-1.5 inline h-4 w-4" />Retry Failed</button>}
          <button type="button" disabled={busy} onClick={() => void load(false)} className="rounded-xl border border-slate-200 p-2.5 text-slate-500" title="Refresh"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>
      {preparing && <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">Generating the LandingSite brief for <strong>{preparing.company}</strong>. The Builder will start after every missing brief is ready.</div>}
      {!preparing && !data.control.active_run_id && data.awaitingBuild > batchSize && <p className="mt-3 text-xs text-slate-500">This run will process {batchSize} of {data.awaitingBuild} awaiting leads. The remaining {data.awaitingBuild - batchSize} stay in Awaiting Build for the next batch.</p>}
      {!preparing && startBlockedReason && !data.control.active_run_id && <p className="mt-4 text-sm text-slate-500">{startBlockedReason}</p>}
      {!data.health.workerOnline && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle className="mr-2 inline h-4 w-4" />
        The browser employee normally starts automatically when the Builder Mac signs in. If it remains offline, open Terminal in <code className="rounded bg-amber-100 px-1 py-0.5">builder-worker</code> and run <code className="rounded bg-amber-100 px-1 py-0.5">npm run service:restart</code>.
      </div>}
      {data.control.effective_state === 'login_required' && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4" />LandingSite.ai login required. Sign in in the Builder browser; processing resumes automatically.</div>}
      {data.control.worker_message && data.control.effective_state !== 'login_required' && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{data.control.worker_message}</div>}
    </section>

    {!data.control.active_run_id && batchCandidates.length > 0 && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button type="button" aria-expanded={batchOpen} onClick={() => setBatchOpen(value => !value)} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-slate-50">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><CirclePlay className="h-4 w-4" /></span>
          <div className="min-w-0"><h3 className="text-sm font-semibold text-slate-900">Next batch</h3><p className="truncate text-xs text-slate-500">{nextBatchCount} selected · {nextBatchMissingBriefs} brief{nextBatchMissingBriefs === 1 ? '' : 's'} needed{removedBatchCount ? ` · ${removedBatchCount} removed` : ''}</p></div>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">{batchOpen ? 'Hide' : 'Manage'}{batchOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {batchOpen && <div className="border-t border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-5 py-2.5 text-xs text-slate-500"><span>Remove any lead you do not want in this run. Eligibility is checked again before building.</span>{removedBatchCount > 0 && <button type="button" disabled={busy} onClick={() => setExcludedLeadIds(new Set())} className="font-semibold text-blue-700 hover:text-blue-800">Restore all</button>}</div>
        <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {selectedBatch.map(lead => <div key={lead.id} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-slate-50">
            <div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">{lead.company}</p><p className="truncate text-xs text-slate-500">Lead #{lead.id} · {lead.crm_status.replaceAll('_',' ')} · {lead.phone_route ?? 'route unknown'}{lead.email ? ` · ${lead.email}` : ''}</p></div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${lead.has_brief ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{lead.has_brief ? 'Brief ready' : 'Brief needed'}</span>
            <button type="button" disabled={busy} title={`Remove ${lead.company} from this batch`} onClick={() => setExcludedLeadIds(current => new Set(current).add(lead.id))} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600"><X className="h-4 w-4" /></button>
          </div>)}
          {!selectedBatch.length && <div className="px-5 py-8 text-center text-sm text-slate-500">No leads selected. Restore the batch to continue.</div>}
        </div>
      </div>}
    </section>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: 'Agency OS API', good: data.health.apiConnected, text: data.health.apiConnected ? 'Connected' : 'Unavailable' },
        { label: 'Browser Worker', good: data.health.workerOnline, text: data.health.workerOnline ? 'Connected' : 'Offline' },
        { label: 'LandingSite Session', good: data.health.landingSiteAuthenticated, text: data.health.landingSiteAuthenticated ? 'Authenticated' : 'Login required' },
        { label: 'Build Readiness', good: data.awaitingBuild === data.readyToQueue, text: data.awaitingBuild === data.readyToQueue ? `${data.readyToQueue} ready` : `${data.readyToQueue} ready · ${data.missingBriefLeads.length} need briefs` },
      ].map(item => <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{item.label}</p>{item.good ? <ShieldCheck className="h-4 w-4 text-emerald-500" /> : <WifiOff className="h-4 w-4 text-rose-500" />}</div><p className={`mt-2 text-sm font-semibold ${item.good ? 'text-slate-800' : 'text-rose-700'}`}>{item.text}</p></div>)}
    </section>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {[
        ['Awaiting Build', data.awaitingBuild], ['Ready to Queue', data.readyToQueue], ['Queued', counts.queued], ['Completed', counts.completed],
        ['Failed', counts.failed], ['Safety Skipped', counts.skipped], ['Remaining', remaining], ['Average Build', duration(data.metrics.averageMs)], ['Median Build', duration(data.metrics.medianMs)],
        ['Completed 24h', data.metrics.completedToday], ['Failed 24h', data.metrics.failedToday],
      ].map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p></div>)}
    </section>

    {data.safetyExcluded.length > 0 && <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white">
      <button type="button" aria-expanded={safetyOpen} onClick={() => setSafetyOpen(value => !value)} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-amber-50/50">
        <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><ShieldCheck className="h-4 w-4" /></span><div><h3 className="text-sm font-semibold text-slate-900">Safety exclusions</h3><p className="text-xs text-slate-500">{data.safetyExcluded.length} protected lead{data.safetyExcluded.length === 1 ? '' : 's'} blocked from the Builder</p></div></div>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800">{safetyOpen ? 'Hide details' : 'View details'}{safetyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {safetyOpen && <div className="border-t border-amber-200">
        <p className="bg-amber-50/50 px-5 py-2.5 text-xs text-amber-900">These records still say Awaiting Build, but CRM, demo, project, website, or saved-URL state takes precedence.</p>
        <div className="max-h-72 divide-y divide-amber-100 overflow-y-auto">
          {data.safetyExcluded.map(lead => <div key={lead.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"><div><span className="font-semibold text-slate-900">{lead.company}</span><span className="ml-2 text-xs text-slate-500">Lead #{lead.id} · {lead.crmStatus.replaceAll('_', ' ')}</span></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">{lead.reason}</span></div>)}
        </div>
      </div>}
    </section>}

    {(data.control.active_run_id || counts.building) && <section className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-500">Currently Building</p><h3 className="mt-1 text-xl font-semibold text-slate-900">{counts.building?.business_name ?? 'Waiting for next website'}</h3><p className="mt-1 text-sm text-slate-600">{data.control.current_step ?? 'Waiting for browser worker'}</p></div>
        <div className="text-right"><p className="text-xs uppercase tracking-wide text-slate-400">Elapsed</p><p className="mt-1 text-lg font-semibold text-slate-800">{duration(elapsed)}</p><p className="text-xs text-slate-400">Attempt {counts.building?.attempt_count ?? 0}/3</p></div>
      </div>
      {data.resume.canResume && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm text-amber-900"><strong>This build appears interrupted.</strong> Resume reuses the project already open in LandingSite.ai and does not create another website.</p>
        <button type="button" disabled={busy} onClick={() => void act('resumeBuild')} className="shrink-0 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"><RotateCcw className="mr-1.5 inline h-4 w-4" />Resume build</button>
      </div>}
      <div className="mt-5"><div className="mb-1.5 flex justify-between text-xs text-slate-500"><span>Current website</span><span>{currentProgress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${currentProgress}%` }} /></div></div>
      <div className="mt-4"><div className="mb-1.5 flex justify-between text-xs text-slate-500"><span>Run #{data.run?.id}</span><span>{progress}% · {completed + counts.failed}/{total}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div></div>
      {data.control.stop_requested === 1 && <p className="mt-4 text-sm font-medium text-amber-700">Safe stop requested—the active website will finish before the queue stops.</p>}
    </section>}

    {selectedRunId && selectedRunId !== data.control.active_run_id && <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800"><span>Viewing historical run #{selectedRunId}</span><button type="button" className="font-semibold" onClick={() => { setSelectedRunId(null); void load(false, null); }}>Return to latest run</button></div>}

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h3 className="font-semibold text-slate-900">Run queue and results</h3><p className="text-xs text-slate-500">Click a company to see timestamps and diagnostic details.</p></div><Badge value={data.run?.status ?? 'idle'} /></div>
      {data.jobs.length ? <div className="overflow-x-auto"><table className="min-w-full"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-400"><tr><th className="px-4 py-3">Lead</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Attempt</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3">Result</th></tr></thead><tbody>{data.jobs.map(job => <JobRow key={job.id} job={job} showToast={showToast} />)}</tbody></table></div>
        : <div className="px-5 py-10 text-center text-sm text-slate-500">No jobs in this run.</div>}
    </section>

    <section className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4"><h3 className="font-semibold text-slate-900">Live activity</h3><p className="text-xs text-slate-500">State changes reported by the browser employee.</p></div>
        <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
          {data.events.length ? data.events.map(event => <div key={event.id} className="flex gap-3 px-5 py-3"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${event.state === 'failed' || event.state === 'error' ? 'bg-rose-500' : event.state === 'completed' ? 'bg-emerald-500' : 'bg-blue-500'}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{event.step || event.event_type.replaceAll('_', ' ')}</p><time className="text-xs text-slate-400">{stamp(event.created_at)}</time></div>{event.business_name && <p className="text-xs font-medium text-slate-500">{event.business_name}</p>}{event.message && <p className="mt-0.5 break-words text-xs text-slate-500">{event.message}</p>}</div></div>)
            : <div className="px-5 py-10 text-center text-sm text-slate-500">Activity will appear when a run starts.</div>}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4"><h3 className="font-semibold text-slate-900">Run history</h3><p className="text-xs text-slate-500">Latest 12 Builder runs.</p></div>
        <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
          {data.runHistory.map(run => <button type="button" key={run.id} onClick={() => { setSelectedRunId(run.id); void load(false, run.id); }} className={`block w-full px-5 py-3 text-left hover:bg-slate-50 ${selectedRunId === run.id ? 'bg-indigo-50' : ''}`}><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-800">Run #{run.id}</span><Badge value={run.status} /></div><p className="mt-1 text-xs text-slate-500">{stamp(run.started_at)} · {run.completed_jobs} completed · {run.failed_jobs} failed</p><p className="mt-0.5 text-xs text-slate-400">Average {duration(run.average_ms)}</p></button>)}
          {!data.runHistory.length && <div className="px-5 py-10 text-center text-sm text-slate-500">No prior runs.</div>}
        </div>
      </div>
    </section>

    <p className="flex items-center gap-1.5 text-xs text-slate-400"><Wifi className="h-3.5 w-3.5" />Auto-refreshes every 5 seconds. Metrics use the last 100 completed builds; “today” covers the last 24 hours.</p>
  </div>;
}
