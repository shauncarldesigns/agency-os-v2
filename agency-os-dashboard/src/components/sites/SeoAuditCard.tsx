import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Search, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Project, SeoAuditFinding, SeoAuditRun, ShowToast } from '../../lib/types';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

export function SeoAuditCard({ project, showToast, onPagesImported }: { project: Project; showToast: ShowToast; onPagesImported?: () => void }) {
  const [run, setRun] = useState<SeoAuditRun | null>(null);
  const [findings, setFindings] = useState<SeoAuditFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unmatchedPages, setUnmatchedPages] = useState(0);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const result = await api.seoAudits.latest(project.id); setRun(result.run); setFindings(result.findings); setUnmatchedPages(result.unmatchedPages); }
    catch (error) { showToast(`Could not load SEO audit: ${error instanceof ApiError ? error.message : (error as Error).message}`, 'error'); }
    finally { setLoading(false); }
  }, [project.id, showToast]);
  useEffect(() => { void load(); }, [load]);

  async function runAudit() {
    setRunning(true);
    try { const result = await api.seoAudits.run(project.id); setRun(result.run); setFindings(result.findings); setUnmatchedPages(result.unmatchedPages); setDrawerOpen(true); showToast('SEO audit complete', 'success'); }
    catch (error) { showToast(`SEO audit failed: ${error instanceof ApiError ? error.message : (error as Error).message}`, 'error'); }
    finally { setRunning(false); }
  }

  async function importPages() {
    setImporting(true);
    try {
      const result = await api.seoAudits.importPages(project.id);
      setUnmatchedPages(result.remaining);
      await load();
      onPagesImported?.();
      showToast(`${result.imported} page${result.imported === 1 ? '' : 's'} imported and ${result.linked} linked to existing records`, 'success');
    } catch (error) { showToast(`Page import failed: ${error instanceof ApiError ? error.message : (error as Error).message}`, 'error'); }
    finally { setImporting(false); }
  }

  const state = !run ? 'Not run' : run.status === 'failed' ? 'Failed' : run.critical_count > 0 ? 'Critical' : run.warning_count > 0 ? 'Needs attention' : 'Healthy';
  const tone = run && run.status === 'complete' && run.critical_count === 0 ? 'ok' : 'warn';
  return <>
    <section className="workspace-card md:col-span-2">
      <div className="seo-audit-card-heading">
        <div><p className="workspace-card-kicker">Technical SEO</p><h3>SEO crawl audit</h3></div>
        {run?.health_score != null && <div className={`seo-audit-score ${run.health_score >= 90 ? 'good' : run.health_score >= 70 ? 'attention' : 'critical'}`}><strong>{run.health_score}</strong><span>/ 100</span></div>}
      </div>
      {loading ? <p className="workspace-empty-copy"><Spinner /> Loading audit…</p> : <div className="seo-audit-summary">
        <AuditMetric label="Status" value={state} tone={tone} />
        <AuditMetric label="Pages crawled" value={String(run?.pages_crawled ?? 0)} />
        <AuditMetric label="Critical" value={String(run?.critical_count ?? 0)} tone={run?.critical_count ? 'critical' : 'ok'} />
        <AuditMetric label="Warnings" value={String(run?.warning_count ?? 0)} tone={run?.warning_count ? 'warn' : 'ok'} />
        <AuditMetric label="Last audit" value={run?.completed_at ? dateLabel(run.completed_at) : 'Never'} />
      </div>}
      <div className="configuration-actions">
        <Button variant="primary" size="sm" disabled={project.status !== 'live' || running} onClick={() => void runAudit()}>{running ? 'Crawling up to 50 pages…' : run ? 'Run audit again' : 'Run SEO audit'}</Button>
        {unmatchedPages > 0 && <Button variant="ghost" size="sm" disabled={importing} onClick={() => void importPages()}>{importing ? 'Importing…' : `Import ${unmatchedPages} live page${unmatchedPages === 1 ? '' : 's'}`}</Button>}
        {run && <Button variant="ghost" size="sm" onClick={() => setDrawerOpen(true)}>View {findings.length} finding{findings.length === 1 ? '' : 's'} <ChevronRight size={14} /></Button>}
      </div>
      {project.status !== 'live' && <p className="workspace-card-note">Audits become available when the site is marked live.</p>}
    </section>
    {drawerOpen && <SeoAuditDrawer run={run} findings={findings} onClose={() => setDrawerOpen(false)} />}
  </>;
}

function SeoAuditDrawer({ run, findings, onClose }: { run: SeoAuditRun | null; findings: SeoAuditFinding[]; onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | SeoAuditFinding['severity']>('all');
  const visible = useMemo(() => filter === 'all' ? findings : findings.filter((finding) => finding.severity === filter), [filter, findings]);
  return <>
    <button type="button" className="fixed inset-0 z-[209] bg-slate-950/30 backdrop-blur-[1px]" aria-label="Close SEO audit" onClick={onClose} />
    <aside className="fixed inset-y-0 right-0 z-[210] flex w-full max-w-[620px] flex-col border-l border-slate-200 bg-white shadow-2xl" role="dialog" aria-label="SEO audit findings">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Technical SEO</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Crawl findings</h2><p className="mt-1 text-xs text-slate-400">{run?.pages_crawled ?? 0} pages · {run?.completed_at ? dateLabel(run.completed_at) : 'Not completed'}</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={20} /></button></header>
      <div className="flex gap-2 border-b border-slate-100 px-6 py-3">{(['all', 'critical', 'warning', 'opportunity'] as const).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${filter === value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{value} {value === 'all' ? findings.length : findings.filter((item) => item.severity === value).length}</button>)}</div>
      <div className="flex-1 overflow-y-auto p-6">{visible.length ? <div className="space-y-3">{visible.map((finding) => <FindingCard finding={finding} key={finding.id} />)}</div> : <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-medium text-emerald-700"><CheckCircle2 className="mb-2" />No findings in this category.</div>}</div>
    </aside>
  </>;
}

export function FindingCard({ finding }: { finding: SeoAuditFinding }) {
  const Icon = finding.severity === 'critical' ? AlertCircle : finding.severity === 'warning' ? AlertTriangle : Search;
  const colors = finding.severity === 'critical' ? 'border-red-200 bg-red-50 text-red-700' : finding.severity === 'warning' ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-blue-200 bg-blue-50 text-blue-700';
  return <div className={`rounded-xl border p-4 ${colors}`}><div className="flex items-start gap-3"><Icon className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-900">{finding.title}</p><span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase">{finding.severity}</span></div><p className="mt-1 text-xs leading-relaxed text-slate-600">{finding.details}</p>{finding.page_url && <p className="mt-2 truncate text-[11px] text-slate-400">{finding.page_url}</p>}</div></div></div>;
}
function AuditMetric({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'critical' }) { return <div><span>{label}</span><strong className={tone ?? ''}>{value}</strong></div>; }
function dateLabel(value: string) { const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`); return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date); }
