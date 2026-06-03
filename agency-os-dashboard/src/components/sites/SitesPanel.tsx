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
    const list = [...projects];
    if (sort === 'tier') list.sort((a, b) => b.tier - a.tier);
    else if (sort === 'az') list.sort((a, b) => a.business_name.localeCompare(b.business_name));
    else if (sort === 'due') list.sort((a, b) => {
      const aDate = a.next_pages_due ? Date.parse(a.next_pages_due) : Infinity;
      const bDate = b.next_pages_due ? Date.parse(b.next_pages_due) : Infinity;
      return aDate - bDate;
    });
    return list;
  }, [projects, sort]);

  const stats = useMemo(() => {
    const live = projects.filter(p => p.status === 'live' || p.status === 'building');
    const t3 = live.filter(p => p.tier === 3);
    const t2 = live.filter(p => p.tier === 2);
    const t1 = live.filter(p => p.tier === 1);
    const t3Mrr = t3.length * TIER_MRR[3];
    const t2Mrr = t2.length * TIER_MRR[2];
    return { total: live.length, t3: t3.length, t2: t2.length, t1: t1.length, t3Mrr, t2Mrr };
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
          <div className="sec-sub">All client projects · Tier 3 cards open the Brief Studio; Tier 1/2 use Edit Info</div>
        </div>
        <select className="fsel" value={sort} onChange={e => setSort(e.target.value as Sort)}>
          <option value="tier">Sort: Tier (high to low)</option>
          <option value="due">Sort: Update due</option>
          <option value="az">Sort: A-Z</option>
        </select>
      </div>

      <div className="stats-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="scard"><div className="snum">{stats.total}</div><div className="slabel">Total Sites</div></div>
        <div className="tier-stat t3">
          <div className="tier-num t3">{stats.t3}</div>
          <div className="slabel" style={{ color: 'var(--tier3)' }}>Tier 3 active</div>
          <div className="sdelta">${stats.t3Mrr.toLocaleString()}/mo recurring</div>
        </div>
        <div className="tier-stat t2">
          <div className="tier-num t2">{stats.t2}</div>
          <div className="slabel" style={{ color: 'var(--tier2)' }}>Tier 2 active</div>
          <div className="sdelta">${stats.t2Mrr.toLocaleString()}/mo recurring</div>
        </div>
        <div className="tier-stat t1">
          <div className="tier-num t1">{stats.t1}</div>
          <div className="slabel" style={{ color: 'var(--tier1)' }}>Tier 1 (handed off)</div>
          <div className="sdelta">No ongoing work</div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)' }}>
          <Spinner /> Loading sites…
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon="🌐"
          title="No client sites yet"
          sub="Qualify a Pipeline lead to convert it into a project here. Tier 3 unlocks the Brief Studio; Tier 1/2 land as light-weight records."
        />
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
