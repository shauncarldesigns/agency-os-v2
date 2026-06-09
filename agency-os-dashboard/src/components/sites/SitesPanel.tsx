import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Project, Lead, ShowToast, Tab } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { SiteCard } from './SiteCard';
import { SiteDetailPanel } from './SiteDetailPanel';
import { OperatorInputForm } from '../briefs/OperatorInputForm';
import { QuickBriefModal } from './QuickBriefModal';

interface SitesPanelProps {
  showToast: ShowToast;
  onSwitchTab: (tab: Tab) => void;
  /** When App.tsx hands us a project id (e.g. from a fresh Pipeline qualify
   *  on a Tier 3 lead), open its Brief Studio detail on arrival. */
  initialProjectId?: number | null;
  /** Tell App.tsx we consumed the initialProjectId so it can clear state. */
  onInitialProjectConsumed?: () => void;
}

type Sort = 'tier' | 'due' | 'az';
/**
 * Which slice of projects the grid renders. Click a stat tile to toggle a
 * filter; clicking the active tile clears back to 'all'. Tiles are
 * mutually exclusive — the operator picks one at a time, no compound
 * filtering. Filter is purely client-side over the already-fetched list.
 */
type StatusFilter = 'all' | 'active' | 'prospect' | 't3' | 't2' | 't1';

const TIER_MRR = { 1: 0, 2: 79, 3: 499 } as const;

/**
 * The unified project editor (OperatorInputForm) needs hasMaster + lead.
 * SitesPanel doesn't track per-project briefs/leads itself — it lazily
 * fetches them when the modal opens so the form can render in the right
 * mode (Generate vs Regenerate) and seed testimonials from the lead.
 */
interface EditorContext {
  project: Project;
  lead: Lead | null;
  hasMaster: boolean;
}

