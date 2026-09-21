import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Check, ExternalLink, History, Library, Palette, Plus, Save, Search, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { DesignAsset, DesignCaptureJob, DesignReference, ShowToast } from '../../lib/types';

function tagsOf(design: DesignReference): string[] {
  try { const parsed = JSON.parse(design.style_tags); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function designDisplayName(design: DesignReference): string {
  return `${design.industry || 'General'} · ${design.name}`;
}

export function DesignLibraryPage({ showToast, initialDesignId, onInitialDesignConsumed }: { showToast: ShowToast; initialDesignId?: number | null; onInitialDesignConsumed?: () => void }) {
  const [designs, setDesigns] = useState<DesignReference[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DesignReference | null>(null);
  const [captureJob, setCaptureJob] = useState<DesignCaptureJob | null>(null);
  const [assets, setAssets] = useState<Array<DesignAsset & { url: string }>>([]);
  const [captureRefresh, setCaptureRefresh] = useState(0);
  const [cardPreviews, setCardPreviews] = useState<Record<number, string>>({});
  const [history, setHistory] = useState<DesignCaptureJob[]>([]);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [newSnapshot, setNewSnapshot] = useState<{name:string;source_url:string;industry:string}|null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { designs: rows } = await api.designLibrary.list();
      setDesigns(rows);
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not load the Design Library', 'error');
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (initialDesignId && designs.some((design) => design.id === initialDesignId)) {
      setSelectedId(initialDesignId); onInitialDesignConsumed?.();
    }
  }, [designs, initialDesignId, onInitialDesignConsumed]);
  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    const loadPreviews = async () => {
      const pairs = await Promise.all(designs.filter((design) => design.preview_asset_id).map(async (design) => {
        const blob = await api.designLibrary.assetBlob(design.preview_asset_id!);
        return [design.id, URL.createObjectURL(blob)] as const;
      }));
      if (cancelled) { pairs.forEach(([, url]) => URL.revokeObjectURL(url)); return; }
      urls = pairs.map(([, url]) => url);
      setCardPreviews(Object.fromEntries(pairs));
    };
    void loadPreviews().catch(() => undefined);
    return () => { cancelled = true; urls.forEach(URL.revokeObjectURL); };
  }, [designs]);
  useEffect(() => { setDraft(designs.find((item) => item.id === selectedId) ?? null); }, [designs, selectedId]);
  useEffect(() => {
    if (!draft || draft.status !== 'draft' || captureJob?.status !== 'completed' || draft.recipe_generated_at || draft.recipe_generation_error) return;
    const timer = window.setTimeout(async () => {
      try {
        const {design}=await api.designLibrary.get(draft.id);
        setDraft(design); setDesigns((rows)=>rows.map((row)=>row.id===design.id?design:row));
      } catch { /* The next normal refresh can recover. */ }
    },3000);
    return ()=>window.clearTimeout(timer);
  },[draft,captureJob]);
  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    if (!selectedId) { setCaptureJob(null); setAssets([]); return; }
    const refresh = async () => {
      const result = await api.designLibrary.captures(selectedId);
      if (cancelled) return;
      setCaptureJob(result.job);
      setHistory(result.history ?? []);
      const next = await Promise.all(result.assets.map(async (asset) => ({ ...asset, url: URL.createObjectURL(await api.designLibrary.assetBlob(asset.id)) })));
      if (cancelled) { next.forEach((asset) => URL.revokeObjectURL(asset.url)); return; }
      urls.forEach(URL.revokeObjectURL); urls = next.map((asset) => asset.url); setAssets(next);
      if (result.job && ['queued','capturing'].includes(result.job.status)) window.setTimeout(() => void refresh(), 2500);
      else if (result.job?.status === 'completed') void load();
    };
    void refresh().catch(() => undefined);
    return () => { cancelled = true; urls.forEach(URL.revokeObjectURL); };
  }, [selectedId, captureRefresh]);

  const capture = async () => {
    if (!draft) return;
    if (draft.status === 'draft' && !window.confirm('Recapture and redraft this design? The new screenshots, technical audit, and saved source brief will be sent to Anthropic and will replace the current draft recipe.')) return;
    try {
      const { job } = await api.designLibrary.capture(draft.id);
      setCaptureJob(job);
      setCaptureRefresh((value) => value + 1);
      showToast('Desktop and mobile snapshot queued', 'success');
    } catch (err) { showToast(err instanceof ApiError ? err.message : 'Could not queue snapshot', 'error'); }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return designs.filter((design) => !q || [design.name, design.description, design.industry, ...tagsOf(design)]
      .some((value) => value?.toLowerCase().includes(q)));
  }, [designs, query]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const { design } = await api.designLibrary.update(draft.id, draft);
      setDesigns((current) => current.map((item) => item.id === design.id ? design : item));
      setDraft(design);
      showToast('Design reference saved', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not save design reference', 'error');
    } finally { setSaving(false); }
  };

  const generate = async () => {
    if (!draft) return;
    if (!window.confirm('Generate this recipe with Anthropic? The desktop/mobile screenshots, technical audit, and saved source brief will be sent for analysis.')) return;
    setGenerating(true);
    try { const {design}=await api.designLibrary.generateRecipe(draft.id); setDraft(design); setDesigns((rows)=>rows.map((row)=>row.id===design.id?design:row)); showToast('Reusable recipe generated — review it before approval','success'); }
    catch(err){ showToast(err instanceof ApiError?err.message:'Could not generate recipe','error'); }
    finally{setGenerating(false);}
  };

  const approve = async () => {
    if (!draft) return; setApproving(true);
    try { const {design}=await api.designLibrary.approve(draft.id); setDraft(design); setDesigns((rows)=>rows.map((row)=>row.id===design.id?design:row)); showToast('Design approved and ready for new briefs','success'); }
    catch(err){ showToast(err instanceof ApiError?err.message:'Could not approve design','error'); }
    finally{setApproving(false);}
  };

  const remove = async () => {
    if (!draft || !window.confirm(`Delete the draft design "${draft.name}" and all of its snapshots?`)) return;
    try { await api.designLibrary.remove(draft.id); setSelectedId(null); await load(); showToast('Draft design deleted','success'); }
    catch(err){ showToast(err instanceof ApiError?err.message:'Could not delete design','error'); }
  };

  const createSnapshot = async () => {
    if (!newSnapshot) return;
    try { const {design}=await api.designLibrary.snapshot(newSnapshot); setNewSnapshot(null); await load(); setSelectedId(design.id); setCaptureRefresh((value)=>value+1); showToast('Standalone design snapshot queued','success'); }
    catch(err){ showToast(err instanceof ApiError?err.message:'Could not create snapshot','error'); }
  };

  return <div className="main">
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white"><Library className="h-5 w-5" /></div><div><h2 className="text-lg font-bold text-slate-900">Design Library</h2><p className="mt-1 text-sm text-slate-500">Reusable visual recipes for LandingSite briefs. Business facts remain separate.</p></div></div>
        <button type="button" onClick={() => setNewSnapshot({name:'',source_url:'',industry:''})} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> New snapshot from URL</button>
      </div>
    </section>
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search designs…" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-400" /></div>
        {loading ? <p className="py-8 text-center text-sm text-slate-400">Loading designs…</p> : <div className="space-y-2">{filtered.map((design) => <button key={design.id} type="button" onClick={() => setSelectedId(design.id)} className={`w-full rounded-xl border p-3 text-left ${selectedId === design.id ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-100' : 'border-slate-200 hover:bg-slate-50'}`}>
          <div className="mb-3 flex h-24 overflow-hidden rounded-lg bg-[#081724]">{cardPreviews[design.id] ? <img src={cardPreviews[design.id]} alt={`${designDisplayName(design)} desktop snapshot`} className="h-full w-full object-cover object-top" /> : <><div className="w-[58%] bg-[linear-gradient(135deg,#081724_0%,#081724_52%,#244058_100%)] p-3"><div className="mt-4 h-2 w-24 rounded bg-white/90" /><div className="mt-2 h-1.5 w-16 rounded bg-white/40" /><div className="mt-4 h-4 w-14 rounded-full bg-white" /></div><div className="m-3 ml-0 flex-1 rounded-lg border border-white/15 bg-white/[.08]" /></>}</div>
          <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-bold text-slate-900">{designDisplayName(design)}</p><p className="mt-0.5 text-xs text-slate-500">Source industry · used {design.reuse_count} times</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${design.status === 'ready' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{design.status}</span></div>
          <div className="mt-2 flex flex-wrap gap-1">{tagsOf(design).slice(0,4).map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{tag}</span>)}</div>
        </button>)}</div>}
      </aside>
      {draft ? <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><Palette className="h-4 w-4 text-blue-600" /><h3 className="font-bold text-slate-900">{designDisplayName(draft)}</h3></div><p className="mt-1 text-xs text-slate-500">Source industry: {draft.industry || 'General'}. The visual system adapts its imagery and icons to each target industry.</p></div><div className="flex flex-wrap gap-2">{draft.source_url && <a href={draft.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"><ExternalLink className="h-3.5 w-3.5" /> Open source</a>}<button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"><Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save edits'}</button>{draft.status==='draft'&&<button type="button" onClick={() => void remove()} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600"><Trash2 className="h-3.5 w-3.5" /> Delete draft</button>}</div></div>
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" /></label>
          <label className="text-xs font-semibold text-slate-700">Status<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as DesignReference['status'] })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"><option value="draft">Draft</option>{draft.status==='ready'&&<option value="ready">Ready</option>}<option value="archived">Archived</option></select></label>
          <label className="text-xs font-semibold text-slate-700 lg:col-span-2">Source URL<input value={draft.source_url ?? ''} onChange={(e) => setDraft({ ...draft, source_url: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" /></label>
          <label className="text-xs font-semibold text-slate-700 lg:col-span-2">Description<textarea value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" /></label>
          <div className="lg:col-span-2"><div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-slate-700">Latest snapshot</p><p className="mt-0.5 text-[11px] text-slate-400">Desktop and mobile captures for {draft.name}</p></div><button type="button" onClick={() => void capture()} disabled={!draft.source_url || captureJob?.status === 'queued' || captureJob?.status === 'capturing'} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-400"><Camera className="h-3.5 w-3.5" /> {captureJob?.status === 'queued' || captureJob?.status === 'capturing' ? 'Capturing…' : 'Recapture this design'}</button></div>{captureJob?.status === 'failed' ? <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{captureJob.error || 'Capture failed'}</p> : assets.length > 0 ? <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">{assets.map((asset) => <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"><img src={asset.url} alt={`${asset.kind === 'desktop_full' ? 'Desktop' : 'Mobile'} full-page snapshot`} className="h-56 w-full object-cover object-top" /><p className="border-t border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600">{asset.kind === 'desktop_full' ? 'Desktop · 1440px' : 'Mobile · 390px'}</p></a>)}</div> : <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400">No completed snapshot yet</div>}</div>
          {draft.status==='ready' ? <div className="lg:col-span-2 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><Check className="h-4 w-4 text-emerald-600" /><div><p className="text-xs font-semibold text-emerald-800">Ready — available for new website briefs</p><p className="mt-0.5 text-[11px] text-emerald-700">The approved recipe stays unchanged when screenshots are recaptured.</p></div></div> : <div className="lg:col-span-2 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3"><Sparkles className="h-4 w-4 text-indigo-600" /><div className="mr-auto"><p className="text-xs font-semibold text-indigo-800">{generating || (captureJob?.status==='completed'&&!draft.recipe_generated_at&&!draft.recipe_generation_error) ? 'Drafting recipe automatically…' : draft.recipe_generation_error ? 'Automatic recipe drafting failed' : draft.recipe_generated_at ? 'Draft recipe ready for review' : 'Recipe will be drafted automatically after capture'}</p><p className="mt-0.5 text-[11px] text-indigo-700">{draft.recipe_generated_at ? 'Review the recipe below and test it with a fake company in LandingSite before approval.' : draft.recipe_generation_error || 'No separate Generate step is required.'}</p></div>{draft.recipe_generation_error&&<button type="button" onClick={() => void generate()} disabled={generating || captureJob?.status!=='completed'} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{generating?'Retrying…':'Retry drafting'}</button>}{draft.recipe_generated_at&&<button type="button" onClick={() => void approve()} disabled={approving} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Check className="h-3.5 w-3.5" /> {approving?'Approving…':'Approve after test'}</button>}</div>}
          <label className="text-xs font-semibold text-slate-700 lg:col-span-2">Design recipe<textarea value={draft.design_recipe} onChange={(e) => setDraft({ ...draft, design_recipe: e.target.value })} rows={24} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs font-normal leading-5" /></label>
          <label className="text-xs font-semibold text-slate-700 lg:col-span-2"><span className="flex items-center gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5" /> Technical tokens</span><textarea value={draft.technical_tokens} onChange={(e) => setDraft({ ...draft, technical_tokens: e.target.value })} rows={8} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-950 px-4 py-3 font-mono text-xs font-normal leading-5 text-slate-200" /></label>
          {history.length>0&&<div className="lg:col-span-2 rounded-xl border border-slate-200 p-3"><p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><History className="h-3.5 w-3.5" /> Snapshot history</p><div className="mt-2 space-y-1">{history.map((job)=><div key={job.id} className="flex justify-between text-[11px] text-slate-500"><span>Capture #{job.id} · {job.status}{job.error?` · ${job.error}`:''}</span><span>{job.created_at?new Date(`${job.created_at.replace(' ','T')}Z`).toLocaleString():''}</span></div>)}</div></div>}
        </div>
      </section> : <section className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm text-slate-400">Select a design reference</section>}
    </div>
    {newSnapshot&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><h3 className="font-bold text-slate-900">New snapshot from URL</h3><button onClick={()=>setNewSnapshot(null)} className="rounded-lg p-2 text-slate-400"><X className="h-4 w-4" /></button></div><div className="mt-4 space-y-3"><label className="block text-xs font-semibold text-slate-700">Design name<input value={newSnapshot.name} onChange={(e)=>setNewSnapshot({...newSnapshot,name:e.target.value})} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="block text-xs font-semibold text-slate-700">Website URL<input value={newSnapshot.source_url} onChange={(e)=>setNewSnapshot({...newSnapshot,source_url:e.target.value})} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="block text-xs font-semibold text-slate-700">Industry (optional)<input value={newSnapshot.industry} onChange={(e)=>setNewSnapshot({...newSnapshot,industry:e.target.value})} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><p className="rounded-xl bg-indigo-50 p-3 text-[11px] leading-4 text-indigo-800">Capture automatically drafts the reusable recipe. The screenshots, technical audit, and any saved source brief are sent to Anthropic for analysis.</p></div><div className="mt-5 flex justify-end gap-2"><button onClick={()=>setNewSnapshot(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button><button onClick={()=>void createSnapshot()} disabled={!newSnapshot.name.trim()||!newSnapshot.source_url.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Capture & draft recipe</button></div></div></div>}
  </div>;
}
