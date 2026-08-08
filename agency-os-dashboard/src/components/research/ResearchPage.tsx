import { useCallback, useEffect, useState } from 'react';
import { Plus, Play, RefreshCw, MapPin } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { MarketListRow, ShowToast } from '../../lib/types';
import { AddMarketModal } from './AddMarketModal';
import { MarketDetail } from './MarketDetail';
import { Spinner } from '../shared/Spinner';

interface ResearchPageProps {
  showToast: ShowToast;
}

/**
 * Market Research — one row per industry × location market. Answers, per
 * market: is there demand here, and who currently owns it.
 */
export function ResearchPage({ showToast }: ResearchPageProps) {
  const [markets, setMarkets] = useState<MarketListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await api.research.markets();
      setMarkets(res.markets);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load markets: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  async function runMarket(id: number) {
    setRunningIds(prev => new Set(prev).add(id));
    try {
      const res = await api.research.run(id);
      if (res.stoppedEarly) {
        showToast('Research stopped early — Worker request budget exhausted. Run again to continue.', 'error');
      } else if (res.run?.status === 'failed') {
        showToast(res.run.errorDetail ?? 'Research run failed', 'error');
      } else {
        const map = res.run?.mapPackRowsStored ?? 0;
        showToast(`Research complete · ${res.run?.keywordsStored ?? 0} keywords · ${map} map pack row${map === 1 ? '' : 's'}${res.run?.status === 'partial' ? ' · some map packs failed' : ''}`, res.run?.status === 'partial' ? 'default' : 'success');
      }
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Research failed: ${msg}`, 'error');
    } finally {
      setRunningIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  async function runAll() {
    setRunningAll(true);
    try {
      const res = await api.research.runAll();
      const failed = res.runs.filter(r => r.status === 'failed').length;
      let message = `Researched ${res.processed} market${res.processed === 1 ? '' : 's'}`;
      if (failed) message += ` · ${failed} failed`;
      if (res.stoppedEarly) message += ` · stopped early, ${res.remainingUnprocessed} remaining`;
      showToast(message, failed || res.stoppedEarly ? 'default' : 'success');
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Batch research failed: ${msg}`, 'error');
    } finally {
      setRunningAll(false);
    }
  }

  if (selectedId !== null) {
    return (
      <MarketDetail
        marketId={selectedId}
        showToast={showToast}
        onBack={() => { setSelectedId(null); void load(); }}
      />
    );
  }

  const activeCount = markets.filter(m => m.is_active === 1).length;

  return (
    <div className="page-container">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Research</h2>
          <p className="mt-1 text-sm text-slate-500">Demand and competition per market — is there search volume here, and who currently owns it.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {markets.length > 0 && (
            <button
              onClick={() => void runAll()}
              disabled={runningAll || activeCount === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {runningAll ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
              {runningAll ? 'Researching…' : `Run all active (${activeCount})`}
            </button>
          )}
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Add market
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[300px] items-center justify-center text-sm text-slate-400">Loading markets…</div>
      ) : markets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500"><MapPin size={22} /></span>
          <h2 className="mt-4 text-sm font-semibold text-slate-800">No markets yet</h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">
            A market is one industry in one city — Plumbing in Green Bay, HVAC in Appleton. Add your first market to pull keyword volume and the current Google map pack.
          </p>
          <button
            onClick={() => setAddOpen(true)}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Add your first market
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Market</th>
                  <th className="px-4 py-3">Top “near me” demand</th>
                  <th className="px-4 py-3">Keywords</th>
                  <th className="px-4 py-3">Last researched</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {markets.map(market => {
                  const running = runningIds.has(market.id);
                  return (
                    <tr
                      key={market.id}
                      onClick={() => setSelectedId(market.id)}
                      className={`cursor-pointer transition hover:bg-slate-50 ${market.is_active === 0 ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900">{market.industry}</div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3 w-3" />{market.location_label}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        {market.headline_volume !== null ? (
                          <div>
                            <span className="text-base font-bold text-slate-900">{market.headline_volume.toLocaleString()}</span>
                            <span className="ml-1 text-xs text-slate-400">/mo</span>
                            {market.headline_keyword && <div className="mt-0.5 text-xs text-slate-500">“{market.headline_keyword}”</div>}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Not researched</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-slate-600">{market.keyword_count || '—'}</td>
                      <td className="px-4 py-3.5 text-xs text-slate-500">
                        {market.last_researched_at ? formatDate(market.last_researched_at) : 'Never'}
                      </td>
                      <td className="px-4 py-3.5">
                        {market.is_active === 0 ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Paused</span>
                        ) : market.last_run_status === 'failed' ? (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">Last run failed</span>
                        ) : market.last_run_status === 'partial' ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600">Partial</span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); void runMarket(market.id); }}
                          disabled={running || runningAll}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {running ? <Spinner /> : <Play className="h-3.5 w-3.5" />}
                          {running ? 'Running…' : 'Run'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AddMarketModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        showToast={showToast}
        onAdded={() => { setAddOpen(false); void load(); }}
      />
    </div>
  );
}

function formatDate(value: string): string {
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
