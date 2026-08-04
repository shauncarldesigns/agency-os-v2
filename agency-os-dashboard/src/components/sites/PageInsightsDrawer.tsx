import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, ExternalLink, FileText, LoaderCircle, Sparkles, TrendingDown, TrendingUp, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Brief, PageInsights, ShowToast } from '../../lib/types';

export function PageInsightsDrawer({ pageId, showToast, onClose, onOpenBrief }: {
  pageId: number | null;
  showToast: ShowToast;
  onClose: () => void;
  onOpenBrief: (brief: Brief) => void;
}) {
  const [data, setData] = useState<PageInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyItemId, setBusyItemId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (pageId == null) return;
    setLoading(true);
    try { setData(await api.pages.insights(pageId)); }
    catch (err) { showToast(`Could not load page insights: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error'); onClose(); }
    finally { setLoading(false); }
  }, [onClose, pageId, showToast]);

  useEffect(() => { void load(); }, [load]);

  const openItems = useMemo(() => data?.work_items.filter((item) => item.category !== 'created' && item.status !== 'complete') ?? [], [data]);
  const current = data?.metrics_history[0] ?? null;

  async function openBrief(briefId: number) {
    try { onOpenBrief(await api.briefs.get(briefId)); }
    catch (err) { showToast(`Could not open brief: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error'); }
  }

  async function prepareUpdate(itemId: number, briefId: number | null) {
    setBusyItemId(itemId);
    try {
      const brief = briefId ? await api.briefs.get(briefId) : (await api.projects.growthCycles.generateItemBrief(itemId)).brief;
      if (!briefId) await load();
      onOpenBrief(brief);
    } catch (err) { showToast(`Could not prepare update brief: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error'); }
    finally { setBusyItemId(null); }
  }

  if (pageId == null) return null;
  const pageTitle = data?.page.title || [data?.page.service, data?.page.city].filter(Boolean).join(' in ') || 'Page insights';

  return <>
    <button type="button" className="fixed inset-0 z-[209] bg-slate-950/30 backdrop-blur-[1px]" aria-label="Close page insights" onClick={onClose} />
    <aside className="fixed inset-y-0 right-0 z-[210] flex w-full max-w-[520px] flex-col border-l border-slate-200 bg-white shadow-2xl" role="dialog" aria-label={`Page insights for ${pageTitle}`}>
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
        <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Page insights</p><h2 className="mt-1 truncate text-xl font-semibold text-slate-900">{pageTitle}</h2>{data?.page.published_url && <p className="mt-1 truncate text-xs text-slate-400">{data.page.published_url}</p>}</div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && !data ? <div className="flex h-48 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading page analytics…</div> : data && <div className="space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><BarChart3 className="h-4 w-4 text-blue-600" /> Search performance</h3>{current && <span className="text-xs text-slate-400">{periodLabel(current.period)}</span>}</div>
            {current ? <div className="grid grid-cols-2 gap-3">
              <Metric label="Average position" value={current.position == null ? '—' : current.position.toFixed(1)} delta={current.positionChange} reverse />
              <Metric label="Impressions" value={formatNumber(current.impressions)} delta={current.impressionsChange} />
              <Metric label="Clicks" value={formatNumber(current.clicks)} />
              <Metric label="Click-through rate" value={`${(current.ctr * 100).toFixed(1)}%`} />
            </div> : <EmptyCopy text="No Search Console data has been matched to this page yet." />}
          </section>

          {data.metrics_history.length > 1 && <section><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><TrendingUp className="h-4 w-4 text-blue-600" /> Recent trend</h3><div className="overflow-hidden rounded-xl border border-slate-200"><div className="grid grid-cols-4 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><span>Month</span><span className="text-right">Position</span><span className="text-right">Impr.</span><span className="text-right">Clicks</span></div>{data.metrics_history.map((metric) => <div key={metric.period} className="grid grid-cols-4 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600"><span>{periodLabel(metric.period)}</span><span className="text-right font-medium">{metric.position?.toFixed(1) ?? '—'}</span><span className="text-right">{formatNumber(metric.impressions)}</span><span className="text-right">{formatNumber(metric.clicks)}</span></div>)}</div></section>}

          <section><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-orange-500" /> Current action</h3>{openItems.length ? <div className="space-y-3">{openItems.map((item) => <div key={item.id} className="rounded-xl border border-orange-200 bg-orange-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{item.title}</p>{item.description && <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{item.description}</p>}</div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase text-orange-700">{item.status.replace('_', ' ')}</span></div><button type="button" disabled={busyItemId != null} onClick={() => void prepareUpdate(item.id, item.brief_id)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50">{busyItemId === item.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}{item.brief_id ? 'Open update brief' : 'Generate update brief'}</button></div>)}</div> : <EmptyCopy text="No optimization action is currently open for this page." />}</section>

          <section><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><FileText className="h-4 w-4 text-blue-600" /> Brief history</h3>{data.briefs.length ? <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">{data.briefs.map((brief) => <button type="button" key={brief.id} onClick={() => void openBrief(brief.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"><span><span className="block text-sm font-semibold text-slate-800">{isUpdateBrief(brief.generation_input) ? 'Optimization update brief' : 'Original page brief'}</span><span className="mt-0.5 block text-xs text-slate-400">Version {brief.version} · {dateLabel(brief.updated_at ?? brief.generated_at)}</span></span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${brief.status === 'complete' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{brief.status}</span></button>)}</div> : <EmptyCopy text="No briefs are linked to this page." />}</section>

          <section><h3 className="mb-3 text-sm font-semibold text-slate-900">Page details</h3><div className="rounded-xl border border-slate-200 px-4"><Detail label="Status" value={data.page.status === 'complete' ? 'Live' : data.page.status} /><Detail label="Type" value={data.page.type.replace(/[-_]/g, ' ')} /><Detail label="Service" value={data.page.service ?? '—'} /><Detail label="Location" value={data.page.city ?? '—'} /><Detail label="Published" value={dateLabel(data.page.marked_complete_at ?? data.page.built_at ?? data.page.created_at)} /></div>{data.page.published_url && <button type="button" onClick={() => window.open(data.page.published_url!, '_blank', 'noopener,noreferrer')} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700"><ExternalLink className="h-3.5 w-3.5" /> Open live page</button>}</section>
        </div>}
      </div>
    </aside>
  </>;
}

function Metric({ label, value, delta, reverse = false }: { label: string; value: string; delta?: number | null; reverse?: boolean }) {
  const positive = delta != null && delta > 0;
  const good = reverse ? positive : positive;
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><div className="mt-1 flex items-end justify-between gap-2"><strong className="text-xl text-slate-900">{value}</strong>{delta != null && Math.abs(delta) >= 0.05 && <span className={`flex items-center text-[11px] font-semibold ${good ? 'text-emerald-600' : 'text-red-600'}`}>{positive ? <TrendingUp className="mr-0.5 h-3 w-3" /> : <TrendingDown className="mr-0.5 h-3 w-3" />}{Math.abs(delta).toFixed(delta % 1 ? 1 : 0)}</span>}</div></div>;
}
function Detail({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 text-xs last:border-0"><span className="text-slate-400">{label}</span><strong className="text-right font-semibold capitalize text-slate-700">{value}</strong></div>; }
function EmptyCopy({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{text}</p>; }
function formatNumber(value: number) { return new Intl.NumberFormat('en-US').format(value); }
function periodLabel(period: string) { const [year, month] = period.split('-').map(Number); return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(year, month - 1, 1)); }
function dateLabel(value: string) { const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`); return Number.isNaN(date.getTime()) ? 'Unknown' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date); }
function isUpdateBrief(input: string | null) { return Boolean(input?.includes('growth_work_item_id')); }
