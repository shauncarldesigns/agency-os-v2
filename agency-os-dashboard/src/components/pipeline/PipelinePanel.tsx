import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Lead, Project, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { StageFunnel, type StageFilter } from './StageFunnel';
import { TierStats } from './TierStats';
import { EnrichmentStrip } from './EnrichmentStrip';
import { LeadsTable } from './LeadsTable';
import { LeadDetailModal } from '../shared/LeadDetailModal';
import { ImportCsvModal } from './ImportCsvModal';
import { AddLeadModal } from './AddLeadModal';
import { QualifyLeadModal } from './QualifyLeadModal';

interface PipelinePanelProps {
  showToast: ShowToast;
  onLeadCountChanged?: () => void;
  /** Called when a lead is qualified into a project. App-level handler decides
   *  whether to switch to the Sites tab and (for Tier 3) deep-link to the new
   *  project's Brief Studio. */
  onQualified?: (project: Project, tier: 1 | 2 | 3) => void;
}

type TierFilter = 'all' | '1' | '2' | '3';
type WebsiteFilter = 'all' | 'has' | 'none';
// Enrichment status filter. Mirrors lead.enrichment_status's four values so
// the operator can quickly slice to "leads still pending enrichment" or
// "leads that failed and need a retry" without scrolling.
type EnrichmentFilter = 'all' | 'enriched' | 'pending' | 'enriching' | 'failed';
// Sort options for the pipeline table. 'default' preserves the backend's
// updated_at DESC ordering; the others let the operator triage by signal
// strength (most reviews = most established business, highest score =
// best opportunity, highest rating = strongest customer signal).
type SortMode = 'default' | 'reviews' | 'score' | 'rating';

