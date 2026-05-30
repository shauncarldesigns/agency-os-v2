import { useState, useEffect, useCallback, useRef } from 'react';
import type { Brief, Page, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Spinner } from '../shared/Spinner';

/**
 * Live page matrix for the Brief Studio.
 *
 * Fetches /api/projects/:id/matrix and renders three sections:
 *   1. Foundation pages (Homepage, About, Services Overview, Contact, FAQ)
 *   2. Individual service pages (one per service from the master brief)
 *   3. Service-area grid (services × cities)
 *
 * Cell click behaviour:
 *   - empty cell (no page row yet)  → POST /projects/:id/pages, then POST
 *     /projects/:id/pages/:pageId/brief, then open the resulting brief.
 *   - briefed/complete cell (row exists)  → fetch the page's brief by
 *     page_id and open the existing one. We look it up by page_id via the
 *     project brief list.
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
  /** Bump this from the parent to force a re-fetch (e.g. after the master is regenerated). Any scalar that changes. */
  reloadToken?: string | number;
  showToast: ShowToast;
  onOpenBrief: (brief: Brief) => void;
  /** Fired after the matrix mutates the project (e.g. operator adds a
   *  service or service area inline). Parent reloads its project + master
   *  brief so the "matrix may be stale" hint recomputes against the fresh
   *  project.updated_at. */
  onProjectChanged?: () => void;
}

