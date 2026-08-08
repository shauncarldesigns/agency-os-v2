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

// `date` is YYYY-MM-DD in the operator's timezone; parse parts directly so the
// browser's timezone can't shift the calendar day.
function nextRunLabel(next: NonNullable<ProspectInboxSummary['nextScheduled']>) {
  if (!next.date) return 'No run day scheduled';
  const [year, month, day] = next.date.split('-').map(Number);
  const dayLabel = new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const hour12 = ((next.localRunHour + 11) % 12) + 1;
  return `${dayLabel} at ${hour12}:00 ${next.localRunHour < 12 ? 'AM' : 'PM'}`;
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

        <div className="mt-3 grid gap-2 sm:gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><SearchCheck size={13} /> Last search</div>
            {summary?.lastRun ? (
              <>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {summary.lastRun.industry} · {summary.lastRun.search_location}
                  <span className="ml-2 font-normal text-slate-500">{timeLabel(summary.lastRun.started_at)} · {summary.lastRun.trigger_type === 'scheduled' ? 'auto' : 'manual'}</span>
                </div>
                {summary.lastRun.status === 'failed' ? (
                  <p className="mt-2 text-xs font-medium text-rose-600">Failed: {summary.lastRun.error_message ?? 'unknown error'}</p>
                ) : (
                  <dl className="mt-2 divide-y divide-slate-200/70 text-xs">
                    {[
                      { label: 'Results found', value: summary.lastRun.results_found },
                      { label: 'Already in your leads', value: summary.lastRun.skipped_existing },
                      { label: 'Ineligible (has website / no phone / closed)', value: summary.lastRun.skipped_ineligible },
                      { label: 'Refreshed existing candidates', value: summary.lastRun.refreshed_candidates },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between py-1">
                        <dt className="text-slate-500">{label}</dt>
                        <dd className="font-semibold tabular-nums text-slate-700">{value}</dd>
                      </div>
                    ))}
                    <div className="flex items-center justify-between py-1">
                      <dt className="font-semibold text-slate-800">New candidates</dt>
                      <dd className={`font-bold tabular-nums ${summary.lastRun.new_candidates > 0 ? 'text-emerald-600' : 'text-slate-900'}`}>{summary.lastRun.new_candidates}</dd>
                    </div>
                  </dl>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-500">Not run yet</p>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><CalendarClock size={13} /> Next scheduled search</div>
            {summary?.nextScheduled?.enabled && summary.nextScheduled.industry ? (
              <>
                <div className="mt-1 text-sm font-semibold text-slate-900">{summary.nextScheduled.industry} · {summary.nextScheduled.location}</div>
                <p className="mt-2 text-xs text-slate-500">{nextRunLabel(summary.nextScheduled)}</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-500">
                {summary?.nextScheduled && !summary.nextScheduled.enabled ? 'Schedule disabled — enable it in Settings' : 'No industries or locations configured'}
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
