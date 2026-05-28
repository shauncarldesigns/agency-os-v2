import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Lead, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { StageFunnel, type StageFilter } from './StageFunnel';
import { TierStats } from './TierStats';
import { EnrichmentStrip } from './EnrichmentStrip';
import { LeadsTable } from './LeadsTable';
import { LeadModal } from './LeadModal';
import { ImportCsvModal } from './ImportCsvModal';
import { AddLeadModal } from './AddLeadModal';
import { HomepageDemoModal } from './HomepageDemoModal';

interface PipelinePanelProps {
  showToast: ShowToast;
  onLeadCountChanged?: () => void;
}

type TierFilter = 'all' | '1' | '2' | '3';
type WebsiteFilter = 'all' | 'has' | 'none';

export function PipelinePanel({ showToast, onLeadCountChanged }: PipelinePanelProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<StageFilter>('all');
  const [tier, setTier] = useState<TierFilter>('all');
  const [website, setWebsite] = useState<WebsiteFilter>('all');
  const [industry, setIndustry] = useState<string>('');
  const [industries, setIndustries] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'active' | 'trash'>('active');
  const [trashCount, setTrashCount] = useState(0);
  const [openLeadId, setOpenLeadId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [demoLead, setDemoLead] = useState<Lead | null>(null);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof api.leads.list>[0] = view === 'trash' ? { only_deleted: true } : {};
      if (industry) params.industry = industry;
      const [listRes, indRes, trashRes] = await Promise.all([
        api.leads.list(params),
        api.leads.industries().catch(() => ({ industries: [] })),
        view === 'active'
          ? api.leads.list({ only_deleted: true }).then((r) => r.total).catch(() => 0)
          : Promise.resolve(trashCount),
      ]);
      setLeads(listRes.leads);
      setIndustries(indRes.industries);
      if (view === 'active') setTrashCount(trashRes as number);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load leads: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, view, industry, trashCount]);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  const handleLeadUpdated = useCallback(() => {
    loadLeads();
    onLeadCountChanged?.();
  }, [loadLeads, onLeadCountChanged]);

  // Filter for the table — stats show all leads (excluding hidden filters)
  const filtered = useMemo(() => {
    let list = leads;
    if (stage !== 'all') list = list.filter(l => l.status === stage);
    if (tier !== 'all') list = list.filter(l => l.recommended_tier === parseInt(tier, 10));
    // Website presence is only known after enrichment, so both filters scope to
    // enriched leads — this keeps the filtered set in sync with what the
    // Website column actually shows ("No site" badge vs domain).
    if (website === 'none') list = list.filter(l => l.enrichment_status === 'enriched' && !l.website);
    if (website === 'has') list = list.filter(l => l.enrichment_status === 'enriched' && !!l.website);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(l =>
        l.company.toLowerCase().includes(q)
        || (l.city ?? '').toLowerCase().includes(q)
        || (l.contact ?? '').toLowerCase().includes(q)
        || (l.phone ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [leads, stage, tier, website, search]);

  return (
    <>
      <div className="sec-header">
        <div>
          <div className="sec-title">{view === 'trash' ? 'Pipeline — Trash' : 'Pipeline'}</div>
          <div className="sec-sub">
            {view === 'trash'
              ? 'Soft-deleted leads. Restore to move them back to the active pipeline.'
              : 'Cold call tracker — every lead has tier recommendation, review-mined data, and pitch ammo ready'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          {view === 'active' ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setView('trash')}>
                🗑 Trash {trashCount > 0 ? `(${trashCount})` : ''}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>↑ Import CSV</Button>
              <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>+ Add Lead</Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setView('active')}>← Back to active pipeline</Button>
          )}
        </div>
      </div>

      {view === 'active' && (
        <>
          <EnrichmentStrip
            leads={leads}
            showToast={showToast}
            onComplete={loadLeads}
          />

          <StageFunnel leads={leads} active={stage} onChange={setStage} />

          <TierStats leads={leads} />
        </>
      )}

      <div className="fbar">
        <div className="swrap">
          <span className="sicon">🔍</span>
          <input
            type="text"
            placeholder="Search company, city, contact, phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="fsel" value={industry} onChange={e => setIndustry(e.target.value)}>
          <option value="">All Industries</option>
          {industries.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        {view === 'active' && (
          <select className="fsel" value={tier} onChange={e => setTier(e.target.value as TierFilter)}>
            <option value="all">All Tiers</option>
            <option value="3">Tier 3 only</option>
            <option value="2">Tier 2 only</option>
            <option value="1">Tier 1 only</option>
          </select>
        )}
        {view === 'active' && (
          <select className="fsel" value={website} onChange={e => setWebsite(e.target.value as WebsiteFilter)}>
            <option value="all">All Websites</option>
            <option value="none">No website</option>
            <option value="has">Has website</option>
          </select>
        )}
      </div>

      {loading ? (
        <div className="twrap" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)' }}>
          <Spinner /> Loading leads…
        </div>
      ) : (
        <LeadsTable
          leads={filtered}
          showToast={showToast}
          onLeadUpdated={handleLeadUpdated}
          onOpenLead={setOpenLeadId}
          onHomepageDemo={setDemoLead}
        />
      )}

      <LeadModal
        open={openLeadId != null}
        leadId={openLeadId}
        onClose={() => setOpenLeadId(null)}
        showToast={showToast}
        onLeadUpdated={handleLeadUpdated}
        onHomepageDemo={setDemoLead}
      />

      <HomepageDemoModal
        open={demoLead !== null}
        lead={demoLead}
        onClose={() => setDemoLead(null)}
        showToast={showToast}
      />

      <ImportCsvModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        showToast={showToast}
        onImported={handleLeadUpdated}
      />

      <AddLeadModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        showToast={showToast}
        onAdded={handleLeadUpdated}
      />
    </>
  );
}