export function PipelinePanel({ showToast, onLeadCountChanged, onQualified }: PipelinePanelProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<StageFilter>('all');
  const [tier, setTier] = useState<TierFilter>('all');
  const [website, setWebsite] = useState<WebsiteFilter>('all');
  const [enrichment, setEnrichment] = useState<EnrichmentFilter>('all');
  const [sort, setSort] = useState<SortMode>('default');
  const [industry, setIndustry] = useState<string>('');
  const [industries, setIndustries] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'active' | 'trash'>('active');
  const [trashCount, setTrashCount] = useState(0);
  const [openLeadId, setOpenLeadId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [qualifyLead, setQualifyLead] = useState<Lead | null>(null);
  // Bulk-select state for re-enrichment. Stored as a Set so toggling is O(1)
  // and an empty selection means "no bulk action queued".
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

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

  // Drop selections on view switch (active ↔ trash) so the operator doesn't
  // accidentally re-enrich something they can no longer see. Filter changes
  // keep selection intentionally — the operator may pick across filters.
  useEffect(() => { setSelectedIds(new Set()); }, [view]);

  const toggleSelected = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setSelectionForVisible = useCallback((visibleIds: number[], on: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  // Filter for the table — stats show all leads (excluding hidden filters)
  const filtered = useMemo(() => {
    let list = leads;
    if (stage !== 'all') list = list.filter(l => l.status === stage);
    if (tier !== 'all') list = list.filter(l => l.recommended_tier === parseInt(tier, 10));
    if (enrichment !== 'all') list = list.filter(l => l.enrichment_status === enrichment);
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
    // Sort step. 'default' = backend's updated_at DESC; others sort the
    // filtered list DESC by the requested signal, nulls last so unenriched
    // rows sink rather than masquerade as zero.
    if (sort !== 'default') {
      const key: (l: Lead) => number | null =
        sort === 'reviews' ? (l) => l.google_review_count
        : sort === 'score' ? (l) => l.opportunity_score
        : (l) => l.google_rating;
      list = [...list].sort((a, b) => {
        const av = key(a);
        const bv = key(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      });
    }
    return list;
  }, [leads, stage, tier, enrichment, website, search, sort]);

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
            selectedIds={selectedIds}
            onClearSelection={() => setSelectedIds(new Set())}
            showToast={showToast}
            onComplete={() => { loadLeads(); setSelectedIds(new Set()); }}
          />

          <StageFunnel leads={leads} active={stage} onChange={setStage} />

          <TierStats leads={leads} />
        </>
      )}

      {view === 'trash' && selectedIds.size > 0 && (
        <TrashBulkStrip
          selectedCount={selectedIds.size}
          onClear={() => setSelectedIds(new Set())}
          onConfirm={async () => {
            const ids = Array.from(selectedIds);
            if (!window.confirm(
              `Permanently delete ${ids.length} lead${ids.length === 1 ? '' : 's'}? ` +
              `This cannot be undone — all call history for these leads will be lost.`
            )) return;
            const results = await Promise.allSettled(ids.map((id) => api.leads.hardDelete(id)));
            const failed = results.filter((r) => r.status === 'rejected').length;
            if (failed === 0) {
              showToast(`${ids.length} lead${ids.length === 1 ? '' : 's'} permanently deleted`, 'success');
            } else {
              showToast(`${ids.length - failed} deleted, ${failed} failed`, failed === ids.length ? 'error' : 'default');
            }
            setSelectedIds(new Set());
            loadLeads();
          }}
        />
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
          <select className="fsel" value={enrichment} onChange={e => setEnrichment(e.target.value as EnrichmentFilter)}>
            <option value="all">All Enrichment</option>
            <option value="enriched">✓ Enriched</option>
            <option value="pending">⏳ Pending</option>
            <option value="enriching">⚙ Enriching now</option>
            <option value="failed">⚠ Failed</option>
          </select>
        )}
        {view === 'active' && (
          <select className="fsel" value={website} onChange={e => setWebsite(e.target.value as WebsiteFilter)}>
            <option value="all">All Websites</option>
            <option value="none">No website</option>
            <option value="has">Has website</option>
          </select>
        )}
        {view === 'active' && (
          <select className="fsel" value={sort} onChange={e => setSort(e.target.value as SortMode)}>
            <option value="default">Sort: Recently updated</option>
            <option value="reviews">Sort: Most reviews</option>
            <option value="score">Sort: Highest score</option>
            <option value="rating">Sort: Highest rating</option>
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
          selectedIds={selectedIds}
          onToggleSelected={toggleSelected}
          onToggleAllVisible={(on) => setSelectionForVisible(filtered.map((l) => l.id), on)}
          showToast={showToast}
          onLeadUpdated={handleLeadUpdated}
          onOpenLead={setOpenLeadId}
          onQualify={setQualifyLead}
        />
      )}

      {openLeadId != null && (
        <LeadDetailModal
          leadId={openLeadId}
          onClose={() => setOpenLeadId(null)}
          showToast={showToast}
          onLeadUpdated={handleLeadUpdated}
          onQualify={setQualifyLead}
        />
      )}

      <QualifyLeadModal
        open={qualifyLead !== null}
        lead={qualifyLead}
        onClose={() => setQualifyLead(null)}
        showToast={showToast}
        onQualified={(project, tier) => {
          handleLeadUpdated();
          onQualified?.(project, tier);
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

// Bulk-delete strip for the trash view. Mirrors the EnrichmentStrip pattern
// (visible only when there's a selection; lets the operator clear or confirm).
// Kept inline rather than promoted to its own file because it's small and
// trash-view-specific.
interface TrashBulkStripProps {
  selectedCount: number;
  onClear: () => void;
  onConfirm: () => void | Promise<void>;
}

function TrashBulkStrip({ selectedCount, onClear, onConfirm }: TrashBulkStripProps) {
  const [deleting, setDeleting] = useState(false);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '10px 14px', marginBottom: 12,
        background: 'rgba(248,113,113,0.06)',
        border: '1px solid rgba(248,113,113,0.35)',
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>
        <strong style={{ color: 'var(--red)' }}>{selectedCount}</strong>{' '}
        {selectedCount === 1 ? 'lead' : 'leads'} selected for permanent deletion
      </div>
      <div style={{ display: 'flex', gap: 7 }}>
        <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
        <Button
          variant="primary"
          size="sm"
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            try { await onConfirm(); } finally { setDeleting(false); }
          }}
          style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
        >
          {deleting ? '⏳ Deleting…' : `🗑 Delete forever (${selectedCount})`}
        </Button>
      </div>
    </div>
  );
}
