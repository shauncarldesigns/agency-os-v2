import { useCallback, useEffect, useState } from 'react';
import { Check, Circle, LoaderCircle, LockKeyhole } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { OnboardingItem, Project, ShowToast } from '../../lib/types';

export function OnboardingChecklistPanel({ project, showToast }: { project: Project; showToast: ShowToast }) {
  const [items, setItems] = useState<OnboardingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const result = await api.projects.onboarding.get(project.id); setItems(result.items); }
    catch (err) { showToast(`Could not load onboarding: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error'); }
    finally { setLoading(false); }
  }, [project.id, showToast]);
  useEffect(() => { void load(); }, [load]);

  async function toggle(item: OnboardingItem) {
    if (item.mode !== 'manual') return;
    setBusyKey(item.key);
    try { await api.projects.onboarding.update(project.id, item.key, !item.completed, item.notes); await load(); }
    catch (err) { showToast(`Could not update onboarding: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error'); }
    finally { setBusyKey(null); }
  }

  if (loading) return <div className="flex min-h-52 items-center justify-center text-sm text-slate-500"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading onboarding…</div>;
  const complete = items.filter((item) => item.completed).length;
  const percent = items.length ? Math.round((complete / items.length) * 100) : 0;
  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Client onboarding</p><h2 className="mt-1 text-2xl font-semibold text-slate-900">{complete} of {items.length} complete</h2><p className="mt-1 text-sm text-slate-500">Automatic steps update from the workspace. Check external steps when you complete them.</p></div><span className="text-2xl font-semibold text-slate-300">{percent}%</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} /></div></section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="divide-y divide-slate-100">{items.map((item) => <button key={item.key} type="button" disabled={item.mode === 'automatic' || busyKey === item.key} onClick={() => void toggle(item)} className={`flex w-full items-start gap-4 px-5 py-4 text-left ${item.mode === 'manual' ? 'hover:bg-slate-50' : 'cursor-default'} disabled:opacity-100`}><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${item.completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-slate-300'}`}>{busyKey === item.key ? <LoaderCircle className="h-4 w-4 animate-spin" /> : item.completed ? <Check className="h-4 w-4" /> : <Circle className="h-3 w-3" />}</span><span className="min-w-0 flex-1"><span className={`block text-sm font-semibold ${item.completed ? 'text-slate-500' : 'text-slate-800'}`}>{item.label}</span><span className="mt-1 block text-xs leading-relaxed text-slate-500">{item.description}</span></span><span className={`mt-1 inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${item.mode === 'automatic' ? 'text-blue-500' : 'text-slate-400'}`}>{item.mode === 'automatic' && <LockKeyhole className="h-3 w-3" />}{item.mode}</span></button>)}</div></section>
  </div>;
}
