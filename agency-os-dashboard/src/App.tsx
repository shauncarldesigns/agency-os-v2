import { useState, useEffect } from 'react';
import type { Tab, HeaderStats, NavCounts } from './lib/types';
import { api, ApiError } from './lib/api';
import { Header } from './components/layout/Header';
import { Nav } from './components/layout/Nav';
import { DashboardPanel } from './components/dashboard/DashboardPanel';
import { ExecutionView } from './components/dashboard/ExecutionView';
import { BookDemoModal } from './components/dashboard/BookDemoModal';
import { ProspectPanel } from './components/prospect/ProspectPanel';
import { PipelinePanel } from './components/pipeline/PipelinePanel';
import { SitesPanel } from './components/sites/SitesPanel';
import { ReportsPanel } from './components/reports/ReportsPanel';
import { ToastContainer } from './components/shared/Toast';
import { useToast } from './hooks/useToast';
import { TIER_MRR } from './lib/pricing';
import type { Lead } from './lib/types';

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
  const [openSessionId, setOpenSessionId] = useState<number | null>(null);
  // Book-demo modal state — driven by the execution view's "Booked" outcome.
  // Holds the lead being booked + the callback that records the outcome once
  // the operator confirms.
  const [bookingState, setBookingState] = useState<{
    lead: Lead;
    onConfirm: (scheduledFor: string, honeybookConfirmed: boolean) => Promise<void>;
  } | null>(null);
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

  return (
    <>
      <Header stats={stats} />
      <Nav active={activeTab} onChange={setActiveTab} counts={navCounts} />
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
      <ToastContainer toasts={toasts} />

      {openSessionId !== null && (
        <ExecutionView
          sessionId={openSessionId}
          showToast={showToast}
          onClose={() => { setOpenSessionId(null); loadStats(); }}
          onBookDemo={(lead, onConfirm) => setBookingState({ lead, onConfirm })}
        />
      )}

      <BookDemoModal
        open={bookingState !== null}
        lead={bookingState?.lead ?? null}
        showToast={showToast}
        onClose={() => setBookingState(null)}
        onConfirm={async (scheduledFor, hbConfirmed) => {
          if (!bookingState) return;
          await bookingState.onConfirm(scheduledFor, hbConfirmed);
          setBookingState(null);
        }}
      />
    </>
  );
}