export function SitesPanel({
  showToast, onSwitchTab, initialProjectId, onInitialProjectConsumed,
}: SitesPanelProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>('tier');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [detailProjectId, setDetailProjectId] = useState<number | null>(null);
  const [editorCtx, setEditorCtx] = useState<EditorContext | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  // Quick brief modal — keyed on { project, lead } where lead is fetched
  // lazily so we can show the freshest reviews after any re-enrichment.
  const [quickBriefCtx, setQuickBriefCtx] = useState<{ project: Project; lead: Lead | null } | null>(null);
  const [quickBriefLoading, setQuickBriefLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.projects.list();
      setProjects(res.projects);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load sites: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (initialProjectId == null) return;
    if (loading) return;
    const project = projects.find((p) => p.id === initialProjectId);
    if (project && project.tier === 3) {
      setDetailProjectId(initialProjectId);
    }
    onInitialProjectConsumed?.();
  }, [initialProjectId, loading, projects, onInitialProjectConsumed]);

  /**
   * Open the editor modal for a project. Fetches the lead + master brief in
   * parallel so the form can render with the right title/buttons immediately
   * (avoids a flash where it looks like "Generate" before flipping to "Edit").
   */
  const openEditor = useCallback(async (project: Project) => {
    setEditorLoading(true);
    try {
      const [leadRes, masterRes] = await Promise.all([
        project.lead_id
          ? api.leads.get(project.lead_id).then((r) => r.lead).catch(() => null)
          : Promise.resolve(null),
        api.briefs.getMaster(project.id).catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
      ]);
      setEditorCtx({ project, lead: leadRes, hasMaster: !!masterRes });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not open editor: ${msg}`, 'error');
    } finally {
      setEditorLoading(false);
    }
  }, [showToast]);

  /**
   * Open the quick brief modal. Pulls a fresh lead (if linked) so the
   * reviews block reflects the latest enrichment rather than the snapshot
   * taken at project-create time. Falls back to project.reviews_snapshot
   * if the lead is gone or unlinkable.
   */
  const openQuickBrief = useCallback(async (project: Project) => {
    setQuickBriefLoading(true);
    try {
      const lead = project.lead_id
        ? await api.leads.get(project.lead_id).then((r) => r.lead).catch(() => null)
        : null;
      setQuickBriefCtx({ project, lead });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not open quick brief: ${msg}`, 'error');
    } finally {
      setQuickBriefLoading(false);
    }
  }, [showToast]);

  const sorted = useMemo(() => {
    // Filter first (cheap, narrows the set), then sort the remainder.
    const isActive = (p: Project) => p.status === 'live' || p.status === 'building';
    let list = projects.filter((p) => {
      switch (filter) {
        case 'active':   return isActive(p);
        case 'prospect': return p.status === 'prospect';
        case 't3':       return isActive(p) && p.tier === 3;
        case 't2':       return isActive(p) && p.tier === 2;
        case 't1':       return isActive(p) && p.tier === 1;
        case 'all':
        default:         return true;
      }
    });
    list = [...list];
    if (sort === 'tier') list.sort((a, b) => b.tier - a.tier);
    else if (sort === 'az') list.sort((a, b) => a.business_name.localeCompare(b.business_name));
    else if (sort === 'due') list.sort((a, b) => {
      const aDate = a.next_pages_due ? Date.parse(a.next_pages_due) : Infinity;
      const bDate = b.next_pages_due ? Date.parse(b.next_pages_due) : Infinity;
      return aDate - bDate;
    });
    return list;
  }, [projects, sort, filter]);

  const stats = useMemo(() => {
    // Active clients drive every MRR-style stat — projects in 'prospect'
    // status are qualified-but-unsigned and shouldn't inflate the numbers.
    const active = projects.filter(p => p.status === 'live' || p.status === 'building');
    const prospects = projects.filter(p => p.status === 'prospect');
    const t3 = active.filter(p => p.tier === 3);
    const t2 = active.filter(p => p.tier === 2);
    const t1 = active.filter(p => p.tier === 1);
    const t3Mrr = t3.length * TIER_MRR[3];
    const t2Mrr = t2.length * TIER_MRR[2];
    return {
      total: active.length,
      prospects: prospects.length,
      t3: t3.length,
      t2: t2.length,
      t1: t1.length,
      t3Mrr,
      t2Mrr,
    };
  }, [projects]);

  const editorElement = editorCtx && (
    <OperatorInputForm
      open={true}
      onClose={() => setEditorCtx(null)}
      project={editorCtx.project}
      lead={editorCtx.lead}
      hasMaster={editorCtx.hasMaster}
      showToast={showToast}
      onBriefGenerated={() => { void load(); }}
      onProjectSaved={() => { void load(); }}
      onDeleted={() => {
        setDetailProjectId(null);
        void load();
      }}
    />
  );

  const quickBriefElement = quickBriefCtx && (
    <QuickBriefModal
      open={true}
      onClose={() => setQuickBriefCtx(null)}
      project={quickBriefCtx.project}
      lead={quickBriefCtx.lead}
      showToast={showToast}
    />
  );

  const detailProject = detailProjectId != null
    ? projects.find((p) => p.id === detailProjectId) ?? null
    : null;

  if (detailProject) {
    return (
      <>
        <SiteDetailPanel
          project={detailProject}
          showToast={showToast}
          onSwitchTab={onSwitchTab}
          onBack={() => setDetailProjectId(null)}
          onProjectChanged={load}
          onEditProject={() => openEditor(detailProject)}
          onQuickBrief={() => openQuickBrief(detailProject)}
        />
        {editorElement}
        {quickBriefElement}
        {(editorLoading || quickBriefLoading) && <ModalLoaderHint />}
      </>
    );
  }

  return (
    <>
      <div className="sec-header">
        <div>
          <div className="sec-title">Sites</div>
          <div className="sec-sub">
            {filter === 'all'
              ? 'All client projects · click a tile below to filter'
              : `Filtered: ${filterLabel(filter)} · `}
            {filter !== 'all' && (
              <button
                type="button"
                onClick={() => setFilter('all')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  font: 'inherit',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                clear filter
              </button>
            )}
          </div>
        </div>
        <select className="fsel" value={sort} onChange={e => setSort(e.target.value as Sort)}>
          <option value="tier">Sort: Tier (high to low)</option>
          <option value="due">Sort: Update due</option>
          <option value="az">Sort: A-Z</option>
        </select>
      </div>

      <div className="stats-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <StatTile
          active={filter === 'active'}
          onClick={() => setFilter((f) => (f === 'active' ? 'all' : 'active'))}
          variant="scard"
        >
          <div className="snum">{stats.total}</div>
          <div className="slabel">Active Clients</div>
          <div className="sdelta">${(stats.t3Mrr + stats.t2Mrr).toLocaleString()}/mo total MRR</div>
        </StatTile>
        <StatTile
          active={filter === 'prospect'}
          onClick={() => setFilter((f) => (f === 'prospect' ? 'all' : 'prospect'))}
          variant="scard prospect"
        >
          <div className="snum" style={{ color: 'var(--yellow)' }}>{stats.prospects}</div>
          <div className="slabel">Prospects</div>
          <div className="sdelta">Qualified · not yet signed</div>
        </StatTile>
        <StatTile
          active={filter === 't3'}
          onClick={() => setFilter((f) => (f === 't3' ? 'all' : 't3'))}
          variant="tier-stat t3"
        >
          <div className="tier-num t3">{stats.t3}</div>
          <div className="slabel" style={{ color: 'var(--tier3)' }}>Tier 3 active</div>
          <div className="sdelta">${stats.t3Mrr.toLocaleString()}/mo recurring</div>
        </StatTile>
        <StatTile
          active={filter === 't2'}
          onClick={() => setFilter((f) => (f === 't2' ? 'all' : 't2'))}
          variant="tier-stat t2"
        >
          <div className="tier-num t2">{stats.t2}</div>
          <div className="slabel" style={{ color: 'var(--tier2)' }}>Tier 2 active</div>
          <div className="sdelta">${stats.t2Mrr.toLocaleString()}/mo recurring</div>
        </StatTile>
        <StatTile
          active={filter === 't1'}
          onClick={() => setFilter((f) => (f === 't1' ? 'all' : 't1'))}
          variant="tier-stat t1"
        >
          <div className="tier-num t1">{stats.t1}</div>
          <div className="slabel" style={{ color: 'var(--tier1)' }}>Tier 1 (handed off)</div>
          <div className="sdelta">No ongoing work</div>
        </StatTile>
      </div>

      {loading ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)' }}>
          <Spinner /> Loading sites…
        </div>
      ) : projects.length === 0 ? (
        // True empty state: no projects at all in the DB.
        <EmptyState
          icon="🌐"
          title="No client sites yet"
          sub="Qualify a Pipeline lead to convert it into a project here. Tier 3 unlocks the Brief Studio; Tier 1/2 land as light-weight records."
        />
      ) : sorted.length === 0 ? (
        // Projects exist but the active filter excludes them all.
        <div style={{
          marginTop: 14,
          padding: '24px 16px',
          textAlign: 'center',
          color: 'var(--text3)',
          background: 'var(--surface2)',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--r)',
          fontSize: '0.78rem',
        }}>
          No projects match the <strong>{filterLabel(filter)}</strong> filter.{' '}
          <button
            type="button"
            onClick={() => setFilter('all')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              font: 'inherit',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            Show all
          </button>
        </div>
      ) : (
        <div className="sites-grid">
          {sorted.map(p => (
            <SiteCard
              key={p.id}
              project={p}
              showToast={showToast}
              onSwitchTab={onSwitchTab}
              onOpenDetail={() => setDetailProjectId(p.id)}
              onEditInfo={() => openEditor(p)}
              onQuickBrief={() => openQuickBrief(p)}
              onProjectChanged={() => { void load(); }}
            />
          ))}
        </div>
      )}

      {editorElement}
      {quickBriefElement}
      {(editorLoading || quickBriefLoading) && <ModalLoaderHint />}
    </>
  );
}

