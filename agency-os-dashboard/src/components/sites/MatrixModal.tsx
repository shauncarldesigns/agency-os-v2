import { useState, useEffect, useMemo } from 'react';
import type { ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

interface MatrixModalProps {
  open: boolean;
  projectId: number | null;
  projectName: string;
  projectUrl: string | null;
  onClose: () => void;
  showToast: ShowToast;
  onExpanded: () => void;
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

export function MatrixModal({ open, projectId, projectName, projectUrl, onClose, showToast, onExpanded }: MatrixModalProps) {
  const [data, setData] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<CellKey>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ count: number; minutes: number } | null>(null);

  useEffect(() => {
    if (!open || projectId == null) {
      setData(null);
      setSelected(new Set());
      setConfirmation(null);
      return;
    }
    loadCoverage(projectId);
  }, [open, projectId]);

  async function loadCoverage(id: number) {
    setLoading(true);
    try {
      const res = await api.projects.coverage(id);
      setData(res);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Coverage load failed: ${msg}`, 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }

  function toggleCell(svc: string, city: string, state: Cell['state']) {
    if (state === 'built' || state === 'building' || state === 'queued') return;
    const key = cellKey(svc, city);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function adjustSelection(delta: number) {
    if (!data) return;
    if (delta < 0) {
      // Remove the most recently-added selection
      const arr = Array.from(selected);
      const next = new Set(arr.slice(0, Math.max(0, arr.length + delta)));
      setSelected(next);
    } else {
      // Auto-pick the next recommended cell, then any available
      const recommended = data.matrix.flatMap(r => r.cells.filter(c => c.state === 'recommended'));
      const available = data.matrix.flatMap(r => r.cells.filter(c => c.state === 'available'));
      const ordered = [...recommended, ...available];
      const next = new Set(selected);
      for (const c of ordered) {
        if (next.size >= selected.size + delta) break;
        const k = cellKey(c.service, c.city);
        if (!next.has(k)) next.add(k);
      }
      setSelected(next);
    }
  }

  async function handleExpand() {
    if (!projectId || selected.size === 0) return;
    const pages = Array.from(selected).map(key => {
      const [service, city] = key.split('::');
      return { type: 'service-area', service, city };
    });
    setSubmitting(true);
    try {
      const res = await api.projects.expand(projectId, pages);
      setConfirmation({ count: res.created, minutes: res.estimatedMinutes });
      onExpanded();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Expand failed: ${msg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  const recommendedCount = useMemo(() => {
    if (!data) return 0;
    return data.matrix.flatMap(r => r.cells).filter(c => c.state === 'recommended').length;
  }, [data]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={handleClose} width={840}>
      <div style={{ position: 'relative' }}>
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', letterSpacing: '2px', color: 'var(--text)', lineHeight: 1 }}>
                {projectName.toUpperCase()}
              </div>
              {projectUrl && (
                <div style={{ fontSize: '0.65rem', color: 'var(--text3)', marginTop: 4, fontFamily: "'DM Mono', monospace" }}>
                  {projectUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </div>
              )}
            </div>
            <button className="mclose" onClick={handleClose} disabled={submitting}>✕</button>
          </div>
        </div>

        <div className="lm-tabs">
          <button type="button" className="lm-tab active">+ Add Pages</button>
          <button type="button" className="lm-tab" onClick={() => showToast('Edit existing pages via landingsite.ai', 'default')}>Edit Pages</button>
          <button type="button" className="lm-tab" onClick={() => showToast('Files reference will land in a future phase', 'default')}>Files</button>
        </div>

        <div style={{ padding: '18px 22px', maxHeight: '70vh', overflowY: 'auto' }}>
          {loading || !data ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)' }}>
              <Spinner /> Loading coverage…
            </div>
          ) : (
            <MatrixBody
              data={data}
              selected={selected}
              onToggle={toggleCell}
              onAdjust={adjustSelection}
              recommendedCount={recommendedCount}
            />
          )}
        </div>

        <div style={{ padding: '13px 22px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>
            {selected.size > 0
              ? `${selected.size} page${selected.size === 1 ? '' : 's'} selected · est. ${selected.size * 2} min`
              : 'Click cells to select pages to add'}
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <Button variant="ghost" size="sm" onClick={handleClose} disabled={submitting}>Cancel</Button>
            <Button
              variant="tier3"
              size="sm"
              disabled={selected.size === 0 || submitting}
              onClick={handleExpand}
            >
              {submitting ? <><Spinner /> Queueing…</> : `⚡ Expand Site (${selected.size})`}
            </Button>
          </div>
        </div>

        {confirmation && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(20,20,20,0.97)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', textAlign: 'center', padding: 30, zIndex: 5,
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'var(--tier3-bg)', color: 'var(--tier3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.8rem', marginBottom: 14,
              border: '2px solid rgba(167,139,250,0.3)',
            }}>✓</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', letterSpacing: '2px', color: 'var(--text)', marginBottom: 6 }}>
              Pages Queued
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 6, lineHeight: 1.6, maxWidth: 340 }}>
              {confirmation.count} page brief{confirmation.count === 1 ? '' : 's'} generated and handed off to Cowork.
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text3)', marginBottom: 18 }}>
              Estimated completion: ~{confirmation.minutes} minutes
            </div>
            <div style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 'var(--r)', padding: '10px 14px',
              fontSize: '0.65rem', color: 'var(--text3)',
              maxWidth: 380, lineHeight: 1.6, textAlign: 'left',
            }}>
              🤖 <strong style={{ color: 'var(--text2)' }}>Cowork will pick up each job in queue order</strong> and build pages sequentially in landingsite.ai. Track progress on the site card or in the Build tab queue strip.
            </div>
            <Button variant="tier3" size="sm" onClick={() => { setConfirmation(null); onClose(); }}>
              View Progress on Site Card
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

interface MatrixBodyProps {
  data: Matrix;
  selected: Set<CellKey>;
  onToggle: (service: string, city: string, state: Cell['state']) => void;
  onAdjust: (delta: number) => void;
  recommendedCount: number;
}

function MatrixBody({ data, selected, onToggle, onAdjust, recommendedCount }: MatrixBodyProps) {
  const { services, summary, matrix } = data;
  const selectedCount = selected.size;

  // Dynamic grid template: 160px label + N services columns
  const gridTemplate = `160px repeat(${services.length}, 1fr)`;

  return (
    <>
      {/* Coverage header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
            SEO Coverage
          </div>
          <div style={{ height: 6, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden', maxWidth: 380, marginBottom: 6 }}>
            <div style={{ width: `${summary.pct}%`, height: '100%', background: 'var(--tier3)', borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text2)' }}>
            {summary.built} of {summary.total} pages built — <span style={{ color: 'var(--accent)' }}>{summary.available} available to add</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.58rem', color: 'var(--text3)', marginBottom: 4, letterSpacing: '1px', textTransform: 'uppercase' }}>
            Add this month
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, justifyContent: 'flex-end' }}>
            <button
              onClick={() => onAdjust(-1)}
              disabled={selectedCount === 0}
              style={{
                width: 30, height: 30, background: 'var(--surface2)',
                border: '1px solid var(--border2)', borderRadius: 5,
                color: selectedCount === 0 ? 'var(--text3)' : 'var(--text2)',
                cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                fontSize: 14,
              }}
            >−</button>
            <span style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.9rem',
              color: 'var(--accent)', minWidth: 30, textAlign: 'center', lineHeight: 1,
            }}>
              {selectedCount}
            </span>
            <button
              onClick={() => onAdjust(1)}
              disabled={selectedCount >= summary.available}
              style={{
                width: 30, height: 30, background: 'var(--surface2)',
                border: '1px solid var(--border2)', borderRadius: 5,
                color: selectedCount >= summary.available ? 'var(--text3)' : 'var(--text2)',
                cursor: selectedCount >= summary.available ? 'not-allowed' : 'pointer',
                fontSize: 14,
              }}
            >+</button>
            <span style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>pages</span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, fontSize: '0.62rem', color: 'var(--text3)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase' }}>Service × Location Matrix</span>
        <LegendChip color="rgba(62,207,142,0.2)" border="rgba(62,207,142,0.4)" label="Built" />
        <LegendChip color="rgba(255,107,43,0.2)" border="rgba(255,107,43,0.5)" label="Selected" />
        <LegendChip color="rgba(167,139,250,0.15)" border="rgba(167,139,250,0.5)" label="Recommended" dashed />
        <LegendChip color="var(--surface3)" border="var(--border2)" label="Available" />
      </div>

      {/* Matrix grid */}
      <div className="matrix-grid">
        <div className="mhead-row" style={{ gridTemplateColumns: gridTemplate }}>
          <div className="mhead-empty" />
          {services.map(s => (
            <div key={s} className="mhead-cell">
              {s.split(' ').map((w, i) => <span key={i}>{i > 0 && <br />}{w}</span>)}
            </div>
          ))}
        </div>
        {matrix.map(row => (
          <div key={row.city} className="mrow" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="mcity">
              {row.city}
              {row.inReviews && <span className="mcity-tag">★ in reviews</span>}
            </div>
            {row.cells.map(cell => {
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

      {/* Recommendation note */}
      {recommendedCount > 0 && (
        <div style={{
          marginTop: 14, padding: '12px 14px',
          background: 'var(--tier3-bg)',
          border: '1px solid rgba(167,139,250,0.2)',
          borderRadius: 'var(--r)',
          fontSize: '0.72rem', color: 'var(--text2)', lineHeight: 1.6,
        }}>
          <strong style={{ color: 'var(--tier3)' }}>★ Smart recommendation:</strong>{' '}
          {recommendedCount} cell{recommendedCount === 1 ? '' : 's'} marked as recommended — those cities appear in customer reviews but have no service-area pages yet. Adding them helps the site rank where you already have proven customer activity.
        </div>
      )}
    </>
  );
}

function LegendChip({ color, border, label, dashed }: { color: string; border: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        width: 10, height: 10,
        background: color,
        border: `1px ${dashed ? 'dashed' : 'solid'} ${border}`,
        borderRadius: 2,
      }} />
      {label}
    </span>
  );
}
