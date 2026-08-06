import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Brief, Project, Lead, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { SiteCard } from './SiteCard';
import { SiteDetailPanel } from './SiteDetailPanel';
import { OperatorInputForm } from '../briefs/OperatorInputForm';
import { QuickBriefModal } from './QuickBriefModal';
import { TIER_MRR } from '../../lib/pricing';
import { ArrowUpDown, BriefcaseBusiness, FileSignature, Gem, Globe2, Handshake, Sparkles, Zap } from 'lucide-react';

interface SitesPanelProps {
  showToast: ShowToast;
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
type StatusFilter = 'all' | 'pending' | 'active' | 'internal' | 't3' | 't2' | 't1';

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
  showToast, initialProjectId, onInitialProjectConsumed,
}: SitesPanelProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>('tier');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [detailProjectId, setDetailProjectId] = useState<number | null>(null);
  const [detailInitialTab, setDetailInitialTab] = useState<'overview' | 'briefs' | 'onboarding'>('overview');
  const [editorCtx, setEditorCtx] = useState<EditorContext | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  // Historical outreach brief viewer. The saved project artifact is preferred;
  // the linked lead's cached pipeline brief is a compatibility fallback.
  const [quickBriefCtx, setQuickBriefCtx] = useState<{ project: Project; lead: Lead | null; outreachBrief: Brief | null } | null>(null);
  const [quickBriefLoading, setQuickBriefLoading] = useState(false);
  const [briefRefreshToken, setBriefRefreshToken] = useState(0);

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
      setDetailInitialTab('briefs');
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

  /** Open the original brief that produced the outreach site. */
  const openQuickBrief = useCallback(async (project: Project) => {
    setQuickBriefLoading(true);
    try {
      const [lead, summaries] = await Promise.all([
        project.lead_id ? api.leads.get(project.lead_id).then((r) => r.lead).catch(() => null) : Promise.resolve(null),
        api.briefs.listForProject(project.id).then((result) => result.briefs).catch(() => []),
      ]);
      const outreachSummary = summaries.find((brief) => brief.kind === 'outreach');
      const outreachBrief = outreachSummary ? await api.briefs.get(outreachSummary.id).catch(() => null) : null;
      setQuickBriefCtx({ project, lead, outreachBrief });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not open outreach brief: ${msg}`, 'error');
    } finally {
      setQuickBriefLoading(false);
    }
  }, [showToast]);

  const sorted = useMemo(() => {
    // Filter first (cheap, narrows the set), then sort the remainder.
    const isActive = (p: Project) => p.status === 'live' || p.status === 'building';
    let list = projects.filter((p) => {
      const visibleClient = p.is_internal === 1 || ['prospect', 'building', 'live', 'paused'].includes(p.status);
      if (!visibleClient) return false;
      switch (filter) {
        case 'pending':  return p.is_internal !== 1 && p.status === 'prospect';
        case 'active':   return isActive(p);
        case 'internal': return p.is_internal === 1;
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
    const active = projects.filter(p => p.is_internal !== 1 && (p.status === 'live' || p.status === 'building'));
    const pending = projects.filter(p => p.is_internal !== 1 && p.status === 'prospect');
    const internal = projects.filter(p => p.is_internal === 1);
    const t3 = active.filter(p => p.tier === 3);
    const t2 = active.filter(p => p.tier === 2);
    const t1 = active.filter(p => p.tier === 1);
    const t3Mrr = t3.length * TIER_MRR[3];
    const t2Mrr = t2.length * TIER_MRR[2];
    return {
      total: active.length,
      pending: pending.length,
      internal: internal.length,
      t3: t3.length,
      t2: t2.length,
      t1: t1.length,
      t3Mrr,
      t2Mrr,
    };
  }, [projects]);

  const groupedProjects = useMemo(() => ({
    pending: sorted.filter((project) => project.is_internal !== 1 && project.status === 'prospect'),
    clients: sorted.filter((project) => project.is_internal !== 1 && project.status !== 'prospect'),
    internal: sorted.filter((project) => project.is_internal === 1),
  }), [sorted]);

  const editorElement = editorCtx && (
    <OperatorInputForm
      open={true}
      onClose={() => setEditorCtx(null)}
      project={editorCtx.project}
      lead={editorCtx.lead}
      hasMaster={editorCtx.hasMaster}
      showToast={showToast}
      onBriefGenerated={() => {
        setBriefRefreshToken((value) => value + 1);
        void load();
      }}
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
      outreachBrief={quickBriefCtx.outreachBrief}
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
          initialTab={detailInitialTab}
          briefRefreshToken={briefRefreshToken}
          showToast={showToast}
          onBack={() => {
            setDetailProjectId(null);
            setDetailInitialTab('overview');
          }}
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
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><BriefcaseBusiness size={18} /></span>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-950">Clients &amp; sites</h1>
                <p className="mt-0.5 text-sm text-slate-500">
            {filter === 'all'
              ? 'Manage signed clients, internal workspaces, and every active site.'
              : `Showing ${filterLabel(filter).toLowerCase()}`}
            {filter !== 'all' && (
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="ml-1 font-medium text-blue-600 hover:text-blue-700"
              >
                Show all
              </button>
            )}
                </p>
              </div>
            </div>
          </div>
          <label className="relative block sm:w-60">
            <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <span className="sr-only">Sort sites</span>
            <select className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" value={sort} onChange={e => setSort(e.target.value as Sort)}>
              <option value="tier">Tier: high to low</option>
              <option value="due">Next update due</option>
              <option value="az">Business name: A–Z</option>
            </select>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-6">
        <StatTile
          active={filter === 'pending'}
          onClick={() => setFilter((f) => (f === 'pending' ? 'all' : 'pending'))}
          icon={<FileSignature size={17} />}
          tone="amber"
        >
          <StatValue value={stats.pending} label="Agreement pending" detail="Awaiting signature" />
        </StatTile>
        <StatTile
          active={filter === 'active'}
          onClick={() => setFilter((f) => (f === 'active' ? 'all' : 'active'))}
          icon={<Handshake size={17} />}
          tone="blue"
        >
          <StatValue value={stats.total} label="Active clients" detail={`$${(stats.t3Mrr + stats.t2Mrr).toLocaleString()}/mo MRR`} />
        </StatTile>
        <StatTile
          active={filter === 'internal'}
          onClick={() => setFilter((f) => (f === 'internal' ? 'all' : 'internal'))}
          icon={<BriefcaseBusiness size={17} />}
          tone="amber"
        >
          <StatValue value={stats.internal} label="Internal" detail="Excluded from MRR" />
        </StatTile>
        <StatTile
          active={filter === 't3'}
          onClick={() => setFilter((f) => (f === 't3' ? 'all' : 't3'))}
          icon={<Gem size={17} />}
          tone="violet"
        >
          <StatValue value={stats.t3} label="Tier 3 active" detail={`$${stats.t3Mrr.toLocaleString()}/mo`} />
        </StatTile>
        <StatTile
          active={filter === 't2'}
          onClick={() => setFilter((f) => (f === 't2' ? 'all' : 't2'))}
          icon={<Sparkles size={17} />}
          tone="amber"
        >
          <StatValue value={stats.t2} label="Tier 2 active" detail={`$${stats.t2Mrr.toLocaleString()}/mo`} />
        </StatTile>
        <StatTile
          active={filter === 't1'}
          onClick={() => setFilter((f) => (f === 't1' ? 'all' : 't1'))}
          icon={<Zap size={17} />}
          tone="emerald"
        >
          <StatValue value={stats.t1} label="Tier 1 handoff" detail="No ongoing work" />
        </StatTile>
        </div>
      </section>

      {loading ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)' }}>
          <Spinner /> Loading sites…
        </div>
      ) : projects.length === 0 ? (
        // True empty state: no projects at all in the DB.
        <EmptyState
          icon={<Globe2 size={34} strokeWidth={1.6} />}
          title="No client sites yet"
          sub="Advance a lead from Email or Text Outreach to create its agreement-pending workspace here."
        />
      ) : sorted.length === 0 ? (
        // Projects exist but the active filter excludes them all.
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No projects match the <strong>{filterLabel(filter)}</strong> filter.{' '}
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="font-semibold text-blue-600 hover:text-blue-700"
          >
            Show all
          </button>
        </div>
      ) : (
        <div className="space-y-7">
          {groupedProjects.pending.length > 0 && (
            <ProjectGroup
              title="Agreement pending"
              description="Plan selected and awaiting a signed agreement before onboarding begins"
              projects={groupedProjects.pending}
              renderCard={(project) => (
                <SiteCard
                  key={project.id}
                  project={project}
                  showToast={showToast}
                  onOpenDetail={() => {
                    setDetailInitialTab('overview');
                    setDetailProjectId(project.id);
                  }}
                  onOpenBriefStudio={() => {
                    setDetailInitialTab('briefs');
                    setDetailProjectId(project.id);
                  }}
                  onOpenOnboarding={() => {
                    setDetailInitialTab('onboarding');
                    setDetailProjectId(project.id);
                  }}
                  onQuickBrief={() => openQuickBrief(project)}
                  onProjectChanged={() => { void load(); }}
                />
              )}
            />
          )}
          {groupedProjects.clients.length > 0 && (
            <ProjectGroup
              title="Clients"
              description="Signed client projects and active sites"
              projects={groupedProjects.clients}
              renderCard={(project) => (
                <SiteCard
                  key={project.id}
                  project={project}
                  showToast={showToast}
                  onOpenDetail={() => {
                    setDetailInitialTab('overview');
                    setDetailProjectId(project.id);
                  }}
                  onOpenBriefStudio={() => {
                    setDetailInitialTab('briefs');
                    setDetailProjectId(project.id);
                  }}
                  onOpenOnboarding={() => {
                    setDetailInitialTab('onboarding');
                    setDetailProjectId(project.id);
                  }}
                  onQuickBrief={() => openQuickBrief(project)}
                  onProjectChanged={() => { void load(); }}
                />
              )}
            />
          )}
          {groupedProjects.internal.length > 0 && (
            <ProjectGroup
              title="Internal workspaces"
              description="Testing and agency-owned sites excluded from MRR"
              projects={groupedProjects.internal}
              renderCard={(project) => (
                <SiteCard
                  key={project.id}
                  project={project}
                  showToast={showToast}
                  onOpenDetail={() => {
                    setDetailInitialTab('overview');
                    setDetailProjectId(project.id);
                  }}
                  onOpenBriefStudio={() => {
                    setDetailInitialTab('briefs');
                    setDetailProjectId(project.id);
                  }}
                  onOpenOnboarding={() => {
                    setDetailInitialTab('onboarding');
                    setDetailProjectId(project.id);
                  }}
                  onQuickBrief={() => openQuickBrief(project)}
                  onProjectChanged={() => { void load(); }}
                />
              )}
            />
          )}
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
  active, onClick, icon, tone, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  tone: 'blue' | 'amber' | 'violet' | 'emerald';
  children: React.ReactNode;
}) {
  const tones = {
    blue: 'bg-blue-50 text-blue-600', amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600', emerald: 'bg-emerald-50 text-emerald-600',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-0 rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${active ? 'border-blue-400 bg-blue-50/60 ring-2 ring-blue-100' : 'border-slate-200 bg-slate-50/70 hover:border-slate-300'}`}
      title={active ? 'Click to clear filter' : 'Click to filter the grid below'}
      aria-pressed={active}
    >
      <span className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</span>
      {children}
    </button>
  );
}

function StatValue({ value, label, detail }: { value: number; label: string; detail: string }) {
  return <><div className="text-2xl font-semibold tracking-tight text-slate-950">{value}</div><div className="truncate text-xs font-semibold text-slate-700">{label}</div><div className="mt-0.5 truncate text-[11px] text-slate-500">{detail}</div></>;
}

function ProjectGroup({
  title, description, projects, renderCard,
}: {
  title: string;
  description: string;
  projects: Project[];
  renderCard: (project: Project) => React.ReactNode;
}) {
  return (
    <section aria-labelledby={`project-group-${title.toLowerCase()}`}>
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div>
          <div className="flex items-center gap-2">
            <h2 id={`project-group-${title.toLowerCase()}`} className="text-base font-semibold text-slate-950">{title}</h2>
            <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-xs font-semibold text-slate-600">{projects.length}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {projects.map(renderCard)}
      </div>
    </section>
  );
}

function filterLabel(f: StatusFilter): string {
  switch (f) {
    case 'pending':  return 'Agreement pending';
    case 'active':   return 'Active Clients';
    case 'internal': return 'Internal workspaces';
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
