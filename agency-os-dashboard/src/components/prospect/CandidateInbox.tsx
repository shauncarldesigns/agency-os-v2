import { useMemo } from 'react';
import { CalendarClock, Check, CheckCircle2, Clock3, ExternalLink, Inbox, MapPin, Phone, Play, RotateCw, SearchCheck, Star, Trash2 } from 'lucide-react';
import type { ProspectCandidate, ProspectInboxSummary } from '../../lib/types';
import { googleMapsUrl } from '../../lib/format';
import { Spinner } from '../shared/Spinner';

interface CandidateInboxProps {
  candidates: ProspectCandidate[];
  summary: ProspectInboxSummary | null;
  loading: boolean;
  running: boolean;
  acting: boolean;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onRun: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRefresh: () => void;
}

function timeLabel(value?: string | null) {
  if (!value) return 'Not run yet';
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return 'Not run yet';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Dates are YYYY-MM-DD in the operator's timezone; parse parts directly so the
// browser's timezone can't shift the calendar day.
function runDateLabel(date: string | null) {
  if (!date) return 'Unscheduled';
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function runHourLabel(localRunHour: number) {
  const hour12 = ((localRunHour + 11) % 12) + 1;
  return `${hour12}:00 ${localRunHour < 12 ? 'AM' : 'PM'}`;
}

export function CandidateInbox({
  candidates, summary, loading, running, acting, selected,
  onToggle, onSelectAll, onRun, onApprove, onReject, onRefresh,
}: CandidateInboxProps) {
  const allSelected = candidates.length > 0 && candidates.slice(0, 25).every((candidate) => selected.has(candidate.id));
  const summaryItems = useMemo(() => [
    { label: 'Awaiting review', value: summary?.pending ?? 0, icon: Inbox },
    { label: 'Found today', value: summary?.newToday ?? 0, icon: Clock3 },
    { label: 'Approved this week', value: summary?.approvedThisWeek ?? 0, icon: CheckCircle2 },
  ], [summary]);

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Inbox size={17} /></span>
              <div>
                <h2 className="text-base font-semibold text-slate-950">Prospect inbox</h2>
                <p className="text-xs text-slate-500">Review website-free home-service leads before they enter the pipeline.</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onRefresh} disabled={loading || acting || running} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
              <RotateCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button type="button" onClick={onRun} disabled={running || acting} className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-3.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">
              {running ? <><Spinner /> Searching…</> : <><Play size={14} /> Run discovery now</>}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          {summaryItems.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><Icon size={13} /> <span className="truncate">{label}</span></div>
              <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 grid overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-[1.4fr_1fr]">
          <div className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><SearchCheck size={13} /> Last search</div>
              {summary?.lastRun && (
                <span className="text-xs text-slate-500">
                  {timeLabel(summary.lastRun.started_at)} · {summary.lastRun.trigger_type === 'scheduled' ? 'automatic' : 'manual'}
                </span>
              )}
            </div>
            {!summary?.lastRun ? (
              <p className="mt-3 text-sm text-slate-500">No searches yet — run discovery or wait for the schedule.</p>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-slate-900">{summary.lastRun.industry} · {summary.lastRun.search_location}</span>
                  {summary.lastRun.status !== 'failed' && (
                    <span className={`text-sm font-bold ${summary.lastRun.new_candidates > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                      {summary.lastRun.new_candidates > 0 ? `+${summary.lastRun.new_candidates} new candidate${summary.lastRun.new_candidates === 1 ? '' : 's'}` : 'nothing new'}
                    </span>
                  )}
                </div>
                {summary.lastRun.status === 'failed' ? (
                  <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">Run failed: {summary.lastRun.error_message ?? 'unknown error'}</p>
                ) : (
                  (() => {
                    const run = summary.lastRun;
                    const accounted = run.new_candidates + run.refreshed_candidates + run.skipped_existing + run.skipped_ineligible;
                    const total = Math.max(run.results_found, accounted);
                    const segments = [
                      { label: 'New', value: run.new_candidates, dot: 'bg-emerald-500' },
                      { label: 'Refreshed', value: run.refreshed_candidates, dot: 'bg-blue-500' },
                      { label: 'Already in pipeline', value: run.skipped_existing, dot: 'bg-amber-400' },
                      { label: 'Ineligible — has website, no phone, or closed', value: run.skipped_ineligible, dot: 'bg-slate-300' },
                      { label: 'Not processed', value: total - accounted, dot: 'bg-slate-100' },
                    ].filter((segment) => segment.value > 0);
                    return total === 0 ? (
                      <p className="mt-3 text-xs text-slate-500">Google returned no businesses for this search.</p>
                    ) : (
                      <>
                        <div className="mt-3 flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-slate-100">
                          {segments.map((segment) => (
                            <div key={segment.label} className={segment.dot} style={{ width: `${(segment.value / total) * 100}%` }} title={`${segment.label}: ${segment.value}`} />
                          ))}
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-700">{total} found</span>
                          {segments.map((segment) => (
                            <span key={segment.label} className="inline-flex items-center gap-1.5">
                              <span className={`h-2 w-2 rounded-full ${segment.dot}`} />
                              {segment.label} <span className="font-semibold tabular-nums text-slate-700">{segment.value}</span>
                            </span>
                          ))}
                        </div>
                      </>
                    );
                  })()
                )}
              </>
            )}
          </div>
          <div className="border-t border-slate-200 bg-slate-50/60 p-4 lg:border-l lg:border-t-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><CalendarClock size={13} /> Coming up</div>
              {summary?.schedule?.enabled && summary.schedule.upcoming.some((run) => run.date) && (
                <span className="text-xs text-slate-500">at {runHourLabel(summary.schedule.localRunHour)}</span>
              )}
            </div>
            {summary?.schedule?.enabled && summary.schedule.upcoming.length ? (
              <ul className="mt-2.5 space-y-2">
                {summary.schedule.upcoming.map((run, index) => (
                  <li key={`${run.industry}-${run.location}-${index}`} className="flex items-center gap-2.5">
                    <span className={`w-24 shrink-0 text-xs font-semibold ${index === 0 ? 'text-blue-600' : 'text-slate-500'}`}>{runDateLabel(run.date)}</span>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${index === 0 ? 'bg-blue-500' : 'bg-slate-300'}`} />
                    <span className={`truncate text-xs ${index === 0 ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{run.industry} · {run.location}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                {summary?.schedule && !summary.schedule.enabled ? 'Automatic discovery is off — enable it in Settings.' : 'No industries or locations configured.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {candidates.length > 0 && (
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={allSelected} onChange={onSelectAll} disabled={acting} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
            Select {Math.min(candidates.length, 25)}{candidates.length > 25 ? ' highest-scoring' : ''}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs text-slate-500">{selected.size} selected</span>
            <button type="button" onClick={onReject} disabled={!selected.size || acting} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-rose-200 hover:text-rose-600 disabled:opacity-50"><Trash2 size={13} /> Reject</button>
            <button type="button" onClick={onApprove} disabled={!selected.size || acting} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">{acting ? <Spinner /> : <Check size={13} />} Approve to pipeline</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-slate-500"><Spinner /> Loading inbox…</div>
      ) : candidates.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <CheckCircle2 className="mx-auto text-emerald-500" size={28} />
          <p className="mt-3 text-sm font-semibold text-slate-800">Your prospect inbox is clear</p>
          <p className="mt-1 text-xs text-slate-500">Run discovery now, or enable the schedule in Settings to fill it automatically.</p>
        </div>
      ) : (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3 sm:p-5">
          {candidates.map((candidate) => (
            <article key={candidate.id} className={`relative rounded-xl border p-4 transition ${selected.has(candidate.id) ? 'border-blue-300 bg-blue-50/40 ring-1 ring-blue-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <input aria-label={`Select ${candidate.company}`} type="checkbox" checked={selected.has(candidate.id)} onChange={() => onToggle(candidate.id)} disabled={acting} className="absolute right-4 top-4 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <div className="pr-8">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">No website</span>
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">Tier {candidate.recommended_tier}</span>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-slate-950">{candidate.company}</h3>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><MapPin size={12} /> {[candidate.city, candidate.state].filter(Boolean).join(', ') || candidate.search_location}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600"><Phone size={12} /> {candidate.phone || 'Phone unavailable'}</p>
                <a
                  href={googleMapsUrl(candidate) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 transition hover:text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <MapPin size={12} /> View on Google Maps <ExternalLink size={11} />
                </a>
              </div>
              <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-3">
                <div className="text-[11px] text-slate-500"><span className="font-semibold text-slate-700">{candidate.industry}</span><br />Found {timeLabel(candidate.first_seen_at)}</div>
                <div className="text-right">
                  <div className="text-lg font-semibold leading-none text-slate-900">{candidate.opportunity_score}</div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500"><Star size={10} className="fill-amber-400 text-amber-400" /> {candidate.google_rating ?? '—'} · {candidate.google_review_count ?? 0} reviews</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
