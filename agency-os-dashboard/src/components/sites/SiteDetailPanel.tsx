import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Project, Brief, BriefSummary, BriefKind, ShowToast, Tab, Lead } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { OperatorInputForm } from '../briefs/OperatorInputForm';
import { BriefViewerModal } from '../briefs/BriefViewerModal';
import { BriefStudioMatrix } from './BriefStudioMatrix';

interface SiteDetailPanelProps {
  project: Project;
  showToast: ShowToast;
  onSwitchTab: (tab: Tab) => void;
  onBack: () => void;
  onProjectChanged: () => void;
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
  project, showToast, onSwitchTab, onBack, onProjectChanged,
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
                  onClick={() => setViewerBriefId(master.id)}
                />
              ) : (
                <EmptyCallout onOpenForm={() => setOperatorFormOpen(true)} />
              )}

              <h2 className="bs-section-h">Page Matrix</h2>
              <div className="bs-matrix-legend">
                <LegendDot color="empty" label="Not started" />
                <LegendDot color="recommended" label="Recommended" />
                <LegendDot color="briefed" label="Brief generated" />
                <LegendDot color="live" label="Live" />
              </div>

              <div className="bs-matrix-card">
                {!master && (
                  <div className="bs-matrix-overlay">
                    <span className="bs-matrix-lock">🔒</span>
                    <span>Generate the master brief to unlock the matrix</span>
                  </div>
                )}
                {master ? (
                  <BriefStudioMatrix
                    projectId={project.id}
                    reloadToken={master.updated_at ?? master.generated_at ?? ''}
                    showToast={showToast}
                    onOpenBrief={(b) => setViewerBriefId(b.id)}
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
            showToast={showToast}
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

      <BriefViewerModalLoader
        briefId={viewerBriefId}
        onClose={() => setViewerBriefId(null)}
        showToast={showToast}
        onRegenerated={() => void reload()}
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

function MasterBriefCard({ master, onClick }: { master: Brief; onClick: () => void }) {
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
  project, lead, hasMaster, onSwitchTab, showToast,
}: {
  project: Project;
  lead: Lead | null;
  hasMaster: boolean;
  onSwitchTab: (tab: Tab) => void;
  showToast: ShowToast;
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
          <Button variant="ghost" size="sm" onClick={() => showToast('Project info editor lands in a later pass', 'default')}>
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
// Brief viewer wrapper (fetches by id then renders the existing modal)
// ============================================================================

function BriefViewerModalLoader({
  briefId, onClose, showToast, onRegenerated,
}: {
  briefId: number | null;
  onClose: () => void;
  showToast: ShowToast;
  onRegenerated: () => void;
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
    <BriefViewerModal
      open={briefId !== null && brief !== null}
      brief={brief}
      onClose={onClose}
      showToast={showToast}
      onRegenerated={(b) => { setBrief(b); onRegenerated(); }}
    />
  );
}

// (Unused KIND_LABEL kept in case the editor surfaces brief kinds later.)
void KIND_LABEL;
