import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { CallIntelligenceReport } from '../../lib/types';
import { AuthenticatedAudioPlayer } from '../shared/AuthenticatedAudioPlayer';
type Insights = Awaited<ReturnType<typeof api.callIntelligence.insights>>;
export function SalesIntelligencePage() {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const [backfilling, setBackfilling] = useState(false);
  const [retryingCallId, setRetryingCallId] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [expandedCallId, setExpandedCallId] = useState<number | null>(null);
  const [didAutoExpand, setDidAutoExpand] = useState(false);
  const [reports, setReports] = useState<Record<number, CallIntelligenceReport>>({});
  const load = () => api.callIntelligence.insights().then(setData).catch(e => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!data?.jobs.some(job => ['queued', 'transcribing', 'analyzing'].includes(job.status))) return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [data?.jobs]);
  useEffect(() => {
    if (didAutoExpand || !data) return;
    const latest = data.jobs.find(job => job.status === 'completed');
    if (latest) {
      setExpandedCallId(latest.call_id);
      setDidAutoExpand(true);
    }
  }, [data, didAutoExpand]);
  useEffect(() => {
    if (expandedCallId === null || reports[expandedCallId]) return;
    api.calls.intelligenceReport(expandedCallId).then(report => setReports(current => ({ ...current, [expandedCallId]: report }))).catch(() => undefined);
  }, [expandedCallId, reports]);
  if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!data) return <div className="p-6 text-sm text-slate-500">Loading call insights…</div>;
  const total = Number(data.summary?.calls_analyzed || 0);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div><div className="font-semibold text-slate-900">Automatic call processing is on</div><div className="mt-0.5 text-sm text-slate-500">Every new recording enters Sales Intelligence automatically.</div>{notice && <div className="mt-1 text-sm text-blue-700">{notice}</div>}</div>
      <button disabled={backfilling} onClick={async () => { setBackfilling(true); setNotice(''); try { const result = await api.callIntelligence.backfill(); setNotice(result.queued ? `${result.queued} existing recording${result.queued === 1 ? '' : 's'} queued.` : 'All existing recordings are already queued.'); window.setTimeout(() => void load(), 5000); } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not queue existing recordings.'); } finally { setBackfilling(false); } }} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{backfilling ? 'Queuing…' : 'Analyze existing recordings'}</button>
    </div>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div><h3 className="font-semibold text-slate-900">Latest call analyses</h3><p className="mt-0.5 text-sm text-slate-500">Review the transcript and coaching without leaving Sales Intelligence.</p></div>
      <div className="mt-4 space-y-3">{data.jobs.filter(job => job.status === 'completed' && job.analysis).length === 0 ? <div className="py-4 text-sm text-slate-400">No completed analyses yet.</div> : data.jobs.filter(job => job.status === 'completed' && job.analysis).map(job => <div key={job.id} className="overflow-hidden rounded-xl border border-slate-200"><button onClick={() => setExpandedCallId(current => current === job.call_id ? null : job.call_id)} className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left"><div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">{job.company}</span><OutcomeAgreement status={job.outcome_reconciliation.status} /></div><div className="mt-0.5 text-xs text-slate-500">Call #{job.call_id} · operator: {job.outcome} · transcript: {String(job.analysis?.outcome || 'unknown').replaceAll('_', ' ')}</div></div><span className="text-xs font-semibold text-blue-700">{expandedCallId === job.call_id ? 'Hide report' : 'View report'}</span></button>{job.recording_url && <div className="border-t border-slate-200 bg-slate-50 px-4 py-3"><AuthenticatedAudioPlayer url={job.recording_url} compact lazy /></div>}{expandedCallId === job.call_id && <CallAnalysisDetail analysis={job.analysis!} report={reports[job.call_id]} />}</div>)}</div>
    </section>
    {data.directional && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Directional findings only — the sample has {total} analyzed calls. Validate roughly 20 calls before treating patterns as established.</div>}
    <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold text-slate-900">Processing activity</h3><div className="mt-3 space-y-2">{data.jobs.length === 0 ? <div className="py-3 text-sm text-slate-400">No recordings have entered processing yet.</div> : data.jobs.map(job => { const noSpeech = job.error?.includes('no speaker segments') === true; const retrying = retryingCallId === job.call_id || ['queued', 'transcribing', 'analyzing'].includes(job.status); return <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm"><div><div className="font-semibold text-slate-800">{job.company} · call #{job.call_id}</div><div className="mt-0.5 text-xs text-slate-500">{job.outcome} · {noSpeech ? 'no speech detected' : job.status}{job.error && !noSpeech ? ` — ${job.error}` : ''}</div></div>{job.status === 'failed' && !noSpeech && <button disabled={retrying} onClick={async () => { setRetryingCallId(job.call_id); setNotice(''); setData(current => current ? { ...current, jobs: current.jobs.map(row => row.id === job.id ? { ...row, status: 'queued', error: null } : row) } : current); try { await api.calls.retry(job.call_id); setNotice(`${job.company} retry queued.`); await load(); } catch (e) { setNotice(e instanceof Error ? e.message : 'Retry failed.'); await load(); } finally { setRetryingCallId(null); } }} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-60">{retrying ? 'Retrying…' : 'Retry'}</button>}</div>; })}</div></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Calls analyzed', total], ['Not interested', Number(data.summary?.not_interested || 0)], ['Meetings booked', Number(data.summary?.meetings_booked || 0)], ['Sold', Number(data.summary?.sold || 0)]].map(([label,value]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold uppercase text-slate-400">{label}</div><div className="mt-1 text-2xl font-bold text-slate-900">{value}</div></div>)}</div>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold text-slate-900">Outcomes</h3><div className="mt-3">{data.outcomes.map(row => <div key={row.label} className="flex justify-between border-b border-slate-100 py-2 text-sm"><span>{row.label.replaceAll('_',' ')}</span><b>{row.count}</b></div>)}</div></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold text-slate-900">Evidence-backed findings</h3><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="py-2">Type</th><th>Finding</th><th>Reaction</th><th>Support</th><th>Evidence</th></tr></thead><tbody>{data.findings.map((row,i) => <tr key={`${row.fact_type}-${row.category}-${i}`} className="border-t border-slate-100"><td className="py-3">{row.fact_type.replaceAll('_',' ')}</td><td>{row.category}</td><td>{row.reaction || '—'}</td><td>{row.supporting_calls} calls · {row.percentage}%</td><td>{row.quote ? <span>“{row.quote}” [{row.timestamp}] · call #{row.representative_call_id}</span> : '—'}</td></tr>)}</tbody></table></div></section>
  </div>;
}

function OutcomeAgreement({ status }: { status: 'matched'|'mismatch'|'unclear' }) {
  const tone = status === 'matched' ? 'bg-emerald-100 text-emerald-700' : status === 'mismatch' ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>{status === 'matched' ? 'Outcome matched' : status === 'mismatch' ? 'Outcome mismatch' : 'Outcome unclear'}</span>;
}

function CallAnalysisDetail({ analysis, report }: { analysis: Record<string, unknown>; report?: CallIntelligenceReport }) {
  const needs = (analysis.stated_needs as string[] | undefined) ?? [];
  const objections = (analysis.objections as Array<Record<string, unknown>> | undefined) ?? [];
  const improvements = (analysis.improvements as Array<Record<string, unknown>> | undefined) ?? [];
  const scores = (analysis.scores as Record<string, number | null> | undefined) ?? {};
  return <div className="space-y-4 px-4 py-4 text-sm text-slate-700">
    <p className="leading-relaxed">{String(analysis.call_summary || '')}</p>
    <div className="grid gap-3 md:grid-cols-2"><div className="rounded-lg bg-blue-50 p-3"><div className="text-xs font-semibold uppercase text-blue-500">Prospect needs</div><div className="mt-1">{needs.join(', ') || 'No explicit need supported'}</div></div><div className="rounded-lg bg-slate-50 p-3"><div className="text-xs font-semibold uppercase text-slate-400">Recommended next action</div><div className="mt-1">{String(analysis.recommended_next_action || 'None')}</div></div></div>
    {objections.length > 0 && <div><div className="text-xs font-semibold uppercase text-slate-400">Objections</div><div className="mt-2 space-y-2">{objections.map((row, index) => <div key={index} className="rounded-lg border border-slate-100 p-3"><b>{String(row.category || 'Objection')}:</b> {String(row.objection || '')}</div>)}</div></div>}
    {improvements.length > 0 && <div><div className="text-xs font-semibold uppercase text-slate-400">Coaching</div><div className="mt-2 space-y-2">{improvements.map((row, index) => <div key={index} className="rounded-lg border border-amber-100 bg-amber-50 p-3"><div className="font-semibold text-amber-900">{String(row.issue || '')}</div><div className="mt-1 text-amber-800">{String(row.recommended_change || '')}</div>{row.example_language ? <div className="mt-2 italic text-amber-700">“{String(row.example_language)}”</div> : null}</div>)}</div></div>}
    <div><div className="text-xs font-semibold uppercase text-slate-400">Scores</div><div className="mt-2 flex flex-wrap gap-2">{Object.entries(scores).map(([key, value]) => <span key={key} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{key.replaceAll('_', ' ')}: {value ?? 'N/A'}</span>)}</div></div>
    <details open><summary className="cursor-pointer font-semibold text-blue-700">Speaker transcript</summary><pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 font-sans text-xs leading-relaxed text-slate-100">{report?.transcript?.transcript_text || 'Loading transcript…'}</pre></details>
    <details><summary className="cursor-pointer font-semibold text-blue-700">Full structured analysis</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs">{JSON.stringify(analysis, null, 2)}</pre></details>
  </div>;
}