export function BriefStudioMatrix({
  projectId, reloadToken, showToast, onOpenBrief, onProjectChanged,
}: BriefStudioMatrixProps) {
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [savingAxis, setSavingAxis] = useState<'service' | 'area' | null>(null);

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
   * Append a service or service area to the project, dedup-protected against
   * the current axis. Refreshes the matrix and signals the parent so the
   * Brief Studio's "matrix may be stale" hint can recompute.
   */
  const addAxisItem = useCallback(async (axis: 'service' | 'area', value: string) => {
    if (savingAxis || !data) return;
    const trimmed = value.trim();
    if (!trimmed) return;

    const current = axis === 'service'
      ? data.servicePages.map((r) => r.service)
      : data.serviceAreaGrid.cities;

    // Case-insensitive dedup — silently no-op if the operator typed
    // something already on the axis.
    const exists = current.some((v) => v.trim().toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      showToast(`${trimmed} is already on the matrix`, 'default');
      return;
    }

    setSavingAxis(axis);
    try {
      const nextArr = [...current, trimmed];
      const patch = axis === 'service'
        ? { services: nextArr }
        : { service_areas: nextArr };
      await api.projects.update(projectId, patch);
      showToast(`Added ${trimmed} to the matrix`, 'success');
      await load();
      onProjectChanged?.();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Add failed: ${msg}`, 'error');
    } finally {
      setSavingAxis(null);
    }
  }, [data, load, onProjectChanged, projectId, savingAxis, showToast]);

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

      // If the row has no brief yet (status='planned' or empty), generate one.
      if (pageRow.status === '' || pageRow.status === 'planned' || pageRow.pageId == null) {
        const brief = await api.briefs.generatePage(projectId, pageId);
        onOpenBrief(brief);
        await load();   // refresh so the cell flips to 'briefed'
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
  const noCities = serviceAreaGrid.cities.length === 0;

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
          <AddPill
            placeholder="Service name (e.g. Roof Replacement)"
            saving={savingAxis === 'service'}
            onAdd={(v) => addAxisItem('service', v)}
            label={servicePages.length === 0 ? '+ Add first service' : '+ Add service'}
          />
        </div>
      </MatrixSection>

      <MatrixSection label="Service Area Pages (service × city)">
        {noServices || noCities ? (
          <>
            <PlaceholderRow text={
              noServices && noCities
                ? 'Add at least one service and one service area to populate the grid.'
                : noServices
                  ? 'Add at least one service (above) to populate the grid.'
                  : 'Add at least one service area to populate the grid.'
            } />
            {!noServices && noCities && (
              <div className="bs-matrix-row-flat" style={{ marginTop: 8 }}>
                <AddPill
                  placeholder="Service area / city (e.g. Madison)"
                  saving={savingAxis === 'area'}
                  onAdd={(v) => addAxisItem('area', v)}
                  label="+ Add first service area"
                />
              </div>
            )}
          </>
        ) : (
          <ServiceAreaGrid
            services={serviceAreaGrid.services}
            cities={serviceAreaGrid.cities}
            cells={serviceAreaGrid.cells}
            busyKey={busyKey}
            savingAxis={savingAxis}
            onCellClick={(svc, city, row) =>
              handleCellClick(
                `g:${svc}:${city}`,
                row,
                { type: 'service-area', service: svc, city }
              )
            }
            onAddArea={(v) => addAxisItem('area', v)}
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
  services, cities, cells, busyKey, savingAxis, onCellClick, onAddArea,
}: {
  services: string[];
  cities: string[];
  cells: Array<{ service: string; city: string; pageId: number | null; status: string; billingStatus: string }>;
  busyKey: string | null;
  savingAxis: 'service' | 'area' | null;
  onCellClick: (service: string, city: string, row: { pageId: number | null; status: string; billingStatus: string }) => void;
  onAddArea: (value: string) => void;
}) {
  // Extra trailing column hosts the inline "+ Add city" pill so the operator
  // can extend the grid without leaving the table.
  const gridTemplate = `170px repeat(${cities.length}, minmax(110px, 1fr)) minmax(140px, 1fr)`;
  const byKey = new Map<string, (typeof cells)[number]>();
  for (const c of cells) byKey.set(`${c.service}::${c.city}`.toLowerCase(), c);

  return (
    <div className="bs-grid-wrap">
      <div className="bs-grid-header" style={{ gridTemplateColumns: gridTemplate }}>
        <div />
        {cities.map((city) => (
          <div key={city} className="bs-grid-col-label">{city}</div>
        ))}
        <div className="bs-grid-col-label" style={{ padding: 0 }}>
          <AddPill
            placeholder="City"
            saving={savingAxis === 'area'}
            onAdd={onAddArea}
            label="+ Add city"
            compact
          />
        </div>
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
            {/* Trailing spacer cell to align with the header's "+ Add city" slot */}
            <div />
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

/**
 * Inline two-state pill: collapsed shows "+ Add ..." text; clicking expands
 * to an input + ✓ confirm. Enter submits, Escape cancels. Used at the end of
 * the Service Pages row and the Service Area grid header.
 */
function AddPill({
  label, placeholder, saving, onAdd, compact,
}: {
  label: string;
  placeholder: string;
  saving: boolean;
  onAdd: (value: string) => void;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const trimmed = value.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }
    onAdd(trimmed);
    setValue('');
    setEditing(false);
  }

  if (!editing && !saving) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`bs-add-pill ${compact ? 'bs-add-pill-compact' : ''}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: compact ? '6px 8px' : '10px 14px',
          minHeight: compact ? 36 : undefined,
          background: 'transparent',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--r)',
          color: 'var(--text3)',
          fontSize: compact ? '0.62rem' : '0.7rem',
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
        title={placeholder}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: compact ? '4px 6px' : '6px 8px',
        minHeight: compact ? 36 : undefined,
        background: 'var(--surface2)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--r)',
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={saving}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { setEditing(false); setValue(''); }
        }}
        onBlur={() => {
          // Defer so the confirm-button click can register before the input
          // un-mounts via setEditing(false).
          setTimeout(() => { if (!saving) setEditing(false); }, 120);
        }}
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text)',
          fontSize: compact ? '0.7rem' : '0.78rem',
          fontFamily: 'inherit',
          minWidth: compact ? 90 : 140,
          padding: 0,
        }}
      />
      {saving ? (
        <Spinner />
      ) : (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); commit(); }}
          style={{
            background: 'var(--accent)',
            border: 'none',
            color: 'white',
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: '0.7rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          title="Add"
        >
          ✓
        </button>
      )}
    </div>
  );
}

function describePage(spec: { type: string; service?: string; city?: string; customTitle?: string }): string {
  if (spec.type === 'service-area' && spec.service && spec.city) return `${spec.service} in ${spec.city}`;
  if (spec.type === 'service' && spec.service) return spec.service;
  if (spec.type === 'custom' && spec.customTitle) return spec.customTitle;
  return spec.type.replace(/_/g, ' ').replace(/-/g, ' ');
}
