import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, FilePlus2, LoaderCircle, PlusCircle, RefreshCw } from 'lucide-react';
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

  const pageActions = useMemo(() => items.filter((item) => ['created', 'improved', 'technical', 'conversion'].includes(item.category)), [items]);
  const committedActions = useMemo(() => pageActions.filter((item) => item.work_tier !== 'bonus'), [pageActions]);
  const committedOpen = useMemo(() => committedActions.filter((item) => item.status !== 'complete'), [committedActions]);
  const bonusOpen = useMemo(() => pageActions.filter((item) => item.work_tier === 'bonus' && item.status !== 'complete'), [pageActions]);
  const committedCompleted = committedActions.filter((item) => item.status === 'complete').length;
  const bonusCompleted = pageActions.filter((item) => item.work_tier === 'bonus' && item.status === 'complete').length;
  const monthlyTarget = Math.max(1, project.monthly_pages_target || 3);
  const recommendations = useMemo(() => committedOpen.filter((item) => item.category === 'created' && item.recommended_page_type && item.status === 'planned' && item.page_id == null), [committedOpen]);
  const optimizationRecommendations = useMemo(() => committedOpen.filter((item) => item.category !== 'created'), [committedOpen]);
  const recommendationKeys = useMemo(() => committedOpen.filter((item) => item.category === 'created' && item.recommended_page_type).map((item) => specKey({ type: item.recommended_page_type!, service: item.recommended_service ?? undefined, city: item.recommended_city ?? undefined })), [committedOpen]);
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
    const recommendedKeys = new Set(pageActions.filter((item) => item.category === 'created' && item.recommended_page_type).map((item) => specKey({ type: item.recommended_page_type!, service: item.recommended_service ?? undefined, city: item.recommended_city ?? undefined })));
    return [...servicePages, ...areaPages].filter((spec) => !recommendedKeys.has(specKey(spec)));
  }, [matrix, pageActions]);

  const generateRecommendations = useCallback(async () => {
    setGeneratingPlan(true);
    try {
      const result = await api.projects.growthCycles.generate(project.id, !!cycle && items.length > 0 && cycle.status === 'planning');
      setCycle(result.cycle); setItems(result.items);
    } catch (err) { showToast(`Could not generate recommendations: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error'); }
    finally { setGeneratingPlan(false); }
  }, [cycle, items.length, project.id, showToast]);

  useEffect(() => {
    if (loading || attemptedAuto.current || items.length > 0) return;
    if (cycle?.status && cycle.status !== 'planning') return;
    attemptedAuto.current = true;
    void generateRecommendations();
  }, [cycle?.status, generateRecommendations, items.length, loading]);

  async function createBrief(spec: PageSpec, existingItem?: GrowthWorkItem) {
    if (!hasMaster) { showToast('Generate the master brief before creating page briefs', 'error'); return; }
    const key = specKey(spec); setBusyKey(key);
    try {
      if (!existingItem && cycle) {
        await api.projects.growthCycles.addItem(cycle.id, {
          category: 'created', title: `Create ${describe(spec)}`, description: 'Operator-selected alternative from the available Page Matrix.',
          recommended_page_type: spec.type, recommended_service: spec.service, recommended_city: spec.city, work_tier: 'bonus',
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

  async function promoteToCommitment(item: GrowthWorkItem) {
    const replaceable = committedOpen.filter((candidate) => candidate.status === 'planned' && !candidate.brief_id && (candidate.category !== 'created' || !candidate.page_id));
    const hasOpenSlot = committedActions.length < monthlyTarget;
    let replaceId: number | undefined;
    if (!hasOpenSlot) {
      const candidate = replaceable[0];
      if (!candidate) { showToast('All three committed actions have started. Finish them or continue this as bonus work.', 'error'); return; }
      if (!window.confirm(`Replace “${candidate.title}” in this month’s commitment with “${item.title}”? The replaced item will stay in Continue working.`)) return;
      replaceId = candidate.id;
    }
    setBusyKey(`promote:${item.id}`);
    try {
      const result = await api.projects.growthCycles.commitItem(item.id, replaceId);
      setCycle(result.cycle); setItems(result.items);
      showToast(hasOpenSlot ? 'Added to this month’s commitment' : 'Monthly commitment updated', 'success');
    } catch (err) { showToast(`Could not update commitment: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error'); }
    finally { setBusyKey(null); }
  }

  if (loading || generatingPlan) return <section className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 p-5"><div className="flex items-center gap-2 text-sm font-semibold text-blue-700"><LoaderCircle className="h-4 w-4 animate-spin" /> {generatingPlan ? 'Identifying the best next pages…' : 'Loading page recommendations…'}</div></section>;

  return <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Monthly page actions</p><h2 className="mt-1 text-lg font-semibold text-slate-900">{committedCompleted} of {monthlyTarget} committed actions complete</h2><p className="mt-1 text-sm text-slate-500">Three is the monthly commitment, not a work limit. Creation and improvement both count; additional work is tracked separately.</p><div className="mt-3 h-2 max-w-sm overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.min(100, (committedCompleted / monthlyTarget) * 100)}%` }} /></div></div><div className="flex shrink-0 gap-2">{onOpenConfiguration && <button type="button" onClick={onOpenConfiguration} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Add service or area</button>}<button type="button" onClick={() => void generateRecommendations()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3.5 w-3.5" /> Refresh plan</button></div></div>
    <div className="space-y-3 p-5">
      {recommendations.length ? recommendations.map((item) => {
        const spec = { type: item.recommended_page_type!, service: item.recommended_service ?? undefined, city: item.recommended_city ?? undefined };
        return <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">{describe(spec)}</p>{item.description && <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.description}</p>}</div><button type="button" disabled={!!busyKey} onClick={() => void createBrief(spec, item)} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busyKey === specKey(spec) ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} Generate brief</button></div>;
      }) : <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700"><CheckCircle2 className="h-5 w-5" /> No new page is currently recommended. Optimization opportunities are shown below when supported by the available data.</div>}
      {optimizationRecommendations.length > 0 && <details className="group rounded-xl border border-orange-200"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl bg-orange-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-orange-700"><span>Page updates requiring action <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-[10px] text-orange-700">{optimizationRecommendations.length}</span></span><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary><div className="divide-y divide-slate-100 border-t border-orange-100">{optimizationRecommendations.map((item) => <div key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{item.title}</p>{item.description && <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-500">{item.description}</p>}</div>{item.page_id && <button type="button" disabled={!!busyKey} onClick={() => void openOrGenerateOptimizationBrief(item)} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50">{busyKey === `work:${item.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}{item.brief_id ? 'Open update brief' : 'Generate update brief'}</button>}</div>)}</div></details>}
      {(bonusOpen.length > 0 || available.length > 0 || bonusCompleted > 0) && <details className="group rounded-xl border border-slate-200"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-700"><span>Continue working <span className="ml-1 font-normal text-slate-500">{bonusOpen.length + available.length} available{bonusCompleted ? ` · ${bonusCompleted} bonus complete` : ''}</span></span><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary><div className="max-h-96 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">{bonusOpen.map((item) => <div key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{item.title}</p>{item.description && <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-slate-500">{item.description}</p>}</div><div className="flex shrink-0 gap-2"><button type="button" disabled={!!busyKey} onClick={() => void promoteToCommitment(item)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">{busyKey === `promote:${item.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="h-3.5 w-3.5" />} Use this month</button>{item.category === 'created' && item.recommended_page_type ? <button type="button" disabled={!!busyKey} onClick={() => void createBrief({ type: item.recommended_page_type!, service: item.recommended_service ?? undefined, city: item.recommended_city ?? undefined }, item)} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"><FilePlus2 className="h-3.5 w-3.5" /> Bonus brief</button> : item.page_id ? <button type="button" disabled={!!busyKey} onClick={() => void openOrGenerateOptimizationBrief(item)} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"><FilePlus2 className="h-3.5 w-3.5" /> {item.brief_id ? 'Open brief' : 'Bonus brief'}</button> : null}</div></div>)}{available.map((spec) => <div key={specKey(spec)} className="flex items-center gap-3 px-4 py-3"><span className="min-w-0 flex-1 text-sm text-slate-700">{describe(spec)}</span><button type="button" disabled={!!busyKey} onClick={() => void createBrief(spec)} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">{busyKey === specKey(spec) ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />} Create as bonus</button></div>)}</div></details>}
    </div>
  </section>;
}

function specKey(spec: PageSpec) { return `${spec.type}|${spec.service ?? ''}|${spec.city ?? ''}`.toLowerCase(); }
function describe(spec: PageSpec) { return spec.type === 'service-area' ? `${spec.service} in ${spec.city}` : spec.service ?? spec.type; }
