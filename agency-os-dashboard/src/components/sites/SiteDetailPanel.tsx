import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Project, Brief, BriefSummary, BriefKind, ShowToast, Tab, Lead } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { OperatorInputForm } from '../briefs/OperatorInputForm';
import { BriefEditorPanel } from '../briefs/BriefEditorPanel';
import { BriefStudioMatrix } from './BriefStudioMatrix';
import {
  extractServicesFromBrief,
  extractServiceAreasFromBrief,
  diffAdditions,
} from '../../lib/briefExtract';

interface SiteDetailPanelProps {
  project: Project;
  showToast: ShowToast;
  onSwitchTab: (tab: Tab) => void;
  onBack: () => void;
  onProjectChanged: () => void;
  /** Open the shared Edit Project modal (tier change / business info / delete).
   *  Lives at the SitesPanel level so the modal survives the detail view
   *  unmounting (e.g. when deleting). */
  onEditProject: () => void;
}

const TIER_MRR = { 1: 0, 2: 79, 3: 499 } as const;
const TIER_LABEL = { 1: 'TIER 1', 2: 'TIER 2', 3: 'TIER 3' } as const;

const KIND_LABEL: Record<BriefKind, string> = {
  master: 'Master',
  page: 'Page',
};

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
  project, showToast, onSwitchTab, onBack, onProjectChanged, onEditProject,
}: SiteDetailPanelProps) {
  const [briefs, setBriefs] = useState<BriefSummary[]>([]);
  const [master, setMaster] = useState<Brief | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerBriefId, setViewerBriefId] = useState<number | null>(null);
  const [operatorFormOpen, setOperatorFormOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [briefsRes, masterRes, leadRes] = await Promise.all([
        api.briefs.listForProject(project.id),
        api.briefs.getMaster(project.id).catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
        project.lead_id
          ? api.leads.get(project.lead_id).then((r) => r.lead).catch(() => null)
          : Promise.resolve(null),
      ]);
      setBriefs(briefsRes.briefs);
      setMaster(masterRes);
      setLead(leadRes);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load Brief Studio: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [project.id, project.lead_id, showToast]);

  useEffect(() => { void reload(); }, [reload]);

  const tier = (project.tier ?? 1) as 1 | 2 | 3;
  const mrr = TIER_MRR[tier] ?? 0;

  const stats = useMemo(() => {
    const completePages = 0;       // Phase 4 populates from the matrix endpoint
    const briefedPages = briefs.filter((b) => b.kind === 'page' && b.status === 'briefed').length;
    return {
      masterCount: master ? 1 : 0,
      pagesLive: completePages,
      pagesPasted: briefedPages,
      monthlyTarget: project.monthly_pages_target ?? (tier === 3 ? 5 : 0),
    };
  }, [master, briefs, project.monthly_pages_target, tier]);

  // Brief-vs-matrix drift detection (Option C bridge): when the master brief
  // mentions services or service areas not in project.services/service_areas,
  // surface a callout so the operator can one-click sync. We never silently
  // mutate the project — the matrix stays the source of truth.
  const projectServices = useMemo(() => safeJsonArray(project.services), [project.services]);
  const projectAreas = useMemo(() => safeJsonArray(project.service_areas), [project.service_areas]);
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
    const projectTs = Date.parse(project.updated_at ?? '');
    if (!Number.isFinite(masterTs) || !Number.isFinite(projectTs)) return false;
    // Small fudge so trivial near-simultaneous timestamps don't flag.
    return projectTs - masterTs > 2_000;
  }, [master, project.updated_at]);

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
        <div>
          <button type="button" className="bs-back" onClick={onBack}>← All sites</button>
          <div className="bs-breadcrumb">Sites › {project.business_name}</div>
          <h1 className="bs-title">Brief Studio</h1>
        </div>
        <div className="bs-topbar-meta">
          <span className={`bs-tier-badge bs-tier-${tier}`}>
            {TIER_LABEL[tier]}{mrr > 0 ? ` · $${mrr}/mo` : ''}
          </span>
          <span className="bs-topbar-sub">
            {[project.city, project.state].filter(Boolean).join(', ') || '—'}
            {project.pages_built ? ` · ${project.pages_built} pages built` : ' · 0 pages built'}
          </span>
        </div>
      </div>

      <div className="bs-layout">
        <main className="bs-main">
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
              <Spinner /> Loading Brief Studio…
            </div>
          ) : (
            <>
              <StatsRow stats={stats} hasMaster={!!master} />

              {master ? (
                <MasterBriefCard
                  master={master}
                  stale={matrixIsStale}
                  onClick={() => setViewerBriefId(master.id)}
                />
              ) : (
                <EmptyCallout onOpenForm={() => setOperatorFormOpen(true)} />
              )}

              {tier === 3 && hasBriefAdditions && (
                <BriefAdditionsCallout
                  services={briefAdditions.services}
                  areas={briefAdditions.areas}
                  onAdd={applyBriefAdditions}
                  onDismiss={() => setDismissedSig(additionsSig)}
                />
              )}

              <h2 className="bs-section-h">Page Matrix</h2>
              <div className="bs-matrix-legend">
                <LegendDot color="empty" label="Not started" />
                <LegendDot color="recommended" label="Recommended" />
                <LegendDot color="briefed" label="Brief generated" />
                <LegendDot color="live" label="Live" />
              </div>

              <div className="bs-matrix-card">
                {tier !== 3 ? (
                  <div className="bs-matrix-overlay">
                    <span className="bs-matrix-lock">🔒</span>
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
                    <span className="bs-matrix-lock">🔒</span>
                    <span>Generate the master brief to unlock the matrix</span>
                  </div>
                ) : null}
                {tier === 3 && master ? (
                  <BriefStudioMatrix
                    projectId={project.id}
                    reloadToken={`${master.updated_at ?? master.generated_at ?? ''}::${project.updated_at}`}
                    showToast={showToast}
                    onOpenBrief={(b) => setViewerBriefId(b.id)}
                    onProjectChanged={() => { onProjectChanged(); void reload(); }}
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
            hasMaster={!!master}
            onSwitchTab={onSwitchTab}
            onEditProject={onEditProject}
          />
        </aside>
      </div>

      {operatorFormOpen && (
        <OperatorInputForm
          open={true}
          onClose={() => setOperatorFormOpen(false)}
          project={project}
          lead={lead}
          showToast={showToast}
          onBriefGenerated={(b) => {
            setOperatorFormOpen(false);
            setViewerBriefId(b.id);
            void reload();
            onProjectChanged();
          }}
        />
      )}

      <BriefEditorPanelLoader
        briefId={viewerBriefId}
        onClose={() => setViewerBriefId(null)}
        showToast={showToast}
        onChanged={() => void reload()}
        onPageCompleted={() => { void reload(); onProjectChanged(); }}
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
  stats: { masterCount: number; pagesLive: number; pagesPasted: number; monthlyTarget: number };
  hasMaster: boolean;
}) {
  return (
    <div className="bs-stats">
      <StatTile
        value={hasMaster ? String(stats.masterCount) : '—'}
        label={hasMaster ? 'Master Brief' : 'Master Brief · not yet generated'}
        muted={!hasMaster}
      />
      <StatTile
        value={hasMaster ? `${stats.pagesLive} / —` : '0 / —'}
        label={hasMaster ? 'Pages live' : 'Pages live · matrix locked'}
        muted={!hasMaster}
      />
      <StatTile
        value={String(stats.pagesPasted)}
        label={'Briefed · awaiting complete'}
        muted={!hasMaster && stats.pagesPasted === 0}
      />
      <StatTile
        value={stats.monthlyTarget > 0 ? `0 / ${stats.monthlyTarget}` : '—'}
        label={stats.monthlyTarget > 0 ? 'Monthly target this period' : 'No monthly target set'}
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
      <div className="bs-empty-tag">📋 Master Brief · Not yet generated</div>
      <div className="bs-empty-icon">🧭</div>
      <div className="bs-empty-title">Start with the Master Brief</div>
      <div className="bs-empty-sub">
        The master brief defines services, service areas, brand voice, and customer testimonials.
        Once it's saved, the page matrix below populates and you can generate briefs for individual
        pages on demand.
      </div>
      <Button variant="primary" onClick={onOpenForm}>+ Generate Master Brief</Button>
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
          <div className="bs-master-title">📋 Master Brief</div>
          <div className="bs-master-meta">
            <span className="bs-master-chip">v{master.version}</span>
            <span>Updated {shortDate}</span>
            {master.tbd_count > 0 && (
              <span className="bs-master-tbd">⚠ {master.tbd_count} TBD{master.tbd_count === 1 ? '' : 's'}</span>
            )}
            {master.tbd_count === 0 && <span className="bs-master-ok">✓ no TBDs</span>}
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
                ⚠ Matrix may be stale
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
          📋 BRIEF MENTIONS {total} ITEM{total === 1 ? '' : 'S'} NOT ON THE MATRIX
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
          {['Homepage', 'About', 'Services Overview', 'Contact', 'FAQ', '+ Add'].map((l) => (
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

// ============================================================================
// Sidebar
// ============================================================================

function Sidebar({
  project, lead, hasMaster, onSwitchTab, onEditProject,
}: {
  project: Project;
  lead: Lead | null;
  hasMaster: boolean;
  onSwitchTab: (tab: Tab) => void;
  onEditProject: () => void;
}) {
  const liveUrl = project.custom_domain ?? project.landingsite_url;
  const reviewCount = lead?.google_review_count ?? 0;
  const pagespeed = lead?.pagespeed_desktop;
  const scrapeDone = !!project.scrape_completed_at;

  return (
    <>
      <div className="bs-side-card">
        <div className="bs-side-title">Status Legend</div>
        <div className="bs-side-row">
          <span className="bs-legend-dot bs-legend-empty" /> Planned — no brief yet
        </div>
        <div className="bs-side-row">
          <span className="bs-legend-dot bs-legend-briefed" /> Briefed — ready to paste
        </div>
        <div className="bs-side-row">
          <span className="bs-legend-dot bs-legend-live" /> Complete — published in landingsite.ai
        </div>
      </div>

      <div className="bs-side-card">
        <div className="bs-side-title">Quick Actions</div>
        <div className="bs-quick-actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={!liveUrl}
            onClick={() => liveUrl && window.open(liveUrl, '_blank')}
          >
            ↗ Open landingsite.ai project
          </Button>
          <Button variant="ghost" size="sm" disabled={!hasMaster} onClick={() => onSwitchTab('reports')}>
            📊 View Reports
          </Button>
          <Button variant="ghost" size="sm" onClick={onEditProject}>
            ✎ Edit Project Info
          </Button>
        </div>
      </div>

      <div className="bs-side-card">
        <div className="bs-side-title">Data Sources</div>
        <div className="bs-side-row bs-side-row-status">
          <span>Google Places</span>
          <span className="bs-side-status-ok">{lead?.place_id ? '✓ Synced' : '— not yet'}</span>
        </div>
        <div className="bs-side-row bs-side-row-status">
          <span>Reviews mined</span>
          <span className={reviewCount > 0 ? 'bs-side-status-ok' : 'bs-side-status-na'}>
            {reviewCount > 0 ? `✓ ${reviewCount} reviews` : '— none mined'}
          </span>
        </div>
        <div className="bs-side-row bs-side-row-status">
          <span>PageSpeed</span>
          <span className={pagespeed != null ? 'bs-side-status-ok' : 'bs-side-status-na'}>
            {pagespeed != null ? `✓ Desktop ${pagespeed}` : '— not run'}
          </span>
        </div>
        <div className="bs-side-row bs-side-row-status">
          <span>Website scrape</span>
          <span className={scrapeDone ? 'bs-side-status-ok' : 'bs-side-status-na'}>
            {scrapeDone ? '✓ Done' : '— not run'}
          </span>
        </div>
      </div>
    </>
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
    void api.briefs.get(briefId).then(setBrief).catch((err) => {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load brief: ${msg}`, 'error');
      onClose();
    });
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
