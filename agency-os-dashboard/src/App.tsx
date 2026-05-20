import { useState, useEffect } from 'react';
import type { Tab, HeaderStats, NavCounts, BuildContext, Lead } from './lib/types';
import { api, ApiError } from './lib/api';
import { Header } from './components/layout/Header';
import { Nav } from './components/layout/Nav';
import { ProspectPanel } from './components/prospect/ProspectPanel';
import { PipelinePanel } from './components/pipeline/PipelinePanel';
import { BuildPanel } from './components/build/BuildPanel';
import { SitesPanel } from './components/sites/SitesPanel';
import { ReportsPanel } from './components/reports/ReportsPanel';
import { ToastContainer } from './components/shared/Toast';
import { useToast } from './hooks/useToast';

const TIER_MRR = { 1: 0, 2: 79, 3: 499 };

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('pipeline');
  const [stats, setStats] = useState<HeaderStats>({ totalClients: 0, mrrUsd: 0 });
  const [navCounts, setNavCounts] = useState<NavCounts>({ prospect: null, pipeline: 0, build: 0, sites: 0 });
  const [buildContext, setBuildContext] = useState<BuildContext | null>(null);
  const { toasts, showToast } = useToast();

  function handleBuildSite(lead: Lead) {
    if (lead.recommended_tier == null || ![1, 2, 3].includes(lead.recommended_tier)) {
      showToast('Lead has no recommended tier — enrich first', 'error');
      return;
    }
    setBuildContext({
      leadId: lead.id,
      businessName: lead.company,
      tier: lead.recommended_tier as 1 | 2 | 3,
      reviewCount: lead.google_review_count,
    });
    setActiveTab('build');
  }

  useEffect(() => { loadStats(); }, []);

  async function loadStats() {
    try {
      const [leadsRes, projectsRes] = await Promise.all([
        api.leads.list(),
        api.projects.list().catch(() => ({ projects: [], total: 0 })),
      ]);
      const activeLeads = leadsRes.leads.filter(l => l.status !== 'dead' && l.status !== 'client').length;
      const clients = projectsRes.projects.filter(p => p.status === 'live' || p.status === 'building');
      const mrr = clients.reduce((sum, p) => sum + (TIER_MRR[p.tier] ?? 0), 0);
      const buildingCount = projectsRes.projects.filter(p => p.status === 'building').length;
      setStats({ totalClients: clients.length, mrrUsd: mrr });
      setNavCounts({
        prospect: null,
        pipeline: activeLeads,
        build: buildingCount,
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
      <Header stats={stats} coworkConnected={false} />
      <Nav active={activeTab} onChange={setActiveTab} counts={navCounts} />
      <main className="main">
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
            onBuildSite={handleBuildSite}
          />
        )}
        {activeTab === 'build' && (
          <BuildPanel
            context={buildContext}
            showToast={showToast}
            onClearContext={() => setBuildContext(null)}
            onProjectCreated={loadStats}
          />
        )}
        {activeTab === 'sites' && (
          <SitesPanel
            showToast={showToast}
            onSwitchTab={setActiveTab}
          />
        )}
        {activeTab === 'reports' && <ReportsPanel showToast={showToast} />}
      </main>
      <ToastContainer toasts={toasts} />
    </>
  );
}
