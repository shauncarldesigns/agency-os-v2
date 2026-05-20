import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Project, ReportSummary, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { ClientFilter } from './ClientFilter';
import { ExecSummary } from './ExecSummary';
import { MoMStats } from './MoMStats';
import { KeywordWins } from './KeywordWins';
import { ExportReportModal } from './ExportReportModal';

interface ReportsPanelProps {
  showToast: ShowToast;
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

export function ReportsPanel({ showToast }: ReportsPanelProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [period, setPeriod] = useState<string>(defaultPeriod());
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const res = await api.projects.list({ tier: 3 });
      const tier3 = res.projects.filter(p => p.tier === 3);
      setProjects(tier3);
      if (tier3.length > 0 && selectedId === null) setSelectedId(tier3[0].id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load Tier 3 projects: ${msg}`, 'error');
    }
  }, [selectedId, showToast]);

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
      <div className="sec-header">
        <div>
          <div className="sec-title">Reports</div>
          <div className="sec-sub">
            Monthly performance reports for Tier 3 clients · Pulled from Search Console + PageSpeed + Cloudflare
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <Button variant="ghost" size="sm" disabled={selectedId === null || refreshing} onClick={handleRefresh}>
            {refreshing ? <><Spinner /> Refreshing…</> : '↻ Refresh data'}
          </Button>
          <Button variant="primary" size="sm" disabled={!summary} onClick={() => setExportOpen(true)}>
            ↓ Export Report (PDF)
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon="📊"
          title="No Tier 3 clients yet"
          sub="Reports are generated for Tier 3 clients only. Convert a Tier 3 lead in Pipeline, then generate a brief in Build to add a project."
        />
      ) : (
        <>
          <ClientFilter
            projects={projects}
            selectedId={selectedId}
            onSelect={setSelectedId}
            period={period}
            onPeriodChange={setPeriod}
          />

          {loading ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)' }}>
              <Spinner /> Loading {periodLabel}…
            </div>
          ) : !summary ? (
            <EmptyState icon="—" title="No data" sub="Could not load this report. Try Refresh data." />
          ) : (
            <>
              <ExecSummary
                businessName={summary.project.name}
                period={periodLabel}
                text={summary.current?.exec_summary ?? null}
                onRegenerate={handleGenerateSummary}
                regenerating={generating}
              />
              <MoMStats current={summary.current} previous={summary.previous} />
              <KeywordWins wins={summary.keywordWins} />
            </>
          )}
        </>
      )}

      <ExportReportModal
        open={exportOpen}
        summary={summary}
        onClose={() => setExportOpen(false)}
        showToast={showToast}
      />
    </>
  );
}
