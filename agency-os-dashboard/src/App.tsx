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
import { ToastContainer } from './components/shared/Toast';
import { useToast } from './hooks/useToast';
import { TIER_MRR } from './lib/pricing';

// Phase-5 fallbacks for the BookDemoModal (Phase 6 replaces these).
function defaultDemoDateTime(): string {
  const d = new Date();
  d.setHours(d.getHours() + 24, 0, 0, 0);
  // Local-tz YYYY-MM-DDTHH:MM (no seconds, no zone) — matches the prompt
  // example format the operator will type.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toIsoLocal(s: string): string {
  // Operator entered local-tz datetime (no zone). Construct a Date in local tz,
  // then return its ISO string. Backend stores as UTC, displays via Chicago tz.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

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
  // Cleared on close; passes through to a Phase 6 booking modal (stub here).
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
          onBookDemo={(lead, onConfirm) => {
            // Phase 6 wires the HoneyBook split-pane. Phase 5 ships a
            // window.prompt fallback so the outcome can still be recorded
            // and the lead lifecycle ticks correctly.
            const datePrompt = window.prompt(
              `Booked demo with ${lead.company} — when?\n\n` +
              `Enter scheduled datetime as YYYY-MM-DDTHH:MM (24h, your local time):`,
              defaultDemoDateTime()
            );
            if (!datePrompt) return;
            const hbConfirmed = window.confirm(
              `HoneyBook step\n\n` +
              `Did you submit the HoneyBook form?\n\n` +
              `(OK = yes, Cancel = no — you can mark it later.)`
            );
            void onConfirm(toIsoLocal(datePrompt), hbConfirmed);
          }}
        />
      )}
    </>
  );
}
