import { useState, useEffect } from 'react';
import type { AgencySettings, Tab, HeaderStats, NavCounts } from './lib/types';
import { api } from './lib/api';
import { AppShell, type NavBadges } from './components/layout/AppShell';
import { DashboardMetricsPanel } from './components/dashboard/DashboardMetricsPanel';
import { ResearchPage } from './components/research/ResearchPage';
import { ProspectPanel } from './components/prospect/ProspectPanel';
import { PipelinePanel } from './components/pipeline/PipelinePanel';
import { SitesPanel } from './components/sites/SitesPanel';
import AutomatedPipelinePanel from './components/leadpipeline/AutomatedPipelinePanel';
import { CallSessionsPage } from './components/sessions/CallSessionsPage';
import { CallCenterPage } from './components/sessions/CallCenterPage';
import { PlaybookPage } from './components/playbook/PlaybookPage';
import { DocsPage } from './components/docs/DocsPage';
import { ToastContainer } from './components/shared/Toast';
import { useToast } from './hooks/useToast';
import { TIER_MRR } from './lib/pricing';
import { SettingsPage } from './components/settings/SettingsPage';
import { BuilderStatusPanel } from './components/leadpipeline/BuilderStatusPanel';
import { ReceptionistInterestPage } from './components/receptionist/ReceptionistInterestPage';
import { ArchivedLeadsPage } from './components/archive/ArchivedLeadsPage';
import { SalesIntelligencePage } from './components/intelligence/SalesIntelligencePage';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [stats, setStats] = useState<HeaderStats>({ totalClients: 0, mrrUsd: 0 });
  const [navCounts, setNavCounts] = useState<NavCounts>({ prospect: null, callOutreach: 0, pipeline: 0, sites: 0 });
  const [receptionistInterestCount, setReceptionistInterestCount] = useState(0);
  const [archivedCleanupCount, setArchivedCleanupCount] = useState(0);
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
  const [openSession, setOpenSession] = useState<{ sessionId: number; leadId?: number } | null>(null);
  const { toasts, showToast } = useToast();
  const [profile, setProfile] = useState<AgencySettings['general']>({
    agencyName: 'Shaun Carl Designs', operatorName: 'Shaun Gehrke',
    operatorEmail: 'info@shauncarldesigns.com', initials: 'SG',
    timezone: 'America/Chicago', currency: 'USD', dateFormat: 'MM/DD/YYYY',
    defaultServiceArea: '', appearance: 'system',
  });

  useEffect(() => {
    loadStats();
    api.settings.get().then(r => setProfile(r.settings.general)).catch(() => undefined);
  }, []);

  async function loadStats() {
    try {
      const [leadsRes, projectsRes] = await Promise.all([
        api.leads.list(),
        api.projects.list().catch(() => ({ projects: [], total: 0 })),
      ]);
      const callbacksRes = await api.callbacks.list({ status: 'pending' }).catch(() => ({ callbacks: [] }));
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
        && (l.phone_route === null || l.phone_route === 'unknown' || l.phone_route === 'text')
        && l.has_website === 0
        && l.enrichment_status === 'enriched'
        && (l.status === 'cold' || l.status === 'contacted')
        && l.deleted_at === null
      ).length;
      const futureCallbackLeadIds = new Set(
        callbacksRes.callbacks
          .filter((cb) => cb.status === 'pending' && cb.due_date > todayIso())
          .map((cb) => cb.lead_id),
      );
      const callOutreach = leadsRes.leads.filter(l =>
        l.deleted_at === null
        && l.pipeline_status !== 'booked'
        && l.pipeline_status !== 'archived'
        && l.phone_route !== 'text'
        && l.phone_route !== 'review'
        && (
          l.status === 'cold'
          || (l.status === 'contacted' && !futureCallbackLeadIds.has(l.id))
        )
      ).length;
      const clients = projectsRes.projects.filter(p => p.is_internal !== 1 && (p.status === 'live' || p.status === 'building'));
      const mrr = clients.reduce((sum, p) => sum + (TIER_MRR[p.tier] ?? 0), 0);
      setStats({ totalClients: clients.length, mrrUsd: mrr });
      setNavCounts({
        prospect: null,
        callOutreach,
        pipeline: activeLeads,
        sites: clients.length,
      });
      setAwaitingBuildCount(awaitingBuild);
      setReceptionistInterestCount(leadsRes.leads.filter((lead) => lead.receptionist_interested === 1 && lead.deleted_at === null).length);
      setArchivedCleanupCount(leadsRes.leads.filter((lead) =>
        lead.pipeline_status === 'archived'
        && lead.demo_site_status === 'cleanup_needed'
        && lead.receptionist_interested !== 1
        && lead.deleted_at === null
      ).length);
    } catch {
      showToast('Could not reach API', 'error');
    }
  }

  const badges: NavBadges = {
    callOutreach: navCounts.callOutreach || null,
    coldCallPipeline: navCounts.pipeline || null,
    automatedPipeline: awaitingBuildCount || null,
    sites: navCounts.sites || null,
    receptionistInterest: receptionistInterestCount || null,
    archivedLeads: archivedCleanupCount || null,
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

  const openSessionView = (id: number, leadId?: number) => {
    setOpenSession({ sessionId: id, leadId });
    setActiveTab('call-center');
  };

  return (
    <>
      <AppShell
        active={activeTab}
        onNavigate={(t) => {
          setActiveTab(t);
          // Call Center owns the execution workspace now. Keep its session
          // reference while visiting other pages so returning restores it.
        }}
        badges={badges}
        headerExtra={headerExtra}
        profile={profile}
      >
        <>
            {activeTab === 'dashboard' && (
              <DashboardMetricsPanel showToast={showToast} onSwitchTab={setActiveTab} />
            )}
            {activeTab === 'research' && (
              <div className="main">
                <ResearchPage showToast={showToast} />
              </div>
            )}
            {activeTab === 'email-outreach' && (
              <CallSessionsPage
                showToast={showToast}
                onStateChanged={loadStats}
                onQualified={(project, tier) => {
                  if (tier === 3) setPendingOpenProjectId(project.id);
                  setActiveTab('sites');
                  loadStats();
                }}
              />
            )}
            {activeTab === 'call-center' && (
              <CallCenterPage
                session={openSession}
                showToast={showToast}
                onOpenSession={openSessionView}
                onCloseSession={() => { setOpenSession(null); loadStats(); }}
                onPauseAndBuild={(projectId) => {
                  setOpenSession(null);
                  setPendingOpenProjectId(projectId);
                  setActiveTab('sites');
                  loadStats();
                }}
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
            {activeTab === 'archived-leads' && <ArchivedLeadsPage showToast={showToast} onChanged={loadStats} />}
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
            {activeTab === 'builder' && (
              <div className="main"><BuilderStatusPanel showToast={showToast} onChanged={loadStats} /></div>
            )}
            {activeTab === 'receptionist-interest' && <ReceptionistInterestPage showToast={showToast} />}
            {activeTab === 'sales-intelligence' && (
              <div className="main"><SalesIntelligencePage /></div>
            )}
            {activeTab === 'sites' && (
              <div className="main">
                <SitesPanel
                  showToast={showToast}
                  initialProjectId={pendingOpenProjectId}
                  onInitialProjectConsumed={() => setPendingOpenProjectId(null)}
                />
              </div>
            )}
            {activeTab === 'docs' && <DocsPage />}
            {activeTab === 'playbook' && <PlaybookPage showToast={showToast} />}
            {activeTab === 'settings' && (
              <SettingsPage showToast={showToast} onProfileChanged={setProfile} />
            )}
        </>
      </AppShell>
      <ToastContainer toasts={toasts} />
    </>
  );
}

function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
