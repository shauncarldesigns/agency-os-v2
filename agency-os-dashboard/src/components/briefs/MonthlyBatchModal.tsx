import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Project, Brief, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Modal, ModalHeader } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

interface MonthlyBatchModalProps {
  open: boolean;
  project: Project;
  onClose: () => void;
  showToast: ShowToast;
  onBriefGenerated: (brief: Brief) => void;
}

interface Cell {
  service: string;
  city: string;
  state: 'built' | 'building' | 'queued' | 'recommended' | 'available';
}

interface Matrix {
  services: string[];
  cities: string[];
  matrix: Array<{ city: string; inReviews: boolean; cells: Cell[] }>;
  summary: { total: number; built: number; available: number; pct: number };
}

type CellKey = `${string}::${string}`;
const cellKey = (service: string, city: string): CellKey => `${service}::${city}`.toLowerCase() as CellKey;

export function MonthlyBatchModal({
  open, project, onClose, showToast, onBriefGenerated,
}: MonthlyBatchModalProps) {
  const [data, setData] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<CellKey>>(new Set());
  const [batchPeriod, setBatchPeriod] = useState<string>(nextMonthPeriod());
  const [submitting, setSubmitting] = useState(false);

  const target = project.monthly_pages_target || 5;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.projects.coverage(project.id);
      setData(res as Matrix);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Coverage load failed: ${msg}`, 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [project.id, showToast, onClose]);

  useEffect(() => {
    if (!open) {
      setData(null);
      setSelected(new Set());
      setBatchPeriod(nextMonthPeriod());
      return;
    }
    void load();
  }, [open, load]);

  function toggleCell(svc: string, city: string, state: Cell['state']) {
    if (state === 'built' || state === 'building' || state === 'queued') return;
    const key = cellKey(svc, city);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < target) next.add(key);
      else showToast(`Monthly target is ${target} pages — deselect another to add this`, 'default');
      return next;
    });
  }

  const recommendedCount = useMemo(() => {
    if (!data) return 0;
    return data.matrix.flatMap((r) => r.cells).filter((c) => c.state === 'recommended').length;
  }, [data]);

  const selectedList = useMemo(() => {
    return Array.from(selected).map((k) => {
      const [service, city] = k.split('::');
      return { service, city };
    });
  }, [selected]);

  async function handleGenerate() {
    if (selected.size === 0) {
      showToast('Select at least one page', 'error');
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(batchPeriod)) {
      showToast("Batch period must be 'YYYY-MM'", 'error');
      return;
    }
    setSubmitting(true);
    try {
      const brief = await api.briefs.monthlyBatch(project.id, batchPeriod, selectedList);
      showToast(`Monthly batch brief generated for ${batchPeriod}`, 'success');
      onBriefGenerated(brief);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Generate failed: ${msg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={submitting ? () => undefined : onClose} width={920}>
      <ModalHeader title={`Monthly Batch — ${project.business_name}`} onClose={submitting ? () => undefined : onClose}>
        <span style={{ marginLeft: 10, fontSize: '0.62rem', color: 'var(--text3)' }}>
          Tier 3 · {target} pages / month
        </span>
      </ModalHeader>

      <div style={{ padding: 18, maxHeight: '70vh', overflowY: 'auto' }}>
        {/* Batch period */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.62rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--text3)' }}>
            Batch period
          </label>
          <input
            type="text"
            value={batchPeriod}
            onChange={(e) => setBatchPeriod(e.target.value)}
            placeholder="YYYY-MM"
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 'var(--r)', padding: '5px 10px',
              color: 'var(--text)', fontSize: '0.74rem', fontFamily: "'DM Mono', monospace",
              width: 110,
            }}
          />
          <span style={{ fontSize: '0.62rem', color: 'var(--text3)' }}>
            (e.g. {nextMonthPeriod()})
          </span>
        </div>

        {loading || !data ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)' }}>
            <Spinner /> Loading coverage matrix…
          </div>
        ) : (
          <MatrixGrid
            data={data}
            selected={selected}
            onToggle={toggleCell}
            recommendedCount={recommendedCount}
            target={target}
          />
        )}

        {selectedList.length > 0 && (
          <div style={{
            marginTop: 16,
            background: 'var(--accent-dim)',
            border: '1px solid rgba(255,107,43,0.22)',
            borderRadius: 'var(--r)',
            padding: 12,
          }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>
              Selected for this batch ({selectedList.length}/{target})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {selectedList.map((p) => (
                <span
                  key={`${p.service}-${p.city}`}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 999,
                    padding: '3px 9px',
                    fontSize: '0.7rem',
                    color: 'var(--text2)',
                  }}
                >
                  {p.service} → {p.city}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end' }}>
        <span style={{ marginRight: 'auto', fontSize: '0.65rem', color: 'var(--text3)' }}>
          {selected.size} / {target} selected
        </span>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          disabled={submitting || selected.size === 0}
          onClick={handleGenerate}
        >
          {submitting ? <><Spinner /> Generating…</> : `✦ Generate batch brief (${selected.size})`}
        </Button>
      </div>
    </Modal>
  );
}

// ============================================================================

function MatrixGrid({
  data, selected, onToggle, recommendedCount, target,
}: {
  data: Matrix;
  selected: Set<CellKey>;
  onToggle: (service: string, city: string, state: Cell['state']) => void;
  recommendedCount: number;
  target: number;
}) {
  const gridTemplate = `160px repeat(${data.services.length}, 1fr)`;

  return (
    <>
      {recommendedCount > 0 && (
        <div style={{
          padding: '10px 12px', marginBottom: 12,
          background: 'var(--tier3-bg)',
          border: '1px solid rgba(167,139,250,0.2)',
          borderRadius: 'var(--r)',
          fontSize: '0.7rem', color: 'var(--text2)', lineHeight: 1.6,
        }}>
          <strong style={{ color: 'var(--tier3)' }}>★ {recommendedCount} recommended</strong>{' '}
          — cities mentioned in customer reviews that have no service-area page yet. Selecting up to {target} this month.
        </div>
      )}

      <div className="matrix-grid">
        <div className="mhead-row" style={{ gridTemplateColumns: gridTemplate }}>
          <div className="mhead-empty" />
          {data.services.map((s) => (
            <div key={s} className="mhead-cell">
              {s.split(' ').map((w, i) => <span key={i}>{i > 0 && <br />}{w}</span>)}
            </div>
          ))}
        </div>
        {data.matrix.map((row) => (
          <div key={row.city} className="mrow" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="mcity">
              {row.city}
              {row.inReviews && <span className="mcity-tag">★ in reviews</span>}
            </div>
            {row.cells.map((cell) => {
              const isSelected = selected.has(cellKey(cell.service, cell.city));
              const className = isSelected ? 'mcell selected' : `mcell ${cell.state}`;
              const label = cell.state === 'built' ? '✓'
                : cell.state === 'building' ? '⚙'
                : cell.state === 'queued' ? '⏳'
                : isSelected ? '✓'
                : '+';
              return (
                <div
                  key={`${row.city}-${cell.service}`}
                  className={className}
                  onClick={() => onToggle(cell.service, cell.city, cell.state)}
                >
                  {label}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function nextMonthPeriod(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
