import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Project, ReportSummary, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Spinner } from '../shared/Spinner';
import { ClientFilter } from './ClientFilter';
import { ExecSummary } from './ExecSummary';
import { MoMStats } from './MoMStats';
import { KeywordWins } from './KeywordWins';
import { ExportReportModal } from './ExportReportModal';
import { BarChart3, Download, RefreshCw } from 'lucide-react';

interface ReportsPanelProps {
  showToast: ShowToast;
  project?: Project;
  embedded?: boolean;
}

function defaultPeriod(): string {
  // Default to *last* completed month
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatPeriodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

export function ReportsPanel({ showToast, project, embedded = false }: ReportsPanelProps) {
  const [projects, setProjects] = useState<Project[]>(project ? [project] : []);
  const [selectedId, setSelectedId] = useState<number | null>(project?.id ?? null);
  const [period, setPeriod] = useState<string>(defaultPeriod());
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const loadProjects = useCallback(async () => {
    if (project) {
      setProjects([project]);
      setSelectedId(project.id);
      return;
    }
    try {
      const res = await api.projects.list({ tier: 3 });
      const tier3 = res.projects.filter(p =>
        p.tier === 3 && (p.is_internal === 1 || ['building', 'live', 'paused'].includes(p.status)),
      );
      setProjects(tier3);
      if (tier3.length > 0 && selectedId === null) setSelectedId(tier3[0].id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load Tier 3 projects: ${msg}`, 'error');
    }
  }, [project, selectedId, showToast]);

  const loadSummary = useCallback(async () => {
    if (selectedId === null) {
      setSummary(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.reports.summary(selectedId, period);
      setSummary(res);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load report: ${msg}`, 'error');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [selectedId, period, showToast]);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  async function handleRefresh() {
    if (selectedId === null) return;
    setRefreshing(true);
    try {
      await api.reports.refresh(selectedId, period);
      showToast('Pulled fresh data from Search Console + PageSpeed', 'success');
      await loadSummary();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Refresh failed: ${msg}`, 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleGenerateSummary() {
    if (selectedId === null) return;
    setGenerating(true);
    try {
      await api.reports.snapshot(selectedId, period);
      showToast('Snapshot finalized + summary generated', 'success');
      await loadSummary();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Generate failed: ${msg}`, 'error');
    } finally {
      setGenerating(false);
    }
  }

  const periodLabel = useMemo(() => formatPeriodLabel(period), [period]);

  return (
    <>
      <div className={embedded ? '' : 'min-h-full bg-slate-50'}>
        <div className={embedded ? '' : 'page-container'}>
          {projects.length === 0 ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><BarChart3 className="h-7 w-7" /></span>
              <h2 className="mt-4 text-base font-semibold text-slate-900">No Tier 3 clients yet</h2>
              <p className="mt-1 max-w-lg text-sm leading-6 text-slate-500">Reports are generated for Tier 3 clients. Convert a Tier 3 lead in Pipeline and create its project to begin reporting.</p>
            </div>
          ) : (
            <>
              <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <ClientFilter
                    projects={projects}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    period={period}
                    onPeriodChange={setPeriod}
                    lockClient={!!project}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={selectedId === null || refreshing} onClick={handleRefresh} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                      {refreshing ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {refreshing ? 'Refreshing…' : 'Refresh data'}
                    </button>
                    <button type="button" disabled={!summary} onClick={() => setExportOpen(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-50">
                      <Download className="h-4 w-4" /> Export report
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-400">Tier 3 performance · Google Search Console and PageSpeed data</p>
              </section>

              {loading ? (
                <div className="flex min-h-[320px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm text-slate-500"><Spinner /> Loading {periodLabel}…</div>
              ) : !summary ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><h2 className="text-sm font-semibold text-slate-800">No report data</h2><p className="mt-1 text-xs text-slate-500">Try refreshing data for this client and period.</p></div>
              ) : (
                <div className="space-y-4">
                  <ExecSummary
                    businessName={summary.project.name}
                    period={periodLabel}
                    text={summary.current?.exec_summary ?? null}
                    onRegenerate={handleGenerateSummary}
                    regenerating={generating}
                  />
                  <MoMStats current={summary.current} previous={summary.previous} />
                  <KeywordWins wins={summary.keywordWins} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ExportReportModal
        open={exportOpen}
        summary={summary}
        onClose={() => setExportOpen(false)}
        showToast={showToast}
      />
    </>
  );
}
