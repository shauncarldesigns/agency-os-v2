import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, FilePlus2, LoaderCircle, RefreshCw } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Brief, GrowthCycle, GrowthWorkItem, Page, Project, ShowToast } from '../../lib/types';

type PageSpec = { type: string; service?: string; city?: string };
type MatrixData = Awaited<ReturnType<typeof api.matrix.get>>;

export function PageRecommendationQueue({ project, hasMaster, showToast, onOpenBrief, onRecommendationKeysChange, onOptimizationPageIdsChange, onOpenConfiguration, onPageChanged }: {
  project: Project; hasMaster: boolean; showToast: ShowToast; onOpenBrief: (brief: Brief) => void;
  onRecommendationKeysChange?: (keys: string[]) => void;
  onOptimizationPageIdsChange?: (ids: number[]) => void;
  onOpenConfiguration?: () => void;
  onPageChanged?: () => void;
}) {
  const [cycle, setCycle] = useState<GrowthCycle | null>(null);
  const [items, setItems] = useState<GrowthWorkItem[]>([]);
  const [matrix, setMatrix] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const attemptedAuto = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cycleResult, matrixResult] = await Promise.all([api.projects.growthCycles.current(project.id), api.matrix.get(project.id)]);
      setCycle(cycleResult.cycle); setItems(cycleResult.items); setMatrix(matrixResult);
    } catch (err) { showToast(`Could not load page queue: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error'); }
    finally { setLoading(false); }
  }, [project.id, showToast]);

  useEffect(() => { void load(); }, [load]);

  const recommendations = useMemo(() => items.filter((item) => item.category === 'created' && item.recommended_page_type && item.status === 'planned' && item.page_id == null), [items]);
  const optimizationRecommendations = useMemo(() => items.filter((item) => item.category !== 'created' && item.status !== 'complete'), [items]);
  const recommendationKeys = useMemo(() => recommendations.map((item) => specKey({ type: item.recommended_page_type!, service: item.recommended_service ?? undefined, city: item.recommended_city ?? undefined })), [items]);
  useEffect(() => {
    onRecommendationKeysChange?.(recommendationKeys);
    return () => onRecommendationKeysChange?.([]);
  }, [onRecommendationKeysChange, recommendationKeys]);
  const optimizationPageIds = useMemo(() => optimizationRecommendations.flatMap((item) => item.page_id == null ? [] : [item.page_id]), [optimizationRecommendations]);
  useEffect(() => {
    onOptimizationPageIdsChange?.(optimizationPageIds);
    return () => onOptimizationPageIdsChange?.([]);
  }, [onOptimizationPageIdsChange, optimizationPageIds]);
  const available = useMemo(() => {
    if (!matrix) return [] as PageSpec[];
    const servicePages = matrix.servicePages.filter((page) => page.pageId == null).map((page) => ({ type: 'service', service: page.service }));
    const areaPages = matrix.serviceAreaGrid.cells.filter((page) => page.pageId == null).map((page) => ({ type: 'service-area', service: page.service, city: page.city }));
    const recommendedKeys = new Set(recommendations.map((item) => specKey({ type: item.recommended_page_type!, service: item.recommended_service ?? undefined, city: item.recommended_city ?? undefined })));
    return [...servicePages, ...areaPages].filter((spec) => !recommendedKeys.has(specKey(spec)));
  }, [matrix, recommendations]);

  const generateRecommendations = useCallback(async () => {
    setGeneratingPlan(true);
    try {
      const result = await api.projects.growthCycles.generate(project.id, !!cycle && items.length > 0 && cycle.status === 'planning');
      setCycle(result.cycle); setItems(result.items);
    } catch (err) { showToast(`Could not generate recommendations: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error'); }
    finally { setGeneratingPlan(false); }
  }, [cycle, items.length, project.id, showToast]);

  useEffect(() => {
    if (loading || attemptedAuto.current || recommendations.length > 0) return;
    if (cycle?.status && cycle.status !== 'planning') return;
    attemptedAuto.current = true;
    void generateRecommendations();
  }, [cycle?.status, generateRecommendations, loading, recommendations.length]);

  async function createBrief(spec: PageSpec, existingItem?: GrowthWorkItem) {
    if (!hasMaster) { showToast('Generate the master brief before creating page briefs', 'error'); return; }
    const key = specKey(spec); setBusyKey(key);
    try {
      if (!existingItem && cycle) {
        await api.projects.growthCycles.addItem(cycle.id, {
          category: 'created', title: `Create ${describe(spec)}`, description: 'Operator-selected alternative from the available Page Matrix.',
          recommended_page_type: spec.type, recommended_service: spec.service, recommended_city: spec.city,
        });
      }
      const page = await api.pages.create(project.id, spec) as Page;
      const brief = await api.briefs.generatePage(project.id, page.id);
      onOpenBrief(brief);
      await load();
      onPageChanged?.();
      showToast(`Brief generated for ${describe(spec)}`, 'success');
    } catch (err) { showToast(`Could not generate page brief: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error'); }
    finally { setBusyKey(null); }
  }

  async function openOrGenerateOptimizationBrief(item: GrowthWorkItem) {
    if (!item.page_id) return;
    setBusyKey(`work:${item.id}`);
    try {
      if (item.brief_id) {
        const brief = await api.briefs.get(item.brief_id);
        onOpenBrief(brief);
        return;
      }
      const result = await api.projects.growthCycles.generateItemBrief(item.id);
      const brief = result.brief;
      setItems((current) => current.map((candidate) => candidate.id === result.item.id ? result.item : candidate));
      onOpenBrief(brief);
      showToast(`Update brief generated for ${item.title}`, 'success');
    } catch (err) {
      showToast(`Could not prepare update brief: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error');
    } finally { setBusyKey(null); }
  }

  if (loading || generatingPlan) return <section className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 p-5"><div className="flex items-center gap-2 text-sm font-semibold text-blue-700"><LoaderCircle className="h-4 w-4 animate-spin" /> {generatingPlan ? 'Identifying the best next pages…' : 'Loading page recommendations…'}</div></section>;

  return <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Recommended page queue</p><h2 className="mt-1 text-lg font-semibold text-slate-900">What to create or improve next</h2><p className="mt-1 text-sm text-slate-500">Recommendations come from this client’s actual services, markets, existing pages, and available performance data. You can add services or areas in any growth phase.</p></div><div className="flex shrink-0 gap-2">{onOpenConfiguration && <button type="button" onClick={onOpenConfiguration} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Add service or area</button>}<button type="button" onClick={() => void generateRecommendations()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3.5 w-3.5" /> Refresh plan</button></div></div>
    <div className="space-y-3 p-5">
      {recommendations.length ? recommendations.map((item) => {
        const spec = { type: item.recommended_page_type!, service: item.recommended_service ?? undefined, city: item.recommended_city ?? undefined };
        return <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">{describe(spec)}</p>{item.description && <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.description}</p>}</div><button type="button" disabled={!!busyKey} onClick={() => void createBrief(spec, item)} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busyKey === specKey(spec) ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} Generate brief</button></div>;
      }) : <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700"><CheckCircle2 className="h-5 w-5" /> No new page is currently recommended. Optimization opportunities are shown below when supported by the available data.</div>}
      {optimizationRecommendations.length > 0 && <details className="group rounded-xl border border-orange-200"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl bg-orange-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-orange-700"><span>Page updates requiring action <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-[10px] text-orange-700">{optimizationRecommendations.length}</span></span><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary><div className="divide-y divide-slate-100 border-t border-orange-100">{optimizationRecommendations.map((item) => <div key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{item.title}</p>{item.description && <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-500">{item.description}</p>}</div>{item.page_id && <button type="button" disabled={!!busyKey} onClick={() => void openOrGenerateOptimizationBrief(item)} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50">{busyKey === `work:${item.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}{item.brief_id ? 'Open update brief' : 'Generate update brief'}</button>}</div>)}</div></details>}
      {available.length > 0 && <details className="rounded-xl border border-slate-200"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">Choose another available page ({available.length})</summary><div className="max-h-72 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">{available.map((spec) => <div key={specKey(spec)} className="flex items-center gap-3 px-4 py-3"><span className="min-w-0 flex-1 text-sm text-slate-700">{describe(spec)}</span><button type="button" disabled={!!busyKey} onClick={() => void createBrief(spec)} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">{busyKey === specKey(spec) ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />} Use this page</button></div>)}</div></details>}
    </div>
  </section>;
}

function specKey(spec: PageSpec) { return `${spec.type}|${spec.service ?? ''}|${spec.city ?? ''}`.toLowerCase(); }
function describe(spec: PageSpec) { return spec.type === 'service-area' ? `${spec.service} in ${spec.city}` : spec.service ?? spec.type; }
