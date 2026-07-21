import { useState, useEffect } from 'react';
import type { Tab, HeaderStats, NavCounts } from './lib/types';
import { api, ApiError } from './lib/api';
import { AppShell, type NavBadges } from './components/layout/AppShell';
import { ExecutionView } from './components/dashboard/ExecutionView';
import { DashboardMetricsPanel } from './components/dashboard/DashboardMetricsPanel';
import { ProspectPanel } from './components/prospect/ProspectPanel';
import { PipelinePanel } from './components/pipeline/PipelinePanel';
import { SitesPanel } from './components/sites/SitesPanel';
import { ReportsPanel } from './components/reports/ReportsPanel';
import AutomatedPipelinePanel from './components/leadpipeline/AutomatedPipelinePanel';
import { CallSessionsPage } from './components/sessions/CallSessionsPage';
import { PlaybookPage } from './components/playbook/PlaybookPage';
import { DocsPage } from './components/docs/DocsPage';
import { ToastContainer } from './components/shared/Toast';
import { useToast } from './hooks/useToast';
import { TIER_MRR } from './lib/pricing';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [stats, setStats] = useState<HeaderStats>({ totalClients: 0, mrrUsd: 0 });
  const [navCounts, setNavCounts] = useState<NavCounts>({ prospect: null, pipeline: 0, sites: 0 });
  // Count of automated-pipeline leads still awaiting a site build — drives
  // the sidebar badge. Computed from the same leads fetch as the other nav
  // counts (leads.list returns pipeline_status).
  const [awaitingBuildCount, setAwaitingBuildCount] = useState(0);
  // When the Pipeline qualifies a Tier 3 lead we deep-link the operator into
  // the new project's Brief Studio on the Sites tab. The id sticks around
  // until SitesPanel consumes it (then clears it via the callback).
  const [pendingOpenProjectId, setPendingOpenProjectId] = useState<number | null>(null);
  // Since the Phase 3 shell migration, an open calling session renders
  // INSIDE the shell's <main> (sidebar stays visible) instead of taking
  // over the whole viewport.
  const [openSessionId, setOpenSessionId] = useState<number | null>(null);
  const { toasts, showToast } = useToast();

  useEffect(() => { loadStats(); }, []);

  async function loadStats() {
    try {
      const [leadsRes, projectsRes] = await Promise.all([
        api.leads.list(),
        api.projects.list().catch(() => ({ projects: [], total: 0 })),
      ]);
      // Active = still in the calling pool. Excludes qualified (demo booked,
      // managed from Sites), client (signed), not_interested, and dead.
      const activeLeads = leadsRes.leads.filter(l =>
        l.status !== 'qualified'
        && l.status !== 'client'
        && l.status !== 'not_interested'
        && l.status !== 'dead'
      ).length;
      const awaitingBuild = leadsRes.leads.filter(l =>
        l.pipeline_status === 'awaiting_build'
        && l.has_website === 0
        && l.enrichment_status === 'enriched'
        && (l.status === 'cold' || l.status === 'contacted')
        && l.deleted_at === null
      ).length;
      const clients = projectsRes.projects.filter(p => p.status === 'live' || p.status === 'building');
      const mrr = clients.reduce((sum, p) => sum + (TIER_MRR[p.tier] ?? 0), 0);
      setStats({ totalClients: clients.length, mrrUsd: mrr });
      setNavCounts({
        prospect: null,
        pipeline: activeLeads,
        sites: clients.length,
      });
      setAwaitingBuildCount(awaitingBuild);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        showToast('API auth failed — check VITE_API_KEY', 'error');
      } else {
        showToast('Could not reach API', 'error');
      }
    }
  }

  const badges: NavBadges = {
    coldCallPipeline: navCounts.pipeline || null,
    automatedPipeline: awaitingBuildCount || null,
    sites: navCounts.sites || null,
  };

  const headerExtra = (
    <div className="hidden items-center gap-3 text-xs text-slate-500 sm:flex">
      <span>
        <span className="font-semibold text-slate-900">{stats.totalClients}</span> clients
      </span>
      <span className="text-slate-300">·</span>
      <span>
        <span className="font-semibold text-slate-900">
          ${stats.mrrUsd.toLocaleString()}
        </span>{' '}
        MRR
      </span>
    </div>
  );

  const openSession = (id: number) => setOpenSessionId(id);

  return (
    <>
      <AppShell
        active={activeTab}
        onNavigate={(t) => {
          setActiveTab(t);
          // Navigating away from a live session view closes it — the session
          // itself stays active server-side and can be resumed from
          // Dashboard or Call Sessions.
          setOpenSessionId(null);
        }}
        badges={badges}
        headerExtra={headerExtra}
      >
        {openSessionId !== null ? (
          <ExecutionView
            sessionId={openSessionId}
            showToast={showToast}
            onClose={() => { setOpenSessionId(null); loadStats(); }}
            onPauseAndBuild={(projectId) => {
              // Pause-and-build flow: close the session, deep-link to the
              // freshly-created prospect project's Brief Studio so Quick Brief
              // is one click away.
              setOpenSessionId(null);
              setPendingOpenProjectId(projectId);
              setActiveTab('sites');
              loadStats();
            }}
          />
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <DashboardMetricsPanel showToast={showToast} onSwitchTab={setActiveTab} />
            )}
            {activeTab === 'call-sessions' && (
              <CallSessionsPage
                showToast={showToast}
                onOpenSession={openSession}
                onStateChanged={loadStats}
                onSwitchTab={setActiveTab}
              />
            )}
            {activeTab === 'prospect' && (
              <div className="main">
                <ProspectPanel showToast={showToast} onLeadAdded={loadStats} />
              </div>
            )}
            {activeTab === 'pipeline' && (
              <div className="main">
                <PipelinePanel
                  showToast={showToast}
                  onLeadCountChanged={loadStats}
                  onQualified={(project, tier) => {
                    // T3 → open Brief Studio directly; T1/T2 land on the grid
                    // (no Studio exists for those tiers).
                    if (tier === 3) setPendingOpenProjectId(project.id);
                    setActiveTab('sites');
                    loadStats();
                  }}
                />
              </div>
            )}
            {activeTab === 'automated-pipeline' && (
              <AutomatedPipelinePanel
                showToast={showToast}
                onQualified={(project, tier) => {
                  if (tier === 3) setPendingOpenProjectId(project.id);
                  setActiveTab('sites');
                  loadStats();
                }}
              />
            )}
            {activeTab === 'sites' && (
              <div className="main">
                <SitesPanel
                  showToast={showToast}
                  onSwitchTab={setActiveTab}
                  initialProjectId={pendingOpenProjectId}
                  onInitialProjectConsumed={() => setPendingOpenProjectId(null)}
                />
              </div>
            )}
            {activeTab === 'docs' && <DocsPage />}
            {activeTab === 'playbook' && <PlaybookPage showToast={showToast} />}
            {activeTab === 'reports' && (
              <div className="main">
                <ReportsPanel showToast={showToast} />
              </div>
            )}
          </>
        )}
      </AppShell>
      <ToastContainer toasts={toasts} />
    </>
  );
}
