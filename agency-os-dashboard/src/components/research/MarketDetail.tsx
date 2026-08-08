import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Play, MapPin, Star, Globe, Target, History, Pause, Trash2,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Market, MarketKeyword, MapPackRow, ResearchRun, ShowToast } from '../../lib/types';
import { Spinner } from '../shared/Spinner';

interface MarketDetailProps {
  marketId: number;
  showToast: ShowToast;
  onBack: () => void;
}

interface DetailState {
  market: Market;
  keywords: MarketKeyword[];
  mapPack: Record<string, MapPackRow[]>;
  runs: ResearchRun[];
}

export function MarketDetail({ marketId, showToast, onBack }: MarketDetailProps) {
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.research.market(marketId);
      setDetail(res);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load market: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [marketId, showToast]);

  useEffect(() => { void load(); }, [load]);

  async function run() {
    setRunning(true);
    try {
      const res = await api.research.run(marketId);
      if (res.stoppedEarly) {
        showToast('Research stopped early — Worker request budget exhausted. Keywords may be saved; run again for map packs.', 'error');
      } else if (res.run?.status === 'failed') {
        showToast(res.run.errorDetail ?? 'Research run failed', 'error');
      } else {
        showToast(`Research complete · ${res.run?.keywordsStored ?? 0} keywords · ${res.run?.mapPackRowsStored ?? 0} map pack rows`, 'success');
      }
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Research failed: ${msg}`, 'error');
    } finally {
      setRunning(false);
    }
  }

  async function toggleActive() {
    if (!detail) return;
    setToggling(true);
    try {
      await api.research.updateMarket(marketId, { is_active: detail.market.is_active === 1 ? 0 : 1 });
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not update market: ${msg}`, 'error');
    } finally {
      setToggling(false);
    }
  }

  async function removeMarket() {
    if (!detail) return;
    if (!window.confirm(`Delete ${detail.market.industry} × ${detail.market.location_label}? All keyword and map pack data for this market will be removed.`)) return;
    try {
      await api.research.deleteMarket(marketId);
      showToast('Market deleted', 'success');
      onBack();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Delete failed: ${msg}`, 'error');
    }
  }

  if (loading) return <div className="page-container flex min-h-[300px] items-center justify-center text-sm text-slate-400">Loading market…</div>;
  if (!detail) {
    return (
      <div className="page-container">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">Market could not be loaded.</p>
          <button onClick={onBack} className="mt-3 text-sm font-semibold text-blue-600 hover:underline">Back to markets</button>
        </div>
      </div>
    );
  }

  const { market, keywords, mapPack, runs } = detail;
  const mapPackKeywords = Object.keys(mapPack);

  return (
    <div className="page-container">
      {running && <RunOverlay industry={market.industry} location={market.location_label} />}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Back to markets"><ArrowLeft className="h-4 w-4" /></button>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{market.industry}</h2>
            <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
              <MapPin className="h-3.5 w-3.5" />{market.location_label}
              {market.is_active === 0 && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Paused</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void toggleActive()} disabled={toggling} title={market.is_active === 1 ? 'Pause — skip in batch runs and the monthly refresh' : 'Resume'} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50">
            {market.is_active === 1 ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Resume</>}
          </button>
          <button onClick={() => void removeMarket()} title="Delete market" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-rose-600 shadow-sm hover:bg-rose-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => void run()} disabled={running} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
            {running ? <Spinner /> : <Play className="h-4 w-4" />} {running ? 'Researching…' : 'Run research'}
          </button>
        </div>
      </div>

      {keywords.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <h2 className="text-sm font-semibold text-slate-800">No research yet</h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">Run research to pull keyword volumes and the current map pack for this market. A run takes tens of seconds.</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* Keyword table */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-bold text-slate-900">Keyword demand</h2>
              <p className="mt-0.5 text-xs text-slate-500">{keywords.length} keywords · sorted by monthly volume · numbers from {runs[0]?.provider === 'dataforseo' ? 'DataForSEO' : 'Google Ads'}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Keyword</th>
                    <th className="px-4 py-2.5 text-right">Volume/mo</th>
                    <th className="px-4 py-2.5 text-right">CPC</th>
                    <th className="px-4 py-2.5">Competition</th>
                    <th className="px-4 py-2.5">12-mo trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {keywords.map(row => (
                    <tr key={row.id}>
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-slate-800">{row.keyword}</span>
                        {row.is_near_me === 1 && <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600">near me</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{row.monthly_volume !== null ? row.monthly_volume.toLocaleString() : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-600">{formatCpc(row.cpc_low, row.cpc_high)}</td>
                      <td className="px-4 py-2.5"><CompetitionBadge value={row.competition} index={row.competition_index} /></td>
                      <td className="px-4 py-2.5"><Sparkline trendJson={row.trend_json} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            {/* Map pack panel */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><Target className="h-4 w-4 text-rose-500" /> Map pack — who owns it now</h2>
                <p className="mt-0.5 text-xs text-slate-500">Ranking businesses without a website are your targets.</p>
              </div>
              {mapPackKeywords.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-400">No map pack captured yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {mapPackKeywords.map(keyword => (
                    <div key={keyword} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">“{keyword}”</h3>
                        <span className="text-[11px] text-slate-400">{formatDateTime(mapPack[keyword][0]?.captured_at)}</span>
                      </div>
                      <ol className="mt-2 space-y-1.5">
                        {mapPack[keyword].map(entry => (
                          <li
                            key={entry.id}
                            className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${entry.has_website === 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white'}`}
                          >
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${entry.position <= 3 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>{entry.position}</span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold text-slate-800">{entry.company}</div>
                              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                                {entry.google_rating !== null && (
                                  <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{entry.google_rating.toFixed(1)}</span>
                                )}
                                {entry.review_count !== null && <span>{entry.review_count.toLocaleString()} reviews</span>}
                              </div>
                            </div>
                            {entry.has_website === 0 ? (
                              <span className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">No website</span>
                            ) : (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500"><Globe className="h-3 w-3" /> Has site</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Run history */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><History className="h-4 w-4 text-slate-400" /> Run history</h2>
              </div>
              {runs.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-slate-400">No runs yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {runs.map(entry => (
                    <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                      <RunStatusDot status={entry.status} />
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-slate-700">{formatDateTime(entry.started_at)}</span>
                        <span className="ml-2 text-slate-400">{entry.trigger === 'scheduled' ? 'Scheduled' : 'Manual'} · {entry.keywords_count} keywords</span>
                        {entry.error_detail && <p className="mt-0.5 truncate text-[11px] text-rose-500" title={entry.error_detail}>{entry.error_detail}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Research takes tens of seconds (volume call + polled map pack scrapes) —
 * a stage-aware overlay beats an indefinite spinner. Stages advance on
 * elapsed time, which mirrors the real backend sequencing closely enough
 * to keep the operator oriented.
 */
function RunOverlay({ industry, location }: { industry: string; location: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(e => e + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stages = [
    { at: 0, label: 'Fetching keyword volumes from the provider' },
    { at: 8, label: 'Scraping the live map pack at market coordinates' },
    { at: 45, label: 'Still scraping — Outscraper jobs can take 1–2 minutes' },
  ];
  const current = [...stages].reverse().find(s => elapsed >= s.at) ?? stages[0];

  return (
    <div className="fixed inset-0 z-[95] flex bg-slate-950/45 backdrop-blur-sm">
      <div className="m-auto w-[min(420px,92vw)] rounded-2xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Spinner /></div>
        <h3 className="mt-4 text-sm font-bold text-slate-900">Researching {industry} × {location}</h3>
        <p className="mt-1.5 text-xs text-slate-500">{current.label}…</p>
        <p className="mt-3 text-[11px] text-slate-400">{elapsed}s elapsed · typically finishes within 2 minutes</p>
      </div>
    </div>
  );
}

function CompetitionBadge({ value, index }: { value: string | null; index: number | null }) {
  if (!value) return <span className="text-xs text-slate-400">—</span>;
  const tone = value === 'HIGH' ? 'bg-rose-50 text-rose-600' : value === 'MEDIUM' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {value.charAt(0) + value.slice(1).toLowerCase()}{index !== null && <span className="opacity-60">{index}</span>}
    </span>
  );
}

function RunStatusDot({ status }: { status: string }) {
  const tone = status === 'complete' ? 'bg-emerald-500' : status === 'partial' ? 'bg-amber-500' : status === 'failed' ? 'bg-rose-500' : 'bg-slate-300';
  return <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} title={status} />;
}

/** Compact 12-month seasonality sparkline from the stored trend_json. */
function Sparkline({ trendJson }: { trendJson: string | null }) {
  if (!trendJson) return <span className="text-xs text-slate-300">—</span>;
  let points: Array<{ volume: number }> = [];
  try { points = JSON.parse(trendJson) as Array<{ volume: number }>; } catch { return <span className="text-xs text-slate-300">—</span>; }
  if (!Array.isArray(points) || points.length < 2) return <span className="text-xs text-slate-300">—</span>;

  const width = 96, height = 26, pad = 2;
  const values = points.map(p => Number(p.volume) || 0);
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = Math.max(max - min, 1);
  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="text-blue-500" aria-hidden="true">
      <polyline points={coords.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function formatCpc(low: number | null, high: number | null): string {
  if (low === null && high === null) return '—';
  const fmt = (v: number) => `$${v.toFixed(2)}`;
  if (low !== null && high !== null) return `${fmt(low)}–${fmt(high)}`;
  return fmt((low ?? high)!);
}

function formatDateTime(value: string | undefined): string {
  if (!value) return '';
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
