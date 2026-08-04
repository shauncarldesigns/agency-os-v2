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
import { ArrowLeft, FileUp, PhoneCall, Plus, Trash2 } from 'lucide-react';

interface PipelinePanelProps {
  showToast: ShowToast;
  onLeadCountChanged?: () => void;
  /** Called when a signed lead is converted into a project. App-level handler decides
   *  whether to switch to the Sites tab and (for Tier 3) deep-link to the new
   *  project's Brief Studio. */
  onQualified?: (project: Project, tier: 1 | 2 | 3) => void;
}

type TierFilter = 'all' | '1' | '2' | '3';
type WebsiteFilter = 'all' | 'has' | 'none';
type PhoneFilter = 'all' | 'review';
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
  const [phoneFilter, setPhoneFilter] = useState<PhoneFilter>('all');
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
  useEffect(() => {
    setSelectedIds(new Set());
    if (view === 'trash') setPhoneFilter('all');
  }, [view]);

  const phoneReviewCount = useMemo(
    () => leads.filter((l) => !l.deleted_at && l.phone_route === 'review').length,
    [leads],
  );

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
    if (view === 'active' && phoneFilter === 'review') list = list.filter(l => l.phone_route === 'review');
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
  }, [leads, view, stage, tier, phoneFilter, enrichment, website, search, sort]);

  return (
    <>
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-base font-bold text-slate-900 sm:text-lg">{view === 'trash' ? 'Pipeline trash' : 'Prospect pipeline'}</div>
          <div className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 sm:text-sm">
            {view === 'trash'
              ? 'Soft-deleted leads. Restore to move them back to the active pipeline.'
              : 'Review prospect fit, outreach progress, latest activity, and the next best action.'}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:justify-end">
          {view === 'active' ? (
            <>
              <button
                onClick={() => setPhoneFilter((current) => current === 'review' ? 'all' : 'review')}
                title="Show leads whose phone route needs manual review"
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition sm:min-h-0 ${phoneFilter === 'review' ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                <PhoneCall className="h-3.5 w-3.5" />
                <span>Phone review</span>
                {phoneReviewCount > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${phoneFilter === 'review' ? 'bg-white/20' : 'bg-amber-100 text-amber-700'}`}>{phoneReviewCount}</span>}
              </button>
              <button onClick={() => setView('trash')} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 sm:min-h-0">
                <Trash2 className="h-3.5 w-3.5" /> Trash {trashCount > 0 && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px]">{trashCount}</span>}
              </button>
              <button onClick={() => setImportOpen(true)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 sm:min-h-0">
                <FileUp className="h-3.5 w-3.5" /> Import CSV
              </button>
              <button onClick={() => setAddOpen(true)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:min-h-0">
                <Plus className="h-3.5 w-3.5" /> Add lead
              </button>
            </>
          ) : (
            <button onClick={() => setView('active')} className="col-span-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 sm:min-h-0">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to active pipeline
            </button>
          )}
        </div>
        </div>
      </section>

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