/** Tiny modal-overlay-style loader for when we're fetching context for the
 *  editor before showing it. Avoids a layout pop while the parallel fetch
 *  for lead + master brief resolves. */
/**
 * Clickable stat tile. Replaces the static <div className="scard">; same
 * visual shell, but adds a hover affordance + an "active" outline when
 * the tile is the currently-applied filter. Falls back to a regular
 * div with no extra chrome if onClick is not provided.
 */
function StatTile({
  active, onClick, variant, children,
}: {
  active: boolean;
  onClick: () => void;
  variant: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={variant}
      style={{
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        background: variant.includes('prospect')
          ? 'rgba(245,200,66,0.06)'
          : undefined,
        // Active state: thicker accent-coloured outline so the operator can
        // see which slice the grid below is filtered to at a glance.
        outline: active ? '2px solid var(--accent)' : undefined,
        outlineOffset: active ? -2 : 0,
        border: variant.includes('prospect')
          ? '1px solid rgba(245,200,66,0.2)'
          : undefined,
      }}
      title={active ? 'Click to clear filter' : 'Click to filter the grid below'}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function filterLabel(f: 'all' | 'active' | 'prospect' | 't3' | 't2' | 't1'): string {
  switch (f) {
    case 'active':   return 'Active Clients';
    case 'prospect': return 'Prospects';
    case 't3':       return 'Tier 3 active';
    case 't2':       return 'Tier 2 active';
    case 't1':       return 'Tier 1 (handed off)';
    default:         return '';
  }
}

function ModalLoaderHint() {
  return (
    <div className="modal-overlay open" style={{ pointerEvents: 'none' }}>
      <div className="modal" style={{
        width: 320,
        padding: '20px 24px',
        textAlign: 'center',
        color: 'var(--text2)',
        fontSize: '0.78rem',
      }}>
        <Spinner /> Loading project editor…
      </div>
    </div>
  );
}
