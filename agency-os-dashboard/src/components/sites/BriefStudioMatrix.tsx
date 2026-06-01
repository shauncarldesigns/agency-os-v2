import { useState, useEffect, useCallback } from 'react';
import type { Brief, Page, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Spinner } from '../shared/Spinner';

/**
 * Live page matrix for the Brief Studio.
 *
 * Three sections:
 *   1. Foundation pages (Homepage, About, Services Overview, Contact, FAQ)
 *   2. Individual service pages (one per service in project.services)
 *   3. Service-area grid (services × cities)
 *
 * Axes are read-only — to add or remove services and service areas, open
 * Edit Project Info on the sidebar. The matrix mirrors what's on the project.
 *
 * Cell click behaviour:
 *   - empty cell (no page row yet)  → POST /projects/:id/pages, then POST
 *     /projects/:id/pages/:pageId/brief, then open the resulting brief.
 *   - briefed/complete cell (row exists)  → fetch the page's brief by
 *     page_id and open the existing one.
 *
 * The opened brief is rendered by the parent in the slide-in BriefEditorPanel.
 */

interface MatrixData {
  foundationPages: Array<{ type: string; label: string; pageId: number | null; status: string; billingStatus: string }>;
  servicePages: Array<{ service: string; pageId: number | null; status: string; billingStatus: string }>;
  serviceAreaGrid: {
    services: string[];
    cities: string[];
    cells: Array<{ service: string; city: string; pageId: number | null; status: string; billingStatus: string }>;
  };
}

interface BriefStudioMatrixProps {
  projectId: number;
  /** Bump this from the parent to force a re-fetch (e.g. after the master is regenerated or
   *  the project's services/areas change via the editor modal). Any scalar that changes. */
  reloadToken?: string | number;
  showToast: ShowToast;
  onOpenBrief: (brief: Brief) => void;
}

