import { useState, useEffect } from 'react';
import type { Tab, HeaderStats, NavCounts, BriefsContext, Lead } from './lib/types';
import { api, ApiError } from './lib/api';
import { Header } from './components/layout/Header';
import { Nav } from './components/layout/Nav';
import { ProspectPanel } from './components/prospect/ProspectPanel';
import { PipelinePanel } from './components/pipeline/PipelinePanel';
import { BriefsPanel } from './components/briefs/BriefsPanel';
import { SitesPanel } from './components/sites/SitesPanel';
import { ReportsPanel } from './components/reports/ReportsPanel';
import { ToastContainer } from './components/shared/Toast';
import { useToast } from './hooks/useToast';

const TIER_MRR = { 1: 0, 2: 79, 3: 499 };

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('pipeline');
  const [stats, setStats] = useState<HeaderStats>({ totalClients: 0, mrrUsd: 0 });
  const [navCounts, setNavCounts] = useState<NavCounts>({ prospect: null, pipeline: 0, briefs: 0, sites: 0 });
  const [briefsContext, setBriefsContext] = useState<BriefsContext | null>(null);
  const { toasts, showToast } = useToast();

  async function handleBuildSite(lead: Lead) {
    // The Briefs panel only lists leads with status 'qualified' or 'contacted'
    // (and no project yet). Anything earlier in the funnel won't appear there,
    // so auto-promote on Build to avoid the operator having to flip the status
    // manually before going to the brief page.
    if (lead.status !== 'qualified' && lead.status !== 'contacted' && lead.status !== 'client') {
      try {
        await api.leads.update(lead.id, { status: 'qualified' });
        showToast(`${lead.company} marked qualified`, 'success');
        loadStats();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        showToast(`Couldn't auto-qualify: ${msg}`, 'error');
        // Non-blocking — still navigate so the operator can recover from the Briefs tab
      }
    }
    setBriefsContext({
      leadId: lead.id,
      projectId: lead.project_id ?? undefined,
      businessName: lead.company,
    });
    setActiveTab('briefs');
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
      // Briefs count = leads ready for a homepage demo + projects without a master brief.
      const eligibleLeads = leadsRes.leads.filter(l => (l.status === 'qualified' || l.status === 'contacted') && l.project_id == null).length;
      const briefsCount = eligibleLeads + projectsRes.projects.filter(p => p.status === 'building').length;
      setStats({ totalClients: clients.length, mrrUsd: mrr });
      setNavCounts({
        prospect: null,
        pipeline: activeLeads,
        briefs: briefsCount,
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
        {activeTab === 'briefs' && (
          <BriefsPanel
            context={briefsContext}
            showToast={showToast}
            onClearContext={() => setBriefsContext(null)}
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
