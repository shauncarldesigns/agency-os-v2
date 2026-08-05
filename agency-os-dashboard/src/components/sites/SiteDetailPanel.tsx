import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Project, ProjectDiscovery, Brief, BriefKind, ShowToast, Lead, Page, GrowthWorkItem } from '../../lib/types';
import { api, ApiError, type DnsStatusResponse, type ProjectUpdate } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { BriefEditorPanel } from '../briefs/BriefEditorPanel';
import { BriefStudioMatrix } from './BriefStudioMatrix';
import { DiscoveryPanel } from './DiscoveryPanel';
import { DnsSetupModal } from './DnsSetupModal';
import { DnsManagePanel } from './DnsManagePanel';
import { ReportsPanel } from '../reports/ReportsPanel';
import { PageRecommendationQueue } from './PageRecommendationQueue';
import { OnboardingChecklistPanel } from './OnboardingChecklistPanel';
import {
  extractServicesFromBrief,
  extractServiceAreasFromBrief,
  diffAdditions,
} from '../../lib/briefExtract';
import { TIER_MRR } from '../../lib/pricing';
import { Activity, AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, ClipboardCheck, ExternalLink, FileText, FlaskConical, Globe2, Home, Lock, MapPin, Settings2, Zap } from 'lucide-react';

interface SiteDetailPanelProps {
  project: Project;
  initialTab?: 'overview' | 'briefs' | 'onboarding';
  showToast: ShowToast;
  onBack: () => void;
  onProjectChanged: () => void;
  /** Open the shared Edit Project modal (tier change / business info / delete).
   *  Lives at the SitesPanel level so the modal survives the detail view
   *  unmounting (e.g. when deleting). */
  onEditProject: () => void;
  /** Open the Quick Brief modal — business name + reviews verbatim, for the
   *  pre-call landingsite paste. Sidebar Quick Actions. */
  onQuickBrief: () => void;
  /** Changes after a sibling modal generates a brief, forcing this mounted
   *  detail view to reload its master brief immediately. */
  briefRefreshToken?: number;
}

// Short uppercase form used as a card header — distinct from pricing.ts's
// "Tier 1 · Foundation" picker label, so kept local.
const TIER_LABEL = { 1: 'TIER 1', 2: 'TIER 2', 3: 'TIER 3' } as const;

const KIND_LABEL: Record<BriefKind, string> = {
  master: 'Master',
  page: 'Page',
  outreach: 'Original Outreach',
};

type WorkspaceTab = 'overview' | 'onboarding' | 'website' | 'briefs' | 'reporting' | 'activity' | 'configuration';

const WORKSPACE_TABS = [
  { key: 'overview', label: 'Overview', description: 'Client health at a glance', icon: Home },
  { key: 'onboarding', label: 'Onboarding', description: 'Setup progress and outstanding steps', icon: ClipboardCheck },
  { key: 'website', label: 'Website', description: 'Live site status and performance', icon: Globe2 },
  { key: 'briefs', label: 'Brief Studio', description: 'Content planning and production', icon: FileText },
  { key: 'reporting', label: 'Reporting', description: 'Monthly results and exports', icon: BarChart3 },
  { key: 'activity', label: 'Activity', description: 'Workspace history and events', icon: Activity },
  { key: 'configuration', label: 'Configuration', description: 'Client and integration settings', icon: Settings2 },
] as const;

const GROWTH_PHASES = [
  { key: 'foundation', label: 'Foundation' },
  { key: 'expansion', label: 'Expansion' },
  { key: 'optimization', label: 'Optimization' },
] as const;

