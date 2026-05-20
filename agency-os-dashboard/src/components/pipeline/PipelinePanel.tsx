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

interface PipelinePanelProps {
  showToast: ShowToast;
  onLeadCountChanged?: () => void;
  onBuildSite?: (lead: Lead) => void;
}

type TierFilter = 'all' | '1' | '2' | '3';

export function PipelinePanel({ showToast, onLeadCountChanged, onBuildSite }: PipelinePanelProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<StageFilter>('all');
  const [tier, setTier] = useState<TierFilter>('all');
  const [search, setSearch] = useState('');
  const [openLeadId, setOpenLeadId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.leads.list();
      setLeads(res.leads);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load leads: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

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
  }, [leads, stage, tier, search]);

  return (
    <>
      <div className="sec-header">
        <div>
          <div className="sec-title">Pipeline</div>
          <div className="sec-sub">Cold call tracker — every lead has tier recommendation, review-mined data, and pitch ammo ready</div>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>↑ Import CSV</Button>
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>+ Add Lead</Button>
        </div>
      </div>

      <EnrichmentStrip
        leads={leads}
        showToast={showToast}
        onComplete={loadLeads}
      />

      <StageFunnel leads={leads} active={stage} onChange={setStage} />

      <TierStats leads={leads} />

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
        <select className="fsel" value={tier} onChange={e => setTier(e.target.value as TierFilter)}>
          <option value="all">All Tiers</option>
          <option value="3">Tier 3 only</option>
          <option value="2">Tier 2 only</option>
          <option value="1">Tier 1 only</option>
        </select>
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
          onBuildSite={lead => {
            if (onBuildSite) onBuildSite(lead);
            else showToast('Build tab is not available in this view', 'default');
          }}
        />
      )}

      <LeadModal
        open={openLeadId != null}
        leadId={openLeadId}
        onClose={() => setOpenLeadId(null)}
        showToast={showToast}
        onLeadUpdated={handleLeadUpdated}
        onBuildSite={lead => {
          if (onBuildSite) onBuildSite(lead);
          else showToast('Build tab is not available in this view', 'default');
        }}
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
