import { useEffect, useState } from 'react';
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
  /** Kept for source compat; v2.1 view-only matrix never invokes this. */
  onExpanded?: () => void;
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

/**
 * v2.1 view-only coverage matrix.
 *
 * In v2.0 this modal had a "+ Add Pages" action that wrote `brief_jobs` rows
 * and queued them for Cowork. That flow is gone — page creation now happens
 * through the Briefs tab's Monthly Batch modal, which generates an actual
 * brief and ties pages to it. This modal stays as a quick visual reference
 * for SEO coverage from the Site Detail page.
 */
export function MatrixModal({
  open, projectId, projectName, projectUrl, onClose, showToast,
}: MatrixModalProps) {
  const [data, setData] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || projectId == null) {
      setData(null);
      return;
    }
    setLoading(true);
    api.projects.coverage(projectId)
      .then((res) => setData(res))
      .catch((err) => {
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        showToast(`Coverage load failed: ${msg}`, 'error');
        onClose();
      })
      .finally(() => setLoading(false));
  }, [open, projectId, showToast, onClose]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} width={840}>
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
            <div style={{ fontSize: '0.62rem', color: 'var(--text3)', marginTop: 6 }}>
              SEO coverage matrix · view only — generate new pages from the Briefs tab’s Monthly Batch flow.
            </div>
          </div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
      </div>

      <div style={{ padding: '18px 22px', maxHeight: '70vh', overflowY: 'auto' }}>
        {loading || !data ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)' }}>
            <Spinner /> Loading coverage…
          </div>
        ) : (
          <MatrixView data={data} />
        )}
      </div>

      <div style={{ padding: '13px 22px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

function MatrixView({ data }: { data: Matrix }) {
  const { services, summary, matrix } = data;
  const gridTemplate = `160px repeat(${services.length}, 1fr)`;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
            SEO Coverage
          </div>
          <div style={{ height: 6, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden', maxWidth: 380, marginBottom: 6 }}>
            <div style={{ width: `${summary.pct}%`, height: '100%', background: 'var(--tier3)', borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text2)' }}>
            {summary.built} of {summary.total} pages built — <span style={{ color: 'var(--accent)' }}>{summary.available} still to add</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, fontSize: '0.62rem', color: 'var(--text3)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase' }}>Service × Location</span>
        <LegendChip color="rgba(62,207,142,0.2)" border="rgba(62,207,142,0.4)" label="Built" />
        <LegendChip color="rgba(167,139,250,0.15)" border="rgba(167,139,250,0.5)" label="Recommended" dashed />
        <LegendChip color="var(--surface3)" border="var(--border2)" label="Available" />
      </div>

      <div className="matrix-grid">
        <div className="mhead-row" style={{ gridTemplateColumns: gridTemplate }}>
          <div className="mhead-empty" />
          {services.map((s) => (
            <div key={s} className="mhead-cell">
              {s.split(' ').map((w, i) => <span key={i}>{i > 0 && <br />}{w}</span>)}
            </div>
          ))}
        </div>
        {matrix.map((row) => (
          <div key={row.city} className="mrow" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="mcity">
              {row.city}
              {row.inReviews && <span className="mcity-tag">★ in reviews</span>}
            </div>
            {row.cells.map((cell) => {
              const label = cell.state === 'built' ? '✓'
                : cell.state === 'building' ? '⚙'
                : cell.state === 'queued' ? '⏳'
                : '·';
              return (
                <div
                  key={`${row.city}-${cell.service}`}
                  className={`mcell ${cell.state}`}
                  style={{ cursor: 'default' }}
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
