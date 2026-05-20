import { useState, useEffect } from 'react';
import type { ReportSummary, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { TierPill } from '../shared/TierPill';
import { Spinner } from '../shared/Spinner';

interface ExportReportModalProps {
  open: boolean;
  summary: ReportSummary | null;
  onClose: () => void;
  showToast: ShowToast;
}

const ALL_SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'summary', label: 'Executive summary' },
  { key: 'mom', label: 'Month-over-month stats' },
  { key: 'keywords', label: 'Keyword wins & movement' },
  { key: 'pages-built', label: 'Pages built this month' },
  { key: 'health', label: 'Site health metrics' },
  { key: 'next-month', label: 'Next month plan' },
];

function formatPeriodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

export function ExportReportModal({ open, summary, onClose, showToast }: ExportReportModalProps) {
  const [sections, setSections] = useState<Set<string>>(new Set(ALL_SECTIONS.map(s => s.key)));
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open || !summary) {
      setPreviewHtml(null);
      return;
    }
    void loadPreview();
  }, [open, summary?.project.id, summary?.period]);

  // Re-fetch preview when section toggles change
  useEffect(() => {
    if (!open || !summary) return;
    void loadPreview();
  }, [Array.from(sections).sort().join(',')]);

  async function loadPreview() {
    if (!summary) return;
    setLoadingPreview(true);
    try {
      const html = await api.reports.exportHtml(summary.project.id, summary.period, Array.from(sections));
      setPreviewHtml(html);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Preview failed: ${msg}`, 'error');
    } finally {
      setLoadingPreview(false);
    }
  }

  function toggleSection(key: string) {
    setSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleDownload() {
    if (!previewHtml || !summary) return;
    setDownloading(true);
    try {
      // Open in a new window and trigger native print dialog → user picks "Save as PDF"
      const win = window.open('', '_blank', 'width=900,height=1100');
      if (!win) {
        showToast('Pop-up blocked — allow pop-ups and try again', 'error');
        return;
      }
      win.document.open();
      win.document.write(previewHtml);
      win.document.close();
      // Give the browser a beat to load fonts
      win.setTimeout(() => { win.focus(); win.print(); }, 600);
      showToast('Use the print dialog to "Save as PDF"', 'success');
    } finally {
      setDownloading(false);
    }
  }

  async function handleEmail() {
    if (!summary) return;
    if (!summary.project.client_email) {
      showToast('No client_email on file — set it on the project first', 'error');
      return;
    }
    setEmailing(true);
    try {
      const res = await api.reports.email(summary.project.id, {
        period: summary.period,
        sections: Array.from(sections),
      });
      showToast(`Sent to ${res.to}`, 'success');
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Email failed: ${msg}`, 'error');
    } finally {
      setEmailing(false);
    }
  }

  if (!open || !summary) return null;

  return (
    <Modal open={open} onClose={onClose} width={580}>
      <div style={{ padding: '20px 22px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', letterSpacing: '2px' }}>Export Client Report</div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            {summary.project.name} · {formatPeriodLabel(summary.period)}
            <TierPill tier={summary.project.tier} />
          </div>
        </div>
        <button className="mclose" onClick={onClose}>✕</button>
      </div>

      <div style={{ padding: '14px 22px 4px' }}>
        <div style={{ fontSize: '0.62rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8 }}>
          Include in Report
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginBottom: 14 }}>
          {ALL_SECTIONS.map(s => (
            <label
              key={s.key}
              style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.72rem', color: 'var(--text2)', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={sections.has(s.key)}
                onChange={() => toggleSection(s.key)}
                style={{ accentColor: 'var(--tier3)' }}
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 22px', background: 'var(--surface2)' }}>
        <div style={{ padding: '14px 0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)' }}>
            PDF Preview
          </div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text3)' }}>
            {loadingPreview ? 'Rendering…' : 'Live preview'}
          </div>
        </div>
        <div style={{ marginBottom: 14, maxHeight: 340, overflowY: 'auto', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', background: '#fff' }}>
          {loadingPreview ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#888' }}><Spinner /> Loading preview…</div>
          ) : previewHtml ? (
            <iframe
              title="Report preview"
              srcDoc={previewHtml}
              style={{ width: '100%', height: 340, border: 'none', display: 'block', background: '#fff' }}
            />
          ) : (
            <div style={{ padding: 60, textAlign: 'center', color: '#888' }}>No preview yet</div>
          )}
        </div>
      </div>

      <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>
          {summary.project.client_email
            ? <>📧 {summary.project.client_email}</>
            : <em>No client email on file</em>}
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="ghost" size="sm" disabled={!previewHtml || downloading} onClick={handleDownload}>
            {downloading ? '⏳ …' : '↓ Download PDF'}
          </Button>
          <Button
            variant="tier3"
            size="sm"
            disabled={!previewHtml || emailing || !summary.project.client_email}
            onClick={handleEmail}
          >
            {emailing ? <><Spinner /> Sending…</> : '📧 Email to Client'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
