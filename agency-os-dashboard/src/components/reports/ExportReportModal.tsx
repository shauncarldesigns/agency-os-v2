import { useState, useEffect } from 'react';
import type { ReportSummary, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Modal } from '../shared/Modal';
import { Spinner } from '../shared/Spinner';
import { Download, FileText, Mail, X } from 'lucide-react';

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
      <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><FileText className="h-5 w-5" /></span>
          <div className="min-w-0"><h2 className="text-base font-semibold text-slate-900">Export client report</h2><p className="mt-0.5 truncate text-xs text-slate-500">{summary.project.name} · {formatPeriodLabel(summary.period)} · Tier {summary.project.tier}</p></div>
        </div>
        <button type="button" aria-label="Close export report" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" onClick={onClose}><X className="h-4 w-4" /></button>
      </div>

      <div className="px-5 py-4">
        <div className="mb-3 text-xs font-semibold text-slate-700">Include in report</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ALL_SECTIONS.map(s => (
            <label
              key={s.key}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
            >
              <input
                type="checkbox"
                checked={sections.has(s.key)}
                onChange={() => toggleSection(s.key)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div className="border-y border-slate-100 bg-slate-50 px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold text-slate-700">PDF preview</div>
          <div className="text-[11px] text-slate-400">
            {loadingPreview ? 'Rendering…' : 'Live preview'}
          </div>
        </div>
        <div className="max-h-[340px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          {loadingPreview ? (
            <div className="flex min-h-[220px] items-center justify-center gap-2 text-sm text-slate-400"><Spinner /> Loading preview…</div>
          ) : previewHtml ? (
            <iframe
              title="Report preview"
              srcDoc={previewHtml}
              style={{ width: '100%', height: 340, border: 'none', display: 'block', background: '#fff' }}
            />
          ) : (
            <div className="flex min-h-[220px] items-center justify-center text-sm text-slate-400">No preview yet</div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-slate-500">
          {summary.project.client_email
            ? <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{summary.project.client_email}</span>
            : <em>No client email on file</em>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={onClose}>Cancel</button>
          <button type="button" className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={!previewHtml || downloading} onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" /> {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={!previewHtml || emailing || !summary.project.client_email}
            onClick={handleEmail}
          >
            {emailing ? <><Spinner /> Sending…</> : <><Mail className="h-3.5 w-3.5" /> Email client</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
