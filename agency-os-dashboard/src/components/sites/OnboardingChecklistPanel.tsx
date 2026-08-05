import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, Circle, FileSearch, FlaskConical, Images, LoaderCircle, LockKeyhole } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { OnboardingItem, Project, ProjectDiscovery, ShowToast } from '../../lib/types';

export function OnboardingChecklistPanel({ project, discovery, onOpenDiscovery, showToast }: { project: Project; discovery: ProjectDiscovery | null; onOpenDiscovery: () => void; showToast: ShowToast }) {
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
  const answers = safeJsonObject(discovery?.answers_json);
  const logo = assetStatus(answers.logo_available, answers.logo_delivery_status, 'No logo available');
  const photos = assetStatus(answers.photos_available, answers.photos_delivery_status, 'No work photos available');
  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Client onboarding</p><h2 className="mt-1 text-2xl font-semibold text-slate-900">{complete} of {items.length} complete</h2><p className="mt-1 text-sm text-slate-500">Automatic steps update from the workspace. Check external steps when you complete them.</p></div><span className="text-2xl font-semibold text-slate-300">{percent}%</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} /></div></section>
    <div className="grid gap-3 lg:grid-cols-2">
      <CompactOnboardingCard
        icon={<FileSearch className="h-4 w-4" />}
        iconClass={discovery?.status === 'complete' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}
        title="Business discovery"
        status={discovery?.status === 'complete' ? 'Complete' : discovery ? 'Draft' : 'Not started'}
        statusTone={discovery?.status === 'complete' ? 'ok' : discovery ? 'waiting' : 'muted'}
        description="Positioning, customer priorities, proof, and build inputs."
        meta={project.status === 'prospect' && project.is_internal !== 1 ? <span className="flex items-center gap-1 text-amber-600"><FlaskConical className="h-3 w-3" /> Test mode</span> : discovery?.updated_at ? `Updated ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(discovery.updated_at.replace(' ', 'T') + (discovery.updated_at.includes('Z') ? '' : 'Z')))}` : 'No discovery saved'}
        actionLabel={discovery ? 'Review' : 'Start'}
        onAction={onOpenDiscovery}
      />
      <CompactOnboardingCard
        icon={<Images className="h-4 w-4" />}
        iconClass="bg-violet-50 text-violet-600"
        title="Asset collection"
        status={logo.tone === 'ok' && photos.tone === 'ok' ? 'Complete' : logo.tone === 'waiting' || photos.tone === 'waiting' ? 'Waiting' : 'Incomplete'}
        statusTone={logo.tone === 'ok' && photos.tone === 'ok' ? 'ok' : logo.tone === 'waiting' || photos.tone === 'waiting' ? 'waiting' : 'muted'}
        description="Logo and project photography needed for launch."
        meta={<span className="grid min-w-0 grid-cols-2 gap-3"><AssetStatus label="Logo" status={logo} /><AssetStatus label="Photos" status={photos} /></span>}
        actionLabel="Review"
        onAction={onOpenDiscovery}
      />
    </div>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="divide-y divide-slate-100">{items.map((item) => <button key={item.key} type="button" disabled={item.mode === 'automatic' || busyKey === item.key} onClick={() => void toggle(item)} className={`flex w-full items-start gap-4 px-5 py-4 text-left ${item.mode === 'manual' ? 'hover:bg-slate-50' : 'cursor-default'} disabled:opacity-100`}><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${item.completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-slate-300'}`}>{busyKey === item.key ? <LoaderCircle className="h-4 w-4 animate-spin" /> : item.completed ? <Check className="h-4 w-4" /> : <Circle className="h-3 w-3" />}</span><span className="min-w-0 flex-1"><span className={`block text-sm font-semibold ${item.completed ? 'text-slate-500' : 'text-slate-800'}`}>{item.label}</span><span className="mt-1 block text-xs leading-relaxed text-slate-500">{item.description}</span></span><span className={`mt-1 inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${item.mode === 'automatic' ? 'text-blue-500' : 'text-slate-400'}`}>{item.mode === 'automatic' && <LockKeyhole className="h-3 w-3" />}{item.mode}</span></button>)}</div></section>
  </div>;
}

function CompactOnboardingCard({ icon, iconClass, title, status, statusTone, description, meta, actionLabel, onAction }: { icon: ReactNode; iconClass: string; title: string; status: string; statusTone: 'ok' | 'waiting' | 'muted'; description: string; meta: ReactNode; actionLabel: string; onAction: () => void }) {
  const statusClass = statusTone === 'ok' ? 'bg-emerald-50 text-emerald-700' : statusTone === 'waiting' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500';
  return <section className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex min-w-0 items-center gap-2.5"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>{icon}</span><h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{title}</h3><span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${statusClass}`}>{status}</span></div><p className="mt-2 min-h-8 text-xs leading-4 text-slate-500">{description}</p><div className="mt-2 flex min-h-8 min-w-0 items-center border-t border-slate-100 pt-2 text-[11px] text-slate-400"><span className="min-w-0 flex-1 overflow-hidden">{meta}</span><button type="button" onClick={onAction} className="ml-3 inline-flex h-8 w-20 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">{actionLabel}</button></div></section>;
}

function AssetStatus({ label, status }: { label: string; status: { label: string; tone: 'ok' | 'waiting' | 'muted' } }) {
  return <span className="min-w-0"><span className="block text-[9px] font-semibold uppercase tracking-wider text-slate-400">{label}</span><span title={status.label} className={`block truncate text-[11px] font-semibold ${status.tone === 'ok' ? 'text-emerald-600' : status.tone === 'waiting' ? 'text-amber-600' : 'text-slate-500'}`}>{status.label}</span></span>;
}

function safeJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
  catch { return {}; }
}

function assetStatus(available: unknown, delivery: unknown, unavailableLabel: string): { label: string; tone: 'ok' | 'waiting' | 'muted' } {
  if (available === false) return { label: unavailableLabel, tone: 'muted' };
  if (available !== true) return { label: 'Not answered', tone: 'muted' };
  if (delivery === 'Delivered') return { label: 'Delivered', tone: 'ok' };
  if (delivery === 'Still waiting') return { label: 'Still waiting', tone: 'waiting' };
  return { label: 'Delivery not confirmed', tone: 'muted' };
}