function GrowthPhaseProgress({ project }: { project: Project }) {
  const currentPhase = project.growth_cycle_phase ?? 'foundation';
  const currentIndex = GROWTH_PHASES.findIndex((phase) => phase.key === currentPhase);

  return (
    <div className="mt-2 flex items-center" aria-label={`Growth phase: ${currentPhase}`}>
      {GROWTH_PHASES.map((phase, index) => {
        const complete = index < currentIndex
          || (index === currentIndex && project.growth_cycle_status === 'complete');
        const active = index === currentIndex && !complete;
        return (
          <div key={phase.key} className="flex items-center">
            {index > 0 && (
              <span className={`mx-1.5 h-px w-5 sm:w-8 ${complete || active ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
            <span className={`flex items-center gap-1.5 text-xs font-semibold ${complete ? 'text-emerald-700' : active ? 'text-blue-700' : 'text-slate-400'}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${complete ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-400'}`}>
                {complete ? <CheckCircle2 size={13} strokeWidth={2.5} /> : index + 1}
              </span>
              <span className="hidden sm:inline">{phase.label}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}


/**
 * Brief Studio (lives inside Site Detail).
 *
 * Empty state — no master brief: yellow callout invites the operator to
 * generate one, the matrix renders as a locked skeleton.
 * Active state — master brief exists: master brief card shows version, last
 * updated, TBD chip; matrix population is wired in Phase 4 (still skeleton
 * with a placeholder note for now).
 */
export function SiteDetailPanel({
  project, initialTab = 'overview', showToast, onBack, onProjectChanged, onEditProject, onQuickBrief,
  briefRefreshToken = 0,
}: SiteDetailPanelProps) {
  const [master, setMaster] = useState<Brief | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [discovery, setDiscovery] = useState<ProjectDiscovery | null>(null);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewerBriefId, setViewerBriefId] = useState<number | null>(null);
  // DNS modals — driven by the dynamic Quick Action button below. State stays
  // local because the modals don't need to survive a parent unmount.
  const [dnsSetupOpen, setDnsSetupOpen] = useState(false);
  const [dnsManageOpen, setDnsManageOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(initialTab);
  const [recommendedPageKeys, setRecommendedPageKeys] = useState<string[]>([]);
  const [optimizationPageIds, setOptimizationPageIds] = useState<number[]>([]);
  const [matrixRefreshToken, setMatrixRefreshToken] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Page rows from /api/projects/:id drive the stats — a brief row stays
      // status='briefed' even after its page is marked complete, so counting
      // briefs over-counts. Page rows carry the authoritative status.
      const [masterRes, leadRes, projectRes, discoveryRes] = await Promise.all([
        api.briefs.getMaster(project.id).catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
        project.lead_id
          ? api.leads.get(project.lead_id).then((r) => r.lead).catch(() => null)
          : Promise.resolve(null),
        api.projects.get(project.id).then((r) => r.pages).catch(() => [] as Page[]),
        api.projects.discovery.get(project.id).then((r) => r.discovery).catch(() => null),
      ]);
      setMaster(masterRes);
      setLead(leadRes);
      setPages(projectRes);
      setDiscovery(discoveryRes);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load Brief Studio: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [project.id, project.lead_id, project.updated_at, briefRefreshToken, showToast]);

  useEffect(() => { void reload(); }, [reload]);

  const tier = (project.tier ?? 1) as 1 | 2 | 3;
  const mrr = project.is_internal === 1 ? 0 : (TIER_MRR[tier] ?? 0);
  const projectServices = useMemo(() => safeJsonArray(project.services), [project.services]);
  const projectAreas = useMemo(() => safeJsonArray(project.service_areas), [project.service_areas]);

  const stats = useMemo(() => {
    // Source: page rows (status='planned' | 'briefed' | 'complete'). The
    // briefs list isn't authoritative because brief.status doesn't change
    // when its page is marked complete — counting briefs over-counts the
    // "awaiting complete" bucket.
    const pagesLive = pages.filter((p) => p.status === 'complete').length;
    const pagesBriefed = pages.filter((p) => p.status === 'briefed').length;
    // Tier 3's denominator must mirror the live Page Matrix, not the stale
    // pages_planned value saved when the project was first created.
    const foundationCount = projectAreas.length >= 2 ? 6 : 5;
    const matrixCount = foundationCount
      + projectServices.length
      + (projectAreas.length >= 2 ? projectServices.length * projectAreas.length : 0)
      + pages.filter((page) => page.type === 'custom').length;
    const pagesPlanned = tier === 3 ? Math.max(project.pages_planned ?? 0, matrixCount, pagesLive) : (project.pages_planned ?? 5);
    return {
      masterCount: master ? 1 : 0,
      pagesLive,
      pagesBriefed,
      pagesPlanned,
      monthlyTarget: project.monthly_pages_target || (tier === 3 ? 3 : 0),
    };
  }, [master, pages, project.pages_planned, project.monthly_pages_target, projectServices.length, projectAreas.length, tier]);

  // Brief-vs-matrix drift detection (Option C bridge): when the master brief
  // mentions services or service areas not in project.services/service_areas,
  // surface a callout so the operator can one-click sync. We never silently
  // mutate the project — the matrix stays the source of truth.
  const briefAdditions = useMemo(() => {
    if (!master) return { services: [], areas: [] };
    return {
      services: diffAdditions(extractServicesFromBrief(master.content_markdown), projectServices),
      areas: diffAdditions(extractServiceAreasFromBrief(master.content_markdown), projectAreas),
    };
  }, [master, projectServices, projectAreas]);
  const [dismissedSig, setDismissedSig] = useState<string | null>(null);
  const additionsSig = briefAdditions.services.join('|') + '::' + briefAdditions.areas.join('|');
  const hasBriefAdditions = (briefAdditions.services.length + briefAdditions.areas.length) > 0
    && additionsSig !== dismissedSig;

  // "Matrix may be stale" — the project has been mutated (matrix add, edit info,
  // etc.) more recently than the master brief was generated/updated.
  const matrixIsStale = useMemo(() => {
    if (!master) return false;
    const masterTs = Date.parse(master.updated_at ?? master.generated_at ?? '');
    const projectTs = Math.max(
      Date.parse(project.updated_at ?? ''),
      Date.parse(discovery?.updated_at ?? ''),
    );
    if (!Number.isFinite(masterTs) || !Number.isFinite(projectTs)) return false;
    // Small fudge so trivial near-simultaneous timestamps don't flag.
    return projectTs - masterTs > 2_000;
  }, [master, project.updated_at, discovery?.updated_at]);

  const handleProjectConfigurationSave = useCallback(
    async (data: ProjectUpdate) => {
      const res = await api.projects.update(project.id, data);
      showToast('Configuration saved', 'success');
      await onProjectChanged();
      return res.project;
    },
    [project.id, onProjectChanged, showToast],
  );
  const closeBrief = useCallback(() => setViewerBriefId(null), []);
  const handleBriefChanged = useCallback(() => { void reload(); }, [reload]);
  const handlePageCompleted = useCallback(() => {
    setMatrixRefreshToken((current) => current + 1);
    void reload();
    onProjectChanged();
  }, [reload, onProjectChanged]);

  async function applyBriefAdditions() {
    if (!master) return;
    try {
      const nextServices = [...projectServices, ...briefAdditions.services];
      const nextAreas = [...projectAreas, ...briefAdditions.areas];
      await api.projects.update(project.id, {
        services: nextServices,
        service_areas: nextAreas,
      });
      const total = briefAdditions.services.length + briefAdditions.areas.length;
      showToast(`Added ${total} item${total === 1 ? '' : 's'} from the brief to the matrix`, 'success');
      onProjectChanged();
      await reload();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Add failed: ${msg}`, 'error');
    }
  }

  return (
    <>
      <div className="bs-topbar">
        <div className="bs-heading-wrap">
          <button type="button" className="bs-back" onClick={onBack}><ArrowLeft size={15} /> Clients &amp; sites</button>
          <div className="bs-heading-icon"><FileText size={20} /></div>
          <div>
            <div className="bs-breadcrumb">{project.business_name}</div>
            <h1 className="bs-title">Client Workspace</h1>
            <GrowthPhaseProgress project={project} />
          </div>
        </div>
        <div className="bs-topbar-meta">
          <span className={`bs-tier-badge bs-tier-${tier}`}>
            {TIER_LABEL[tier]}{mrr > 0 ? ` · $${mrr}/mo` : ''}
          </span>
          <span className="bs-topbar-sub">
            <MapPin size={13} /> {[project.city, project.state].filter(Boolean).join(', ') || '—'}
            {project.pages_built ? ` · ${project.pages_built} pages built` : ' · 0 pages built'}
          </span>
        </div>
      </div>

      <div className="client-workspace-shell">
        <aside className="client-workspace-rail" aria-label="Client workspace sections">
          <div className="space-y-1">
            {WORKSPACE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = workspaceTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setWorkspaceTab(tab.key)}
                  className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition ${active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{tab.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-slate-400">{tab.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="client-workspace-content">
      {workspaceTab === 'onboarding' ? (
        <OnboardingChecklistPanel project={project} showToast={showToast} />
      ) : workspaceTab === 'briefs' ? <div className="bs-layout">
        <main className="bs-main">
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
              <Spinner /> Loading Brief Studio…
            </div>
          ) : (
            <>
              {tier === 3 && (
                <PageRecommendationQueue
                  key={`recommendations-${matrixRefreshToken}`}
                  project={project}
                  hasMaster={!!master}
                  showToast={showToast}
                  onOpenBrief={(brief) => setViewerBriefId(brief.id)}
                  onRecommendationKeysChange={setRecommendedPageKeys}
                  onOptimizationPageIdsChange={setOptimizationPageIds}
                  onOpenConfiguration={() => setWorkspaceTab('configuration')}
                  onPageChanged={() => {
                    setMatrixRefreshToken((current) => current + 1);
                    void reload();
                    onProjectChanged();
                  }}
                />
              )}
              <StatsRow stats={stats} hasMaster={!!master} />

              {master ? (
                <MasterBriefCard
                  master={master}
                  stale={matrixIsStale}
                  onClick={() => setViewerBriefId(master.id)}
                />
              ) : (
                <EmptyCallout onOpenForm={onEditProject} />
              )}

              {tier === 3 && hasBriefAdditions && (
                <BriefAdditionsCallout
                  services={briefAdditions.services}
                  areas={briefAdditions.areas}
                  onAdd={applyBriefAdditions}
                  onDismiss={() => setDismissedSig(additionsSig)}
                />
              )}

              <div className="bs-matrix-heading">
                <div>
                  <h2 className="bs-section-h">Page Matrix</h2>
                  <p>Generate and track every page brief for this site.</p>
                </div>
                <div className="bs-matrix-legend">
                  <LegendDot color="empty" label="Not started" />
                  <LegendDot color="recommended" label="Recommended" />
                  <LegendDot color="briefed" label="Brief generated" />
                  <LegendDot color="live" label="Live" />
                </div>
              </div>

              <div className="bs-matrix-card">
                {tier !== 3 ? (
                  <div className="bs-matrix-overlay">
                    <span className="bs-matrix-lock"><Lock size={16} /></span>
                    <span>
                      Page Matrix is a Tier 3 feature. Upgrade this project from{' '}
                      <button
                        type="button"
                        onClick={onEditProject}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent)',
                          textDecoration: 'underline',
                          cursor: 'pointer',
                          font: 'inherit',
                          padding: 0,
                        }}
                      >
                        Edit Project Info
                      </button>{' '}
                      to unlock.
                    </span>
                  </div>
                ) : !master ? (
                  <div className="bs-matrix-overlay">
                    <span className="bs-matrix-lock"><Lock size={16} /></span>
                    <span>Generate the master brief to unlock the matrix</span>
                  </div>
                ) : null}
                {tier === 3 && master ? (
                  <BriefStudioMatrix
                    projectId={project.id}
                    reloadToken={`${master.updated_at ?? master.generated_at ?? ''}::${project.updated_at}::${matrixRefreshToken}`}
                    showToast={showToast}
                    onOpenBrief={(b) => setViewerBriefId(b.id)}
                    recommendedPageKeys={recommendedPageKeys}
                    optimizationPageIds={optimizationPageIds}
                  />
                ) : (
                  <MatrixSkeleton />
                )}
              </div>
            </>
          )}
        </main>

        <aside className="bs-sidebar">
          <Sidebar
            project={project}
            lead={lead}
            onQuickBrief={onQuickBrief}
            discovery={discovery}
            onOpenDiscovery={() => setDiscoveryOpen(true)}
          />
        </aside>
      </div> : (
        <WorkspaceTabPanel
          tab={workspaceTab}
          project={project}
          lead={lead}
          hasMaster={!!master}
          onOpenBriefStudio={() => setWorkspaceTab('briefs')}
          onOpenReporting={() => setWorkspaceTab('reporting')}
          onOpenSetup={() => setWorkspaceTab('configuration')}
          onManageDns={() => project.cf_zone_id ? setDnsManageOpen(true) : setDnsSetupOpen(true)}
          onProjectConfigurationSave={handleProjectConfigurationSave}
          onProjectChanged={onProjectChanged}
          showToast={showToast}
        />
      )}
        </div>
      </div>

      <BriefEditorPanelLoader
        briefId={viewerBriefId}
        onClose={closeBrief}
        showToast={showToast}
        onChanged={handleBriefChanged}
        onPageCompleted={handlePageCompleted}
      />

      <DnsSetupModal
        open={dnsSetupOpen}
        project={project}
        onClose={() => setDnsSetupOpen(false)}
        showToast={showToast}
        onSetupComplete={onProjectChanged}
      />

      <DnsManagePanel
        open={dnsManageOpen}
        project={project}
        onClose={() => setDnsManageOpen(false)}
        showToast={showToast}
        onProjectChanged={onProjectChanged}
      />

      <DiscoveryPanel
        project={project}
        open={discoveryOpen}
        onClose={() => setDiscoveryOpen(false)}
        showToast={showToast}
        onChanged={(next) => {
          setDiscovery(next);
          onProjectChanged();
        }}
      />
    </>
  );
}

// ============================================================================
// Topbar stats
// ============================================================================

function StatsRow({
  stats, hasMaster,
}: {
  stats: {
    masterCount: number;
    pagesLive: number;
    pagesBriefed: number;
    pagesPlanned: number;
    monthlyTarget: number;
  };
  hasMaster: boolean;
}) {
  const liveValue = hasMaster
    ? (stats.pagesPlanned > 0 ? `${stats.pagesLive} / ${stats.pagesPlanned}` : String(stats.pagesLive))
    : '—';
  return (
    <div className="bs-stats">
      <StatTile
        value={hasMaster ? String(stats.masterCount) : '—'}
        label={hasMaster ? 'Master Brief' : 'Master Brief · not yet generated'}
        muted={!hasMaster}
      />
      <StatTile
        value={liveValue}
        label={hasMaster ? 'Pages live' : 'Pages live · matrix locked'}
        muted={!hasMaster}
      />
      <StatTile
        value={String(stats.pagesBriefed)}
        label={'Briefed · awaiting complete'}
        muted={!hasMaster && stats.pagesBriefed === 0}
      />
      <StatTile
        value={stats.monthlyTarget > 0 ? 'Growth' : '—'}
        label={stats.monthlyTarget > 0 ? 'Pages are used when strategically needed' : 'No recurring growth plan'}
      />
    </div>
  );
}

function StatTile({ value, label, muted }: { value: string; label: string; muted?: boolean }) {
  return (
    <div className={`bs-stat ${muted ? 'bs-stat-muted' : ''}`}>
      <div className="bs-stat-num">{value}</div>
      <div className="bs-stat-label">{label}</div>
    </div>
  );
}

// ============================================================================
// Empty state callout
// ============================================================================

function EmptyCallout({ onOpenForm }: { onOpenForm: () => void }) {
  return (
    <div className="bs-empty-callout">
      <div className="bs-empty-icon"><FileText size={20} /></div>
      <div className="bs-empty-content">
        <div className="bs-empty-tag">Master brief · Not yet generated</div>
        <div className="bs-empty-title">Start with the Master Brief</div>
        <div className="bs-empty-sub">
          Define services, service areas, brand voice, and customer proof before generating individual page briefs.
        </div>
      </div>
      <Button variant="primary" size="sm" onClick={onOpenForm}>Generate Master Brief</Button>
    </div>
  );
}

// ============================================================================
// Master brief card
// ============================================================================

function MasterBriefCard({
  master, stale, onClick,
}: { master: Brief; stale: boolean; onClick: () => void }) {
  const updatedFromGenerated = master.updated_at ?? master.generated_at;
  const shortDate = formatRelative(updatedFromGenerated);
  return (
    <div className="bs-master-card" role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}>
      <div className="bs-master-header">
        <div>
          <div className="bs-master-title"><FileText size={15} /> Master Brief</div>
          <div className="bs-master-meta">
            <span className="bs-master-chip">v{master.version}</span>
            <span>Updated {shortDate}</span>
            {master.tbd_count > 0 && (
              <span className="bs-master-tbd"><AlertTriangle size={13} /> {master.tbd_count} TBD{master.tbd_count === 1 ? '' : 's'}</span>
            )}
            {master.tbd_count === 0 && <span className="bs-master-ok"><CheckCircle2 size={13} /> No TBDs</span>}
            {stale && (
              <span
                title="The project (services / areas / business info) was updated after this brief. Regenerate to refresh the prose."
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  color: 'var(--yellow)',
                  background: 'rgba(245,200,66,0.08)',
                  border: '1px solid rgba(245,200,66,0.25)',
                  padding: '2px 7px',
                  borderRadius: 999,
                }}
              >
                <AlertTriangle size={12} /> Matrix may be stale
              </span>
            )}
          </div>
        </div>
        <span className="bs-master-cta">Click to open in editor →</span>
      </div>
      <div className="bs-master-sub">
        Source of truth. Defines services, areas, brand voice. Drives the matrix below.
      </div>
    </div>
  );
}

/**
 * Non-modal callout shown when the master brief mentions services or service
 * areas that aren't on the matrix. The bridge for Option C — the brief
 * doesn't silently mutate the matrix, but the operator can one-click sync.
 * Dismissable: the caller stashes the signature so the same diff doesn't
 * re-trigger this session.
 */
function BriefAdditionsCallout({
  services, areas, onAdd, onDismiss,
}: {
  services: string[];
  areas: string[];
  onAdd: () => void;
  onDismiss: () => void;
}) {
  const total = services.length + areas.length;
  return (
    <div
      style={{
        marginBottom: 14,
        padding: '11px 14px',
        background: 'rgba(106,168,255,0.05)',
        border: '1px solid rgba(106,168,255,0.22)',
        borderRadius: 10,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{
          fontSize: '0.7rem',
          fontWeight: 700,
          color: 'var(--accent)',
          marginBottom: 4,
          letterSpacing: '0.3px',
        }}>
          <FileText size={13} /> BRIEF MENTIONS {total} ITEM{total === 1 ? '' : 'S'} NOT ON THE MATRIX
        </div>
        {services.length > 0 && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text2)', marginBottom: areas.length > 0 ? 4 : 0 }}>
            <strong>Services:</strong> {services.join(', ')}
          </div>
        )}
        {areas.length > 0 && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text2)' }}>
            <strong>Service areas:</strong> {areas.join(', ')}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
        <Button variant="primary" size="sm" onClick={onAdd}>+ Add to matrix</Button>
      </div>
    </div>
  );
}

// ============================================================================
// Matrix skeleton (empty state only — live matrix lives in BriefStudioMatrix)
// ============================================================================

function MatrixSkeleton() {
  return (
    <>
      <div className="bs-matrix-section">
        <div className="bs-matrix-section-label">Foundation Pages</div>
        <div className="bs-matrix-row-flat">
          {['Homepage', 'About', 'Services', 'Service Areas', 'Contact', 'FAQ', '+ Add'].map((l) => (
            <CellSkeleton key={l} label={l} />
          ))}
        </div>
      </div>

      <div className="bs-matrix-section">
        <div className="bs-matrix-section-label">Individual Service Pages</div>
        <div className="bs-matrix-row-flat">
          {[1, 2, 3, 4].map((i) => (
            <CellSkeleton key={i} />
          ))}
        </div>
      </div>

      <div className="bs-matrix-section">
        <div className="bs-matrix-section-label">Service Area Pages (service × city)</div>
        <div className="bs-matrix-grid">
          {[0, 1, 2].map((row) => (
            <div className="bs-matrix-grid-row" key={row}>
              <div className="bs-matrix-grid-label">
                <div className="bs-skel-line bs-skel-main" />
                <div className="bs-skel-line bs-skel-sub" />
              </div>
              {[0, 1, 2, 3, 4].map((col) => (
                <CellSkeleton key={col} compact />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function CellSkeleton({ label, compact }: { label?: string; compact?: boolean }) {
  return (
    <div className={`bs-cell-skel ${compact ? 'bs-cell-skel-compact' : ''}`}>
      {label ? (
        <div className="bs-cell-skel-label">{label}</div>
      ) : (
        <>
          <div className="bs-skel-line" />
          <div className="bs-skel-line bs-skel-sub" />
        </>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="bs-legend-item">
      <span className={`bs-legend-dot bs-legend-${color}`} />
      {label}
    </span>
  );
}

function WorkspaceTabPanel({
  tab, project, lead, hasMaster, onOpenBriefStudio, onOpenReporting, onOpenSetup, onManageDns,
  onProjectConfigurationSave, onProjectChanged,
  showToast,
}: {
  tab: Exclude<WorkspaceTab, 'briefs'>;
  project: Project;
  lead: Lead | null;
  hasMaster: boolean;
  onOpenBriefStudio: () => void;
  onOpenReporting: () => void;
  onOpenSetup: () => void;
  onManageDns: () => void;
  onProjectConfigurationSave: (data: ProjectUpdate) => Promise<Project>;
  onProjectChanged: () => void;
  showToast: ShowToast;
}) {
  const liveUrl = project.custom_domain ?? project.landingsite_url;
  const title = WORKSPACE_TABS.find((item) => item.key === tab)?.label ?? 'Client Workspace';

  if (tab === 'reporting') {
    return (
      <main className="client-workspace-page">
        <WorkspacePageHeading title="Reporting" subtitle="Review, refresh, and export this client's monthly performance." />
        {project.tier === 3 ? (
          <ReportsPanel showToast={showToast} project={project} embedded />
        ) : (
          <WorkspaceCard title="Monthly reporting">
            <p className="workspace-empty-copy">Monthly performance reports are included with Tier 3 client workspaces.</p>
            <Button variant="ghost" size="sm" onClick={onOpenSetup}>Review tier in Configuration</Button>
          </WorkspaceCard>
        )}
      </main>
    );
  }

  return (
    <main className="client-workspace-page">
      <WorkspacePageHeading
        title={title}
        subtitle={
          tab === 'overview' ? 'The current client, website, content, and reporting state in one place.'
          : tab === 'website' ? 'Operate the live site, domain, DNS, performance, and launch state.'
          : tab === 'configuration' ? 'Manage the client, contract, website, integrations, and workspace inputs.'
          : 'A durable history of conversion, website, brief, DNS, and reporting work.'
        }
      />

      {tab === 'overview' && (
        <div className="client-workspace-grid">
          {project.growth_cycle_phase === 'optimization' && (
            <OptimizationOverviewCard projectId={project.id} showToast={showToast} onOpenBriefStudio={onOpenBriefStudio} />
          )}
          <WorkspaceCard title="Client status">
            <WorkspaceStatus label="Stage" value={project.is_internal === 1 ? 'Internal workspace' : project.status} tone="ok" />
            <WorkspaceStatus label="Tier" value={`Tier ${project.tier}`} />
            <WorkspaceStatus label="Owner" value={project.owner_name ?? lead?.contact ?? 'Not added'} />
            <Button variant="ghost" size="sm" onClick={onOpenSetup}>View configuration</Button>
          </WorkspaceCard>
          <WorkspaceCard title="Website">
            <WorkspaceStatus label="Live URL" value={liveUrl ?? 'Not added'} tone={liveUrl ? 'ok' : 'warn'} />
            <WorkspaceStatus label="DNS" value={project.cf_zone_id ? project.dns_status : 'Not linked'} tone={project.dns_status === 'active' ? 'ok' : 'warn'} />
            <Button variant="ghost" size="sm" onClick={onOpenSetup}>View website configuration</Button>
          </WorkspaceCard>
          <WorkspaceCard title="Content production">
            <WorkspaceStatus label="Master brief" value={hasMaster ? 'Ready' : 'Not generated'} tone={hasMaster ? 'ok' : 'warn'} />
            <WorkspaceStatus label="Pages built" value={String(project.pages_built ?? 0)} />
            <Button variant="ghost" size="sm" onClick={onOpenBriefStudio}>Open Brief Studio</Button>
          </WorkspaceCard>
          <WorkspaceCard title="Reporting health">
            <WorkspaceStatus label="Search Console" value={project.gsc_property_url ? 'Property saved' : 'Not connected'} tone={project.gsc_property_url ? 'ok' : 'warn'} />
            <WorkspaceStatus label="Report recipient" value={project.client_email ?? 'Not added'} />
            <Button variant="ghost" size="sm" onClick={project.gsc_property_url ? onOpenReporting : onOpenSetup}>
              {project.gsc_property_url ? 'Open reporting' : 'Complete reporting configuration'}
            </Button>
          </WorkspaceCard>
        </div>
      )}

      {tab === 'website' && (
        <div className="client-workspace-grid">
          <WorkspaceCard title="Live website">
            <WorkspaceStatus label="URL" value={liveUrl ?? 'Not added'} tone={liveUrl ? 'ok' : 'warn'} />
            {liveUrl && <Button variant="ghost" size="sm" onClick={() => window.open(liveUrl, '_blank')}><ExternalLink size={14} /> Open live website</Button>}
          </WorkspaceCard>
          <WorkspaceCard title="Domain & DNS">
            <WorkspaceStatus label="Domain" value={project.domain ?? 'Not configured'} />
            <WorkspaceStatus label="Cloudflare zone" value={project.cf_zone_id ? project.dns_status : 'Not linked'} tone={project.dns_status === 'active' ? 'ok' : 'warn'} />
            <Button variant="ghost" size="sm" onClick={onOpenSetup}>View domain configuration</Button>
          </WorkspaceCard>
          <WorkspaceCard title="Site health">
            <WorkspaceStatus label="PageSpeed" value={lead?.pagespeed_desktop != null ? `Desktop ${lead.pagespeed_desktop}` : 'Not run'} />
            <WorkspaceStatus label="Website scrape" value={project.scrape_completed_at ? 'Complete' : 'Not run'} />
          </WorkspaceCard>
        </div>
      )}

      {tab === 'configuration' && (
        <ConfigurationCards
          project={project}
          lead={lead}
          onSaveProject={onProjectConfigurationSave}
          onManageDns={onManageDns}
          onProjectChanged={onProjectChanged}
          showToast={showToast}
        />
      )}

      {tab === 'activity' && (
        <WorkspaceCard title="Client timeline">
          <p className="workspace-empty-copy">Conversion events are now logged. The next lift will combine lead activity, brief changes, DNS events, launches, and report sends into this timeline.</p>
        </WorkspaceCard>
      )}
    </main>
  );
}

function OptimizationOverviewCard({ projectId, showToast, onOpenBriefStudio }: {
  projectId: number;
  showToast: ShowToast;
  onOpenBriefStudio: () => void;
}) {
  const [items, setItems] = useState<GrowthWorkItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.projects.growthCycles.current(projectId)
      .then((result) => { if (active) setItems(result.items.filter((item) => item.status !== 'complete')); })
      .catch((err) => { if (active) showToast(`Could not load optimization priorities: ${err instanceof ApiError ? err.message : (err as Error).message}`, 'error'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, showToast]);

  return (
    <section className="workspace-card md:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Optimization cycle</p>
          <h3 className="mt-1">Current priorities</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onOpenBriefStudio}>Open Brief Studio</Button>
      </div>
      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Spinner /> Loading priorities…</div>
      ) : items.length > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {items.slice(0, 3).map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{item.category.replace('_', ' ')}</p>
              <p className="mt-1 text-sm font-semibold leading-snug text-slate-800">{item.title}</p>
              {item.description && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500">{item.description}</p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">No open optimization priorities for this cycle.</p>
      )}
    </section>
  );
}

function ConfigurationCards({
  project, lead, onSaveProject, onManageDns, onProjectChanged, showToast,
}: {
  project: Project;
  lead: Lead | null;
  onSaveProject: (data: ProjectUpdate) => Promise<Project>;
  onManageDns: () => void;
  onProjectChanged: () => void;
  showToast: ShowToast;
}) {
  const [client, setClient] = useState({
    business_name: project.business_name,
    owner_name: project.owner_name ?? lead?.contact ?? '',
    email: project.email ?? lead?.email ?? '',
    phone: project.phone ?? lead?.phone ?? '',
    tier: project.tier,
    status: project.status,
    contract_start: project.contract_start?.slice(0, 10) ?? '',
    contract_min_end: project.contract_min_end?.slice(0, 10) ?? '',
    services: safeJsonArray(project.services).join(', '),
    service_areas: safeJsonArray(project.service_areas).join(', '),
    is_internal: project.is_internal === 1,
  });
  const [website, setWebsite] = useState({
    landingsite_url: project.landingsite_url ?? '',
    custom_domain: project.custom_domain ?? '',
    gsc_property_url: project.gsc_property_url ?? '',
    client_email: project.client_email ?? '',
  });
  const [dns, setDns] = useState({
    domain: project.domain ?? project.custom_domain?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '',
    registrar: project.registrar ?? '',
    domain_owner_email: project.domain_owner_email ?? '',
  });
  const [savingCard, setSavingCard] = useState<string | null>(null);

  useEffect(() => {
    setClient({
      business_name: project.business_name,
      owner_name: project.owner_name ?? lead?.contact ?? '',
      email: project.email ?? lead?.email ?? '',
      phone: project.phone ?? lead?.phone ?? '',
      tier: project.tier,
      status: project.status,
      contract_start: project.contract_start?.slice(0, 10) ?? '',
      contract_min_end: project.contract_min_end?.slice(0, 10) ?? '',
      services: safeJsonArray(project.services).join(', '),
      service_areas: safeJsonArray(project.service_areas).join(', '),
      is_internal: project.is_internal === 1,
    });
    setWebsite({
      landingsite_url: project.landingsite_url ?? '',
      custom_domain: project.custom_domain ?? '',
      gsc_property_url: project.gsc_property_url ?? '',
      client_email: project.client_email ?? '',
    });
    setDns({
      domain: project.domain ?? project.custom_domain?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '',
      registrar: project.registrar ?? '',
      domain_owner_email: project.domain_owner_email ?? '',
    });
  }, [project, lead]);

  async function saveClient() {
    setSavingCard('client');
    try {
      await onSaveProject({
        business_name: client.business_name.trim(),
        owner_name: client.owner_name.trim() || null,
        email: client.email.trim() || null,
        phone: client.phone.trim() || null,
        tier: client.tier,
        status: client.status,
        contract_start: client.contract_start || null,
        contract_min_end: client.contract_min_end || null,
        services: splitConfigurationList(client.services),
        service_areas: splitConfigurationList(client.service_areas),
        is_internal: client.is_internal ? 1 : 0,
      });
    } catch (err) {
      showToast(`Could not save client configuration: ${(err as Error).message}`, 'error');
    } finally {
      setSavingCard(null);
    }
  }

  async function saveWebsite() {
    setSavingCard('website');
    try {
      await onSaveProject({
        landingsite_url: website.landingsite_url.trim() || null,
        custom_domain: website.custom_domain.trim() || null,
        gsc_property_url: website.gsc_property_url.trim() || null,
        client_email: website.client_email.trim() || null,
        registrar: dns.registrar.trim() || null,
        domain_owner_email: dns.domain_owner_email.trim() || null,
      });
    } catch (err) {
      showToast(`Could not save website configuration: ${(err as Error).message}`, 'error');
    } finally {
      setSavingCard(null);
    }
  }

  async function createDnsZone() {
    if (!dns.domain.trim()) return;
    setSavingCard('dns');
    try {
      await api.projects.dns.setup(project.id, {
        domain: dns.domain.trim(),
        registrar: dns.registrar.trim() || undefined,
        domain_owner_email: dns.domain_owner_email.trim() || undefined,
      });
      showToast('Cloudflare zone created', 'success');
      onProjectChanged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not create DNS zone: ${msg}`, 'error');
    } finally {
      setSavingCard(null);
    }
  }

  return (
    <div className="configuration-card-grid">
      <WorkspaceCard title="Client & contract">
        <div className="configuration-form-grid">
          <ConfigField label="Business name" value={client.business_name} onChange={(value) => setClient((current) => ({ ...current, business_name: value }))} />
          <ConfigField label="Owner" value={client.owner_name} onChange={(value) => setClient((current) => ({ ...current, owner_name: value }))} />
          <ConfigField label="Email" type="email" value={client.email} onChange={(value) => setClient((current) => ({ ...current, email: value }))} />
          <ConfigField label="Phone" value={client.phone} onChange={(value) => setClient((current) => ({ ...current, phone: value }))} />
          <label className="configuration-field"><span>Tier</span><select value={client.tier} onChange={(event) => setClient((current) => ({ ...current, tier: Number(event.target.value) as 1 | 2 | 3 }))}><option value={1}>Tier 1</option><option value={2}>Tier 2</option><option value={3}>Tier 3</option></select></label>
          <label className="configuration-field"><span>Status</span><select value={client.status} onChange={(event) => setClient((current) => ({ ...current, status: event.target.value as Project['status'] }))}><option value="prospect">Prospect / test</option><option value="building">Building</option><option value="live">Live</option><option value="paused">Paused</option><option value="dead">Dead</option></select></label>
          <ConfigField label="Contract start" type="date" value={client.contract_start} onChange={(value) => setClient((current) => ({ ...current, contract_start: value }))} />
          <ConfigField label="Minimum end" type="date" value={client.contract_min_end} onChange={(value) => setClient((current) => ({ ...current, contract_min_end: value }))} />
          <ConfigField label="Services" wide value={client.services} onChange={(value) => setClient((current) => ({ ...current, services: value }))} helper="Separate with commas" />
          <ConfigField label="Service areas" wide value={client.service_areas} onChange={(value) => setClient((current) => ({ ...current, service_areas: value }))} helper="Separate with commas" />
          <label className="configuration-check"><input type="checkbox" checked={client.is_internal} onChange={(event) => setClient((current) => ({ ...current, is_internal: event.target.checked }))} /><span>Internal workspace — exclude from MRR and client statistics</span></label>
        </div>
        <Button variant="primary" size="sm" disabled={savingCard === 'client'} onClick={saveClient}>{savingCard === 'client' ? 'Saving…' : 'Save client & contract'}</Button>
      </WorkspaceCard>

      <WorkspaceCard title="Website & reporting">
        <div className="configuration-form-grid">
          <ConfigField label="Landingsite URL" type="url" wide value={website.landingsite_url} onChange={(value) => setWebsite((current) => ({ ...current, landingsite_url: value }))} />
          <ConfigField label="Live website URL" type="url" wide value={website.custom_domain} onChange={(value) => setWebsite((current) => ({ ...current, custom_domain: value }))} />
          <ConfigField label="Search Console property" wide value={website.gsc_property_url} onChange={(value) => setWebsite((current) => ({ ...current, gsc_property_url: value }))} helper={website.gsc_property_url.trim() ? 'Google Search Console property saved' : 'Example: sc-domain:client.com'} />
          <ConfigField label="Report recipient" type="email" wide value={website.client_email} onChange={(value) => setWebsite((current) => ({ ...current, client_email: value }))} />
        </div>
        <WorkspaceStatus label="PageSpeed" value={website.custom_domain.trim() ? 'Ready to test' : 'Needs live website URL'} tone={website.custom_domain.trim() ? 'ok' : 'warn'} />
        <WorkspaceStatus label="Traffic analytics" value="GA4 planned" />
        <Button variant="primary" size="sm" disabled={savingCard === 'website'} onClick={saveWebsite}>{savingCard === 'website' ? 'Saving…' : 'Save website & reporting'}</Button>
      </WorkspaceCard>

      <WorkspaceCard title="Domain & DNS">
        <div className="configuration-form-grid">
          <ConfigField label="Primary domain" wide value={dns.domain} onChange={(value) => setDns((current) => ({ ...current, domain: value }))} />
          <ConfigField label="Registrar" value={dns.registrar} onChange={(value) => setDns((current) => ({ ...current, registrar: value }))} />
          <ConfigField label="Domain owner email" type="email" value={dns.domain_owner_email} onChange={(value) => setDns((current) => ({ ...current, domain_owner_email: value }))} />
        </div>
        {project.cf_zone_id ? (
          <><DnsCard project={project} onManageDns={onManageDns} /><Button variant="ghost" size="sm" onClick={onManageDns}>Manage DNS records</Button></>
        ) : (
          <Button variant="primary" size="sm" disabled={!dns.domain.trim() || savingCard === 'dns'} onClick={createDnsZone}>{savingCard === 'dns' ? 'Creating zone…' : 'Create Cloudflare zone'}</Button>
        )}
      </WorkspaceCard>

      <WorkspaceCard title="Tracking & integrations">
        <div className="configuration-form-grid">
          <ConfigField label="Search Console" value={project.gsc_property_url ?? ''} disabled onChange={() => {}} helper="Managed in Reporting Configuration" />
          <ConfigField label="Microsoft Clarity" value="Install verification not available yet" disabled onChange={() => {}} />
          <ConfigField label="Google Analytics 4" value="Planned" disabled onChange={() => {}} />
        </div>
      </WorkspaceCard>
    </div>
  );
}

function ConfigField({ label, value, onChange, type = 'text', helper, wide = false, disabled = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  helper?: string;
  wide?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={`configuration-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      <input type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      {helper && <small>{helper}</small>}
    </label>
  );
}

function splitConfigurationList(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

function WorkspacePageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="workspace-page-heading"><h2>{title}</h2><p>{subtitle}</p></header>;
}

function WorkspaceCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="workspace-card"><h3>{title}</h3>{children}</section>;
}

function WorkspaceStatus({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return <div className="workspace-status"><span>{label}</span><strong className={tone ?? ''}>{value}</strong></div>;
}

// ============================================================================
// Sidebar
// ============================================================================

function Sidebar({
  project, lead, onQuickBrief, discovery, onOpenDiscovery,
}: {
  project: Project;
  lead: Lead | null;
  onQuickBrief: () => void;
  discovery: ProjectDiscovery | null;
  onOpenDiscovery: () => void;
}) {
  const liveUrl = project.custom_domain ?? project.landingsite_url;
  const reviewCount = lead?.google_review_count ?? 0;
  const pagespeed = lead?.pagespeed_desktop;
  const scrapeDone = !!project.scrape_completed_at;
  const discoveryAnswers = safeJsonObject(discovery?.answers_json);
  const logoStatus = assetStatus(
    discoveryAnswers.logo_available,
    discoveryAnswers.logo_delivery_status,
    'No logo',
  );
  const photosStatus = assetStatus(
    discoveryAnswers.photos_available,
    discoveryAnswers.photos_delivery_status,
    'No photos',
  );

  return (
    <>
      <div className="bs-side-card">
        <div className="bs-side-title">Discovery</div>
        <div className="bs-side-row bs-side-row-status">
          <span>Planning session</span>
          <span className={discovery?.status === 'complete' ? 'bs-side-status-ok' : 'bs-side-status-na'}>
            {discovery?.status === 'complete' ? 'Complete' : discovery ? 'Draft' : 'Not started'}
          </span>
        </div>
        {project.status === 'prospect' && project.is_internal !== 1 && (
          <div style={{ margin: '8px 0', fontSize: '0.65rem', color: 'var(--yellow)' }}>
            <FlaskConical size={12} /> Prospect project · opens in test mode
          </div>
        )}
        {discovery?.updated_at && (
          <div style={{ marginTop: 7, fontSize: '0.6rem', color: 'var(--text3)' }}>
            Updated {formatRelative(discovery.updated_at)}
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={onOpenDiscovery}>
          {discovery ? 'Continue discovery' : 'Start discovery'}
        </Button>
      </div>

      <div className="bs-side-card">
        <div className="bs-side-title">Assets</div>
        <div className="bs-side-row bs-side-row-status">
          <span>Logo</span>
          <span className={logoStatus.tone}>{logoStatus.label}</span>
        </div>
        <div className="bs-side-row bs-side-row-status">
          <span>Work photos</span>
          <span className={photosStatus.tone}>{photosStatus.label}</span>
        </div>
        <div style={{ marginTop: 8, fontSize: '0.62rem', lineHeight: 1.45, color: 'var(--text3)' }}>
          Delivery tracking only. Files continue to arrive by text or email for now.
        </div>
      </div>

      <div className="bs-side-card">
        <div className="bs-side-title">Quick Actions</div>
        <div className="bs-quick-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={onQuickBrief}
            title="Business + reviews verbatim, for the pre-call landingsite paste"
          >
            <Zap size={14} /> Quick brief (for landingsite demo)
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!liveUrl}
            onClick={() => liveUrl && window.open(liveUrl, '_blank')}
          >
            <ExternalLink size={14} /> Open landingsite.ai project
          </Button>
        </div>
      </div>

      <div className="bs-side-card">
        <div className="bs-side-title">Data Sources</div>
        <div className="bs-side-row bs-side-row-status">
          <span>Google Places</span>
          <span className="bs-side-status-ok">{lead?.place_id ? 'Synced' : 'Not yet'}</span>
        </div>
        <div className="bs-side-row bs-side-row-status">
          <span>Reviews mined</span>
          <span className={reviewCount > 0 ? 'bs-side-status-ok' : 'bs-side-status-na'}>
            {reviewCount > 0 ? `${reviewCount} reviews` : 'None mined'}
          </span>
        </div>
        <div className="bs-side-row bs-side-row-status">
          <span>PageSpeed</span>
          <span className={pagespeed != null ? 'bs-side-status-ok' : 'bs-side-status-na'}>
            {pagespeed != null ? `Desktop ${pagespeed}` : 'Not run'}
          </span>
        </div>
        <div className="bs-side-row bs-side-row-status">
          <span>Website scrape</span>
          <span className={scrapeDone ? 'bs-side-status-ok' : 'bs-side-status-na'}>
            {scrapeDone ? 'Done' : 'Not run'}
          </span>
        </div>
      </div>

    </>
  );
}

// ============================================================================
// DNS card — status-at-a-glance, lives in the sidebar below Data Sources.
// Self-fetches /dns/status and polls every 60s while dns_status='pending' so
// the operator can see active state appear after a registrar NS change
// without refreshing the page. Polling stops automatically once active.
// ============================================================================

function DnsCard({ project, onManageDns }: { project: Project; onManageDns: () => void }) {
  const [status, setStatus] = useState<DnsStatusResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasZone = !!(project.domain && project.cf_zone_id);

  const refresh = useCallback(async () => {
    if (!hasZone) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await api.projects.dns.status(project.id);
      setStatus(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [project.id, hasZone]);

  useEffect(() => {
    if (!hasZone) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Self-scheduling tick — fetch then re-arm only if still pending. Stops
    // automatically when CF reports active, when the user navigates away,
    // or when the component unmounts. 60s cadence is a good balance between
    // operator feedback and Cloudflare subrequest cost (2 CF calls per tick).
    async function tick() {
      if (cancelled) return;
      try {
        const res = await api.projects.dns.status(project.id);
        if (cancelled) return;
        setStatus(res);
        if (res.dns_status === 'pending') {
          timer = setTimeout(tick, 60_000);
        }
      } catch {
        // Silent — sidebar should degrade quietly. Operator can click
        // Refresh to see the explicit error, or open Manage DNS for detail.
        if (!cancelled) timer = setTimeout(tick, 60_000);
      }
    }
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [project.id, hasZone]);

  // Header is shared across empty + populated states.
  const header = (
    <div
      className="bs-side-title"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
    >
      <span>DNS</span>
      {hasZone && (
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          title="Re-check DNS state from Cloudflare"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text3)',
            cursor: refreshing ? 'default' : 'pointer',
            fontSize: '0.7rem',
            padding: '2px 6px',
            opacity: refreshing ? 0.5 : 1,
            textTransform: 'none',
            letterSpacing: 0,
          }}
        >
          {refreshing ? '…' : '↻ Refresh'}
        </button>
      )}
    </div>
  );

  if (!hasZone) {
    return (
      <div className="bs-side-card">
        {header}
        <div
          style={{
            fontSize: '0.72rem',
            color: 'var(--text3)',
            padding: '6px 0',
            lineHeight: 1.5,
          }}
        >
          No domain set
          <div style={{ fontSize: '0.66rem', color: 'var(--text3)', marginTop: 4, opacity: 0.75 }}>
            Add the domain from Configuration.
          </div>
        </div>
      </div>
    );
  }

  // While the first /status fetch is in flight (no status data yet, no error,
  // no refreshing flag), fall back to the project record's dns_status. Avoids
  // a flash of "—" on initial render.
  const dnsStatus = status?.dns_status ?? project.dns_status;
  const nameservers = status?.nameservers ?? safeJsonArray(project.cf_nameservers);
  const records = status?.records ?? [];

  return (
    <div className="bs-side-card">
      {header}

      <div className="bs-side-row bs-side-row-status">
        <span>Zone status</span>
        <span className={dnsStatus === 'active' ? 'bs-side-status-ok' : 'bs-side-status-na'}>
          {dnsStatus === 'active' && 'Active'}
          {dnsStatus === 'pending' && 'Pending'}
          {dnsStatus === 'failed' && 'Failed'}
          {dnsStatus === 'not_created' && 'Not created'}
        </span>
      </div>

      <div
        className="bs-side-row bs-side-row-status"
        onClick={onManageDns}
        style={{ cursor: 'pointer' }}
        title="Click to view + copy nameservers"
      >
        <span>Nameservers</span>
        <span className={nameservers.length > 0 ? 'bs-side-status-ok' : 'bs-side-status-na'}>
          {nameservers.length > 0 ? `${nameservers.length} assigned →` : '— pending'}
        </span>
      </div>

      {/* Per-record rows. If we haven't fetched live records yet, render
          skeleton rows from the expected-record list so the layout doesn't
          jump. Each row's right-hand status updates once /status returns. */}
      {records.length > 0
        ? records.map((r, i) => (
            <div key={`${r.type}-${r.hostname}-${r.content}-${i}`} className="bs-side-row bs-side-row-status">
              <span>{r.type === 'CNAME' ? 'CNAME (www)' : 'A record (apex)'}</span>
              <span className={r.found ? 'bs-side-status-ok' : 'bs-side-status-na'}>
                {r.found ? 'Found' : 'Missing'}
              </span>
            </div>
          ))
        : (
          <div className="bs-side-row bs-side-row-status">
            <span>Records</span>
            <span className="bs-side-status-na">— checking…</span>
          </div>
        )
      }

      {error && (
        <div
          style={{
            fontSize: '0.66rem',
            color: 'var(--red)',
            padding: '6px 0 0',
            lineHeight: 1.4,
            opacity: 0.85,
          }}
        >
          Refresh failed: {error}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function safeJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function safeJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function assetStatus(
  available: unknown,
  delivery: unknown,
  unavailableLabel: string,
): { label: string; tone: string } {
  if (available === false) return { label: unavailableLabel, tone: 'bs-side-status-na' };
  if (available !== true) return { label: '— not answered', tone: 'bs-side-status-na' };
  if (delivery === 'Delivered') return { label: 'Delivered', tone: 'bs-side-status-ok' };
  if (delivery === 'Still waiting') return { label: '◷ Still waiting', tone: 'bs-side-status-na' };
  return { label: 'Delivery unknown', tone: 'bs-side-status-na' };
}

function formatRelative(ts: string | null | undefined): string {
  if (!ts) return 'never';
  const date = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  const diff = Date.now() - date.getTime();
  if (isNaN(diff)) return ts;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

// ============================================================================
// Brief editor wrapper (fetches by id then renders the slide-in panel)
// ============================================================================

function BriefEditorPanelLoader({
  briefId, onClose, showToast, onChanged, onPageCompleted,
}: {
  briefId: number | null;
  onClose: () => void;
  showToast: ShowToast;
  onChanged: () => void;
  onPageCompleted: () => void;
}) {
  const [brief, setBrief] = useState<Brief | null>(null);

  useEffect(() => {
    if (briefId == null) {
      setBrief(null);
      return;
    }
    let active = true;
    const loadBrief = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const loaded = await api.briefs.get(briefId);
          if (active) setBrief(loaded);
          return;
        } catch (err) {
          lastError = err;
          // HTTP errors are real responses; only retry a network interruption,
          // such as Wrangler briefly restarting during local development.
          if (err instanceof ApiError || attempt === 2) break;
          await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
      if (!active) return;
      const msg = lastError instanceof ApiError ? lastError.message : (lastError as Error).message;
      showToast(`Could not load brief: ${msg}`, 'error');
      onClose();
    };
    void loadBrief();
    return () => { active = false; };
  }, [briefId, onClose, showToast]);

  return (
    <BriefEditorPanel
      open={briefId !== null && brief !== null}
      brief={brief}
      onClose={onClose}
      showToast={showToast}
      onChanged={(b) => { setBrief(b); onChanged(); }}
      onPageCompleted={onPageCompleted}
    />
  );
}

// (Unused KIND_LABEL kept in case the editor surfaces brief kinds later.)
void KIND_LABEL;