export function BriefStudioMatrix({
  projectId, reloadToken, showToast, onOpenBrief,
}: BriefStudioMatrixProps) {
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.matrix.get(projectId);
      setData(res as MatrixData);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Matrix load failed: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [projectId, showToast]);

  useEffect(() => { void load(); }, [load, reloadToken]);

  /**
   * Resolve a click into either "create page + generate brief" or "open
   * existing brief". cellKey is a stable string used by the busy-spinner.
   */
  async function handleCellClick(
    cellKey: string,
    pageRow: { pageId: number | null; status: string },
    pageSpec: { type: string; service?: string; city?: string; customTitle?: string }
  ) {
    if (busyKey) return;
    setBusyKey(cellKey);
    try {
      let pageId = pageRow.pageId;

      // Materialise the page row if it doesn't exist yet.
      if (pageId == null) {
        const page = await api.pages.create(projectId, pageSpec) as Page;
        pageId = page.id;
      }

      // If the row has no brief yet, generate one.
      if (pageRow.status === '' || pageRow.status === 'planned' || pageRow.pageId == null) {
        const brief = await api.briefs.generatePage(projectId, pageId);
        onOpenBrief(brief);
        await load();
        showToast(`Brief generated for ${describePage(pageSpec)}`, 'success');
        return;
      }

      // Brief already exists — find it via the project brief list and open.
      const briefs = await api.briefs.listForProject(projectId);
      const summary = briefs.briefs.find((b) => b.kind === 'page' && b.page_id === pageId);
      if (!summary) {
        showToast('Brief metadata missing — regenerating', 'default');
        const brief = await api.briefs.generatePage(projectId, pageId);
        onOpenBrief(brief);
        await load();
        return;
      }
      const full = await api.briefs.get(summary.id);
      onOpenBrief(full);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Cell action failed: ${msg}`, 'error');
    } finally {
      setBusyKey(null);
    }
  }

  if (loading || !data) {
    return (
      <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>
        <Spinner /> Loading matrix…
      </div>
    );
  }

  const { foundationPages, servicePages, serviceAreaGrid } = data;
  const noServices = serviceAreaGrid.services.length === 0;
  const cityCount = serviceAreaGrid.cities.length;
  const noCities = cityCount === 0;
  // A "service × city" matrix only earns its weight with multiple cities —
  // a single-column matrix is just a duplicate of the Individual Service
  // Pages row. Hide the grid until the operator has 2+ service areas.
  const tooFewCities = cityCount < 2;

  return (
    <>
      <MatrixSection label="Foundation Pages">
        <div className="bs-matrix-row-flat">
          {foundationPages.map((row) => {
            const key = `f:${row.type}:${row.label}`;
            return (
              <Cell
                key={key}
                cellKey={key}
                title={row.label}
                status={row.status}
                billing={row.billingStatus}
                busy={busyKey === key}
                onClick={() =>
                  handleCellClick(
                    key,
                    row,
                    row.type === 'custom'
                      ? { type: 'custom', customTitle: row.label }
                      : { type: row.type }
                  )
                }
              />
            );
          })}
        </div>
      </MatrixSection>

      <MatrixSection label="Individual Service Pages">
        {servicePages.length === 0 ? (
          <PlaceholderRow text="No services yet — add them in Edit Project Info on the sidebar." />
        ) : (
          <div className="bs-matrix-row-flat">
            {servicePages.map((row) => {
              const key = `s:${row.service}`;
              return (
                <Cell
                  key={key}
                  cellKey={key}
                  title={row.service}
                  status={row.status}
                  billing={row.billingStatus}
                  busy={busyKey === key}
                  onClick={() =>
                    handleCellClick(
                      key,
                      row,
                      { type: 'service', service: row.service }
                    )
                  }
                />
              );
            })}
          </div>
        )}
      </MatrixSection>

      <MatrixSection label="Service Area Pages (service × city)">
        {noServices || tooFewCities ? (
          <PlaceholderRow text={
            noServices && noCities
              ? 'Add at least one service and two+ service areas in Edit Project Info to populate the grid.'
              : noServices
                ? 'Add at least one service in Edit Project Info to populate the grid.'
                : noCities
                  ? 'Add at least two service areas in Edit Project Info to populate the grid.'
                  : `Service-area matrix appears with 2+ service areas. Currently 1 area (${serviceAreaGrid.cities[0]}) — add more in Edit Project Info.`
          } />
        ) : (
          <ServiceAreaGrid
            services={serviceAreaGrid.services}
            cities={serviceAreaGrid.cities}
            cells={serviceAreaGrid.cells}
            busyKey={busyKey}
            onCellClick={(svc, city, row) =>
              handleCellClick(
                `g:${svc}:${city}`,
                row,
                { type: 'service-area', service: svc, city }
              )
            }
          />
        )}
      </MatrixSection>
    </>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function MatrixSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bs-matrix-section">
      <div className="bs-matrix-section-label">{label}</div>
      {children}
    </div>
  );
}

function PlaceholderRow({ text }: { text: string }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'var(--surface2)',
      border: '1px dashed var(--border)',
      borderRadius: 'var(--r)',
      fontSize: '0.7rem',
      color: 'var(--text3)',
    }}>
      {text}
    </div>
  );
}

function ServiceAreaGrid({
  services, cities, cells, busyKey, onCellClick,
}: {
  services: string[];
  cities: string[];
  cells: Array<{ service: string; city: string; pageId: number | null; status: string; billingStatus: string }>;
  busyKey: string | null;
  onCellClick: (service: string, city: string, row: { pageId: number | null; status: string; billingStatus: string }) => void;
}) {
  const gridTemplate = `170px repeat(${cities.length}, minmax(110px, 1fr))`;
  const byKey = new Map<string, (typeof cells)[number]>();
  for (const c of cells) byKey.set(`${c.service}::${c.city}`.toLowerCase(), c);

  return (
    <div className="bs-grid-wrap">
      <div className="bs-grid-header" style={{ gridTemplateColumns: gridTemplate }}>
        <div />
        {cities.map((city) => (
          <div key={city} className="bs-grid-col-label">{city}</div>
        ))}
      </div>
      {services.map((service) => {
        const rowCells = cities.map((city) => byKey.get(`${service}::${city}`.toLowerCase()));
        const completeCount = rowCells.filter((c) => c?.status === 'complete').length;
        return (
          <div key={service} className="bs-grid-row" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="bs-grid-row-label">
              <div>{service}</div>
              <div className="bs-grid-row-meta">{completeCount} of {cities.length} live</div>
            </div>
            {cities.map((city) => {
              const cell = byKey.get(`${service}::${city}`.toLowerCase());
              const key = `g:${service}:${city}`;
              return (
                <Cell
                  key={key}
                  cellKey={key}
                  title={city}
                  status={cell?.status ?? ''}
                  billing={cell?.billingStatus ?? ''}
                  busy={busyKey === key}
                  compact
                  onClick={() =>
                    onCellClick(
                      service, city,
                      cell ?? { pageId: null, status: '', billingStatus: '' }
                    )
                  }
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Cell({
  cellKey: _cellKey, title, status, billing, compact, busy, onClick,
}: {
  cellKey: string;
  title: string;
  status: string;
  billing: string;
  compact?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  const variant = cellVariant(status);
  const label = statusLabel(status);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`bs-cell bs-cell-${variant} ${compact ? 'bs-cell-compact' : ''}`}
      title={`${title} · ${label}${billing ? ` · ${billing}` : ''}`}
    >
      {billing && billing !== 'included' && (
        <span className="bs-cell-billing">{billingShort(billing)}</span>
      )}
      <div className="bs-cell-title">{title}</div>
      <div className="bs-cell-status">{busy ? <><Spinner /> Generating…</> : label}</div>
    </button>
  );
}

function cellVariant(status: string): 'empty' | 'briefed' | 'live' | 'recommended' {
  switch (status) {
    case 'complete': return 'live';
    case 'briefed': return 'briefed';
    case 'recommended': return 'recommended';
    default: return 'empty';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'complete': return '● Live';
    case 'briefed': return '📋 Briefed';
    case 'planned': return '+ Generate brief';
    case 'recommended': return '★ Recommended';
    default: return '+ Generate brief';
  }
}

function billingShort(b: string): string {
  if (b === 'add_on') return 'add-on';
  if (b === 'comp') return 'comp';
  return b;
}

function describePage(spec: { type: string; service?: string; city?: string; customTitle?: string }): string {
  if (spec.type === 'service-area' && spec.service && spec.city) return `${spec.service} in ${spec.city}`;
  if (spec.type === 'service' && spec.service) return spec.service;
  if (spec.type === 'custom' && spec.customTitle) return spec.customTitle;
  return spec.type.replace(/_/g, ' ').replace(/-/g, ' ');
}
