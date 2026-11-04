import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Lead, ShowToast, WebsiteBrief } from '../../lib/types';

interface Props { showToast: ShowToast; initialLeadId: number | null; onInitialConsumed: () => void; onLeadAdded: () => void }
const field = 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800';
const button = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40';
interface Audit { colors?: { backgrounds?: {value:string;count:number}[]; text?: {value:string;count:number}[]; accents?: {value:string;count:number}[] }; typography?: {fontFamilies?: {value:string;count:number}[]} }
function parse<T>(value: string | null, fallback: T): T { try { return JSON.parse(value || '') as T; } catch { return fallback; } }

export function WebsiteBriefsPage({showToast,initialLeadId,onInitialConsumed,onLeadAdded}: Props) {
  const [briefs,setBriefs] = useState<WebsiteBrief[]>([]);
  const [leads,setLeads] = useState<Lead[]>([]);
  const [draft,setDraft] = useState<WebsiteBrief | null>(null);
  const [busy,setBusy] = useState('');
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [url,setUrl] = useState('');
  const [company,setCompany] = useState('');
  const [leadId,setLeadId] = useState('');
  const [dirty,setDirty] = useState(false);
  const load = useCallback(async () => {
    const [saved,prospects] = await Promise.all([api.websiteBriefs.list(),api.leads.list()]);
    setBriefs(saved.briefs); setLeads(prospects.leads.filter(l => Boolean(l.website?.trim())));
    return saved.briefs;
  },[]);
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)); },[load]);
  useEffect(() => {
    if (!initialLeadId) return;
    let cancelled = false;
    setBusy('Opening brief');
    api.websiteBriefs.create(initialLeadId).then(async res => {
      if (cancelled) return; setDraft(res.brief); setDirty(false); await load();
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) {setBusy('');onInitialConsumed();} });
    return () => { cancelled = true; };
  // Consume each incoming pipeline selection once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[initialLeadId,load]);
  // Poll capture status without replacing unsaved edits.
  useEffect(() => {
    if (!briefs.some(b => b.capture_status === 'queued' || b.capture_status === 'capturing')) return;
    const timer = window.setInterval(() => { api.websiteBriefs.list().then(res => {
      setBriefs(res.briefs); setDraft(old => {const fresh = res.briefs.find(b => b.id === old?.id); return old && fresh ? {...old,capture_status:fresh.capture_status,capture_error:fresh.capture_error,technical_tokens:fresh.technical_tokens} : old;});
    }).catch(() => undefined); },5000);
    return () => window.clearInterval(timer);
  },[briefs]);
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError('');
    try { await action(); } catch(e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function openLead(id: number) {
    if (dirty && !window.confirm('Discard unsaved brief changes?')) return;
    const res = await api.websiteBriefs.create(id); setDraft(res.brief); setDirty(false); await load();
  }
  async function save() { if (!draft) return; await api.websiteBriefs.save(draft.id,draft); setDirty(false); }
  async function refreshDraft() { const rows = await load(); setDraft(old => rows.find(b => b.id === old?.id) ?? old); }
  const audit = parse<Audit>(draft?.technical_tokens ?? null,{});
  const colors = [...new Set([...(audit.colors?.accents ?? []),...(audit.colors?.backgrounds ?? []),...(audit.colors?.text ?? [])].map(c => c.value))].filter(c => c !== 'rgba(0, 0, 0, 0)').slice(0,16);
  const fonts = (audit.typography?.fontFamilies ?? []).map(f => f.value);
  const scan = parse<{pagesFetched?:number;extracted?:Record<string,unknown>;rawText?:string}>(draft?.scrape_data ?? null,{});
  const change = (key: 'brand_colors'|'brand_fonts'|'direction'|'brief',value: string) => {setDraft(old => old ? {...old,[key]:value} : old);setDirty(true);};
  return <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Existing website → redesign brief</p>
      <h2 className="mt-2 text-xl font-bold text-slate-900">Keep the brand. Improve the website.</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">Scan a published website, review its business facts and visual identity, then copy a redesign brief into LandingSite.ai.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form onSubmit={e => {e.preventDefault();void run('Adding website',async () => { const result = await api.websiteBriefs.importWebsite(url,company); await openLead(result.lead.id);setUrl('');setCompany('');onLeadAdded(); });}} className="flex flex-wrap gap-2">
          <label className="flex-1 text-xs text-slate-600">Published website URL<input required className={field} placeholder="https://example.com" value={url} onChange={e => setUrl(e.target.value)} /></label>
          <label className="flex-1 text-xs text-slate-600">Company (optional)<input className={field} value={company} onChange={e => setCompany(e.target.value)} /></label>
          <button disabled={!!busy} className={`${button} self-end`} type="submit">Add website</button>
        </form>
        <form onSubmit={e => {e.preventDefault(); void run('Opening brief',() => openLead(Number(leadId)));}} className="flex items-end gap-2">
          <label className="flex-1 text-xs text-slate-600">Or choose a lead with a website<select required value={leadId} onChange={e => setLeadId(e.target.value)} className={field}><option value="">Choose business…</option>{leads.map(l => <option key={l.id} value={l.id}>{l.company}</option>)}</select></label>
          <button type="submit" disabled={!!busy || !leadId} className={button}>Create redesign brief</button>
        </form>
      </div>
    </section>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    {busy && <p role="status" className="text-sm text-blue-700">{busy}…</p>}
    <div className="grid items-start gap-5 lg:grid-cols-[240px_1fr]">
      <aside className="space-y-2"><h3 className="text-sm font-semibold text-slate-700">Saved website briefs</h3>{loading ? <p className="text-sm text-slate-500">Loading…</p> : briefs.length === 0 ? <p className="text-sm leading-6 text-slate-500">Add a published website or choose a lead to start.</p> : briefs.map(b => <button disabled={!!busy} key={b.id} onClick={() => { if (!dirty || window.confirm('Discard unsaved brief changes?')) {setDraft(b);setDirty(false);} }} className={`w-full rounded-xl border p-3 text-left ${draft?.id === b.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}><span className="block text-sm font-semibold text-slate-800">{b.company}</span><span className="mt-1 block text-xs text-slate-500">{b.generated_at ? 'Brief saved' : b.scanned_at ? 'Site scanned' : 'Ready to scan'}</span></button>)}</aside>
      {draft && <section className="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
        <div><h3 className="text-lg font-bold text-slate-900">{draft.company}</h3><a href={draft.source_url} target="_blank" rel="noreferrer" className="break-all text-sm text-blue-600">{draft.source_url}</a></div>
        <div className="flex flex-wrap gap-2">
          <button disabled={!!busy} className={button} onClick={() => void run('Scanning website',async () => {await save();await api.websiteBriefs.scan(draft.id);await refreshDraft();})}>{draft.scanned_at ? 'Rescan website' : 'Scan website content'}</button>
          <button disabled={!!busy || ['queued','capturing'].includes(draft.capture_status ?? '')} className={button} onClick={() => void run('Queuing brand capture',async () => {await save();await api.websiteBriefs.capture(draft.id);await refreshDraft();})}>Capture colors & fonts</button>
        </div>
        <p className="text-xs leading-5 text-slate-500">{draft.scanned_at ? `${scan.pagesFetched ?? 0} pages captured · ${new Date(draft.scanned_at+'Z').toLocaleString()}` : 'Scan the website before generating a brief.'}<br />Brand capture: {draft.capture_status ?? 'not started'}. Queued captures run when Builder Employee browser control is enabled and its worker is connected.</p>
        {draft.capture_error && <p role="alert" className="text-sm text-red-600">{draft.capture_error}</p>}
        {draft.scanned_at && <details className="rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Review extracted business facts & source text</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">{JSON.stringify(scan.extracted,null,2)}{'\n\n'}{scan.rawText}</pre></details>}
        {(colors.length > 0 || fonts.length > 0) && <div className="rounded-xl border border-slate-200 p-4"><h4 className="text-sm font-semibold text-slate-800">Measured brand candidates</h4><p className="mt-1 text-xs leading-5 text-slate-500">Common colors can include neutral backgrounds. Select and edit the brand values to preserve below.</p><div className="mt-3 flex flex-wrap gap-2">{colors.map(color => <button disabled={!!busy} type="button" key={color} className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs text-slate-600" onClick={() => change('brand_colors',[draft.brand_colors,color].filter(Boolean).join(', '))}><span className="h-5 w-5 rounded border" style={{backgroundColor:color}} />{color}</button>)}</div><p className="mt-3 text-xs text-slate-600">Fonts: {fonts.join(' · ') || 'None captured'}</p><button type="button" disabled={!!busy || !fonts.length} className={`${button} mt-2`} onClick={() => change('brand_fonts',fonts.join('; '))}>Use measured fonts</button></div>}
        <fieldset disabled={!!busy} className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Reviewed brand colors<input value={draft.brand_colors} onChange={e => change('brand_colors',e.target.value)} className={field} placeholder="#153B57 primary, #36A9E1 accent" /></label><label className="text-sm font-semibold text-slate-700">Reviewed fonts<input value={draft.brand_fonts} onChange={e => change('brand_fonts',e.target.value)} className={field} placeholder="Heading and body fonts" /></label><label className="text-sm font-semibold text-slate-700 sm:col-span-2">Redesign direction & corrections<textarea rows={4} value={draft.direction} onChange={e => change('direction',e.target.value)} className={field} placeholder="What should we preserve, improve, or remove? Correct any extracted facts here." /></label></fieldset>
        <div className="flex flex-wrap gap-2"><button disabled={!!busy} className={button} onClick={() => void run('Saving',async () => {await save();await load();showToast('Website brief saved','success');})}>Save changes{dirty ? ' *' : ''}</button><button disabled={!!busy || !draft.scanned_at} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => {if (draft.brief && !window.confirm('Replace this saved brief with a new generation?')) return;void run('Generating redesign brief',async () => {await save();const result = await api.websiteBriefs.generate(draft.id);setDraft(old => old ? {...old,brief:result.brief} : old);await refreshDraft();});}}>Generate LandingSite brief</button></div>
        <label className="block text-sm font-semibold text-slate-700">LandingSite redesign brief<textarea disabled={!!busy} rows={20} value={draft.brief} onChange={e => change('brief',e.target.value)} className={`${field} font-mono leading-6`} placeholder="Your editable redesign brief appears here after generation." /></label>
        <button disabled={!!busy || !draft.brief} className={button} onClick={() => void navigator.clipboard.writeText(draft.brief).then(() => showToast('Brief copied for LandingSite.ai','success')).catch(() => showToast('Could not copy. Select the brief text and copy it manually.','error'))}>Copy for LandingSite.ai</button>
      </section>}
    </div>
  </div>;
}
