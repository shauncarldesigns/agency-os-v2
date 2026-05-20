import { useState, useRef } from 'react';
import type { ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Badge } from '../shared/Badge';

interface ImportCsvModalProps {
  open: boolean;
  onClose: () => void;
  showToast: ShowToast;
  onImported: () => void;
}

interface ParsedPreview {
  rowCount: number;
  headers: string[];
  recognized: Record<string, boolean>;
  raw: string;
}

const KNOWN_HEADERS = ['company', 'contact', 'phone', 'email', 'industry', 'city', 'state', 'address', 'website', 'place_id', 'notes'];

export function ImportCsvModal({ open, onClose, showToast, onImported }: ImportCsvModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  function reset() {
    setPreview(null);
    setImporting(false);
    setDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    if (importing) return;
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      showToast('File must be a .csv', 'error');
      return;
    }
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      showToast('CSV needs a header row + at least one data row', 'error');
      return;
    }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    const recognized: Record<string, boolean> = {};
    for (const h of headers) recognized[h] = KNOWN_HEADERS.includes(h);
    setPreview({ rowCount: lines.length - 1, headers, recognized, raw: text });
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const result = await api.leads.importCsv(preview.raw);
      const msg = `${result.imported} imported · ${result.skipped} skipped`;
      showToast(msg, result.imported > 0 ? 'success' : 'default');
      onImported();
      reset();
      onClose();
    } catch (err) {
      const m = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Import failed: ${m}`, 'error');
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={handleClose} width={560}>
      <div style={{ padding: '20px 22px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', letterSpacing: '2px' }}>Import Leads from CSV</div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text3)', marginTop: 2 }}>Header row required · Auto-detects column names</div>
        </div>
        <button className="mclose" onClick={handleClose} disabled={importing}>✕</button>
      </div>

      <div style={{ padding: '18px 22px' }}>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          style={{
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border2)'}`,
            background: dragOver ? 'var(--accent-dim)' : 'transparent',
            borderRadius: 'var(--rl)',
            padding: 24,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.14s',
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: '1.6rem', marginBottom: 8, opacity: 0.4 }}>📁</div>
          <div style={{ fontSize: '0.86rem', color: 'var(--text2)', fontWeight: 500, marginBottom: 3 }}>
            {preview ? 'Replace file' : 'Drop your CSV here or click to upload'}
          </div>
          <div style={{ fontSize: '0.66rem', color: 'var(--text3)' }}>Up to 1,000 leads · Auto-detects column names</div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>

        {preview && (
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: '0.62rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)' }}>
                Detected · {preview.rowCount} rows
              </div>
              <Badge color="green">✓ Format recognized</Badge>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', fontSize: '0.7rem' }}>
              {preview.headers.map(h => {
                const ok = preview.recognized[h];
                return (
                  <div key={h} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: '3px 0' }}>
                    <span style={{ color: 'var(--text3)' }}>{h}</span>
                    <span style={{ color: ok ? 'var(--green)' : 'var(--text3)' }}>
                      {ok ? `→ ${h} ✓` : '↘ ignored'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '13px 22px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>⚠ Duplicates checked by company + phone (or place_id)</div>
        <div style={{ display: 'flex', gap: 7 }}>
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={importing}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={!preview || importing} onClick={handleImport}>
            {importing ? '⏳ Importing…' : preview ? `↑ Import ${preview.rowCount} Leads` : '↑ Import'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
