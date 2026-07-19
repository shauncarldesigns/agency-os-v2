import { useState, useEffect } from 'react';
import type { Tab, HeaderStats, NavCounts } from './lib/types';
import { api, ApiError } from './lib/api';
import { Header } from './components/layout/Header';
import { Nav } from './components/layout/Nav';
import { DashboardPanel } from './components/dashboard/DashboardPanel';
import { ExecutionView } from './components/dashboard/ExecutionView';
import { ProspectPanel } from './components/prospect/ProspectPanel';
import { PipelinePanel } from './components/pipeline/PipelinePanel';
import { SitesPanel } from './components/sites/SitesPanel';
import { ReportsPanel } from './components/reports/ReportsPanel';
import AutomatedPipelinePanel from './components/leadpipeline/AutomatedPipelinePanel';
import { ToastContainer } from './components/shared/Toast';
import { useToast } from './hooks/useToast';
import { TIER_MRR } from './lib/pricing';

export default function App() {
  // Dashboard is the new default landing tab (Phase 4 flip per spec).
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [stats, setStats] = useState<HeaderStats>({ totalClients: 0, mrrUsd: 0 });
  const [navCounts, setNavCounts] = useState<NavCounts>({ prospect: null, pipeline: 0, sites: 0 });
  // When the Pipeline qualifies a Tier 3 lead we deep-link the operator into
  // the new project's Brief Studio on the Sites tab. The id sticks around
  // until SitesPanel consumes it (then clears it via the callback).
  const [pendingOpenProjectId, setPendingOpenProjectId] = useState<number | null>(null);
  // When a calling session is opened, the execution view takes over the screen.
  // Booking is now inline within ExecutionView itself (Brief-Studio-styled),
  // so no separate booking-modal state lives here.
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
      const clients = projectsRes.projects.filter(p => p.status === 'live' || p.status === 'building');
      const mrr = clients.reduce((sum, p) => sum + (TIER_MRR[p.tier] ?? 0), 0);
      setStats({ totalClients: clients.length, mrrUsd: mrr });
      setNavCounts({
        prospect: null,
        pipeline: activeLeads,
        sites: clients.length,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        showToast('API auth failed — check VITE_API_KEY', 'error');
      } else {
        showToast('Could not reach API', 'error');
      }
    }
  }

  // When the operator's in a calling session, the execution view takes over
  // the entire app — no Header/Nav distractions. Booking lives inline
  // within ExecutionView itself.
  if (openSessionId !== null) {
    return (
      <>
        <ExecutionView
          sessionId={openSessionId}
          showToast={showToast}
          onClose={() => { setOpenSessionId(null); loadStats(); }}
          onPauseAndBuild={(projectId) => {
            // Pause-and-build flow: close the session, deep-link to the
            // freshly-created prospect project's Brief Studio so Quick Brief
            // is one click away. Reuses the same pendingOpenProjectId
            // mechanism the qualify flow already wires up.
            setOpenSessionId(null);
            setPendingOpenProjectId(projectId);
            setActiveTab('sites');
            loadStats();
          }}
        />
        <ToastContainer toasts={toasts} />
      </>
    );
  }

  return (
    <>
      <Header stats={stats} />
      <Nav active={activeTab} onChange={setActiveTab} counts={navCounts} />
      {activeTab === 'automated-pipeline' ? (
        // Rendered outside `.main` so the dark theme's padding/max-width don't
        // clip the full-bleed light-mode design. The panel provides its own
        // container (`.pipeline-scope`) with local reset. Phase 3 folds this
        // into the light-mode sidebar shell.
        <AutomatedPipelinePanel />
      ) : (
        <main className="main">
          {activeTab === 'dashboard' && (
            <DashboardPanel
              showToast={showToast}
              onStateChanged={loadStats}
              onOpenSession={(id) => setOpenSessionId(id)}
              onSwitchTab={setActiveTab}
            />
          )}
          {activeTab === 'prospect' && (
            <ProspectPanel
              showToast={showToast}
              onLeadAdded={loadStats}
            />
          )}
          {activeTab === 'pipeline' && (
            <PipelinePanel
              showToast={showToast}
              onLeadCountChanged={loadStats}
              onQualified={(project, tier) => {
                // T3 → open Brief Studio directly; T1/T2 land on the grid (no
                // Studio exists for those tiers).
                if (tier === 3) setPendingOpenProjectId(project.id);
                setActiveTab('sites');
                loadStats();
              }}
            />
          )}
          {activeTab === 'sites' && (
            <SitesPanel
              showToast={showToast}
              onSwitchTab={setActiveTab}
              initialProjectId={pendingOpenProjectId}
              onInitialProjectConsumed={() => setPendingOpenProjectId(null)}
            />
          )}
          {activeTab === 'reports' && <ReportsPanel showToast={showToast} />}
        </main>
      )}
      <ToastContainer toasts={toasts} />
    </>
  );
}
