import { useState, useEffect, useMemo, type ReactNode } from 'react';
import type { Brief, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

interface BriefEditorPanelProps {
  open: boolean;
  brief: Brief | null;
  onClose: () => void;
  showToast: ShowToast;
  /** Called after PATCH (TBD fill or manual edit). Parent should refresh dependent UI (matrix, brief list). */
  onChanged?: (updated: Brief) => void;
  /** Called after a page brief's status flips to 'complete'. */
  onPageCompleted?: (pageId: number) => void;
}

const TBD_PATTERN = /\[TBD:\s*([^\]]+)\]/gi;

/**
 * Right-side slide-in editor panel for master + page briefs.
 *
 * - Master variant: meta strip with version + last-updated + TBD count.
 * - Page variant: 3-step status bar (Planned → Briefed → Complete).
 *
 * Markdown is rendered with [TBD: <field>] tokens turned into clickable
 * yellow chips. Clicking a chip opens an inline input — saving PATCHes the
 * brief with the token replaced by the entered value. The server recounts
 * tbd_count, so the meta strip updates after each fill.
 *
 * Operators can also click "Edit" to swap the rendered markdown for a raw
 * textarea and save freeform changes.
 */
export function BriefEditorPanel({
  open, brief, onClose, showToast, onChanged, onPageCompleted,
}: BriefEditorPanelProps) {
  const [current, setCurrent] = useState<Brief | null>(brief);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  /** Local TBD chip state — keyed by occurrence index so duplicates can be filled independently. */
  const [activeChipIdx, setActiveChipIdx] = useState<number | null>(null);
  const [chipInput, setChipInput] = useState('');

  useEffect(() => {
    setCurrent(brief);
    setEditing(false);
    setDraft(brief?.content_markdown ?? '');
    setActiveChipIdx(null);
    setChipInput('');
  }, [brief?.id, brief?.version]);

  // Render-time cache of TBD positions so chip indices line up with the
  // ordered match list (used by handleFillChip to know which occurrence to replace).
  const tbdMatches = useMemo(() => {
    const md = current?.content_markdown ?? '';
    const out: Array<{ start: number; end: number; field: string }> = [];
    const re = new RegExp(TBD_PATTERN.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(md)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length, field: m[1].trim() });
    }
    return out;
  }, [current?.content_markdown]);

  if (!open || !current) return null;

  async function handleFillChip(idx: number, value: string) {
    if (!current) return;
    const v = value.trim();
    if (!v) {
      showToast('Enter a value to fill this TBD', 'error');
      return;
    }
    const md = current.content_markdown;
    const match = tbdMatches[idx];
    if (!match) return;
    const next = md.slice(0, match.start) + v + md.slice(match.end);
    setSaving(true);
    try {
      const updated = await api.briefs.updateContent(current.id, next);
      setCurrent(updated);
      setDraft(updated.content_markdown);
      setActiveChipIdx(null);
      setChipInput('');
      showToast(`Filled "${match.field}"`, 'success');
      onChanged?.(updated);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`TBD fill failed: ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdits() {
    if (!current) return;
    if (draft === current.content_markdown) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await api.briefs.updateContent(current.id, draft);
      setCurrent(updated);
      setEditing(false);
      showToast('Brief saved', 'success');
      onChanged?.(updated);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Save failed: ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.content_markdown);
      showToast('Brief copied — paste into landingsite.ai', 'success');
    } catch {
      showToast('Could not access clipboard', 'error');
    }
  }

  async function handleRegenerate() {
    if (!current || current.kind !== 'master') return;
    const ok = window.confirm(
      'Regenerate this master brief?\n\n'
        + 'Claude will rewrite it from scratch using the current project data (~30–60s). '
        + 'Manual edits and TBD fills on this version will be lost — the existing brief is archived '
        + 'as a previous version, not deleted.'
    );
    if (!ok) return;

    setRegenerating(true);
    try {
      const next = await api.briefs.regenerateMaster(current.project_id);
      setCurrent(next);
      setDraft(next.content_markdown);
      setEditing(false);
      setActiveChipIdx(null);
      setChipInput('');
      showToast(`Master brief regenerated (v${next.version})`, 'success');
      onChanged?.(next);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Regenerate failed: ${msg}`, 'error');
    } finally {
      setRegenerating(false);
    }
  }

  async function handleMarkComplete() {
    if (!current || current.kind !== 'page' || current.page_id == null) return;
    setCompleting(true);
    try {
      await api.pages.setStatus(current.page_id, 'complete');
      showToast('Marked complete', 'success');
      onPageCompleted?.(current.page_id);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Mark complete failed: ${msg}`, 'error');
    } finally {
      setCompleting(false);
    }
  }

  const title = current.kind === 'master' ? 'Master Brief' : 'Page Brief';

  return (
    <>
      <div className="bs-editor-backdrop" onClick={regenerating ? undefined : onClose} />
      <aside className="bs-editor-panel" role="dialog" aria-label={title}>
        <div className="bs-editor-header">
          <div>
            <div className="bs-editor-title">{title}</div>
            <div className="bs-editor-sub">
              {current.generated_by_model ?? 'unknown model'} ·{' '}
              {fmtTime(current.updated_at ?? current.generated_at)}
              {regenerating && (
                <span style={{ marginLeft: 8, color: 'var(--yellow)' }}>· regenerating…</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="bs-editor-close"
            onClick={onClose}
            aria-label="Close"
            disabled={regenerating}
            title={regenerating ? 'Wait for regenerate to finish' : 'Close'}
          >✕</button>
        </div>

        {current.kind === 'master' ? (
          <MasterMetaStrip brief={current} />
        ) : (
          <PageStatusBar status={current.status} />
        )}

        <div className="bs-editor-body">
          {editing ? (
            <textarea
              className="bs-editor-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
          ) : (
            <BriefMarkdownInteractive
              markdown={current.content_markdown}
              activeChipIdx={activeChipIdx}
              chipInput={chipInput}
              saving={saving}
              onChipOpen={(idx, field) => { setActiveChipIdx(idx); setChipInput(field); }}
              onChipChange={setChipInput}
              onChipSave={(idx) => handleFillChip(idx, chipInput)}
              onChipCancel={() => { setActiveChipIdx(null); setChipInput(''); }}
            />
          )}
        </div>

        <div className="bs-editor-footer">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" disabled={saving || regenerating} onClick={() => { setEditing(false); setDraft(current.content_markdown); }}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" disabled={saving || regenerating} onClick={handleSaveEdits}>
                {saving ? <><Spinner /> Saving…</> : 'Save edits'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" disabled={regenerating} onClick={() => setEditing(true)}>✎ Edit</Button>
              <Button variant="ghost" size="sm" disabled={regenerating} onClick={handleCopy}>📋 Copy</Button>
              {current.kind === 'master' && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={regenerating || saving}
                  onClick={handleRegenerate}
                  title="Rewrite this master brief from scratch using the current project data"
                >
                  {regenerating ? <><Spinner /> Regenerating…</> : '↻ Regenerate'}
                </Button>
              )}
              {current.kind === 'page' && current.status === 'briefed' && (
                <Button variant="primary" size="sm" disabled={completing} onClick={handleMarkComplete}>
                  {completing ? <><Spinner /> Marking…</> : '✓ Mark complete'}
                </Button>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

// ============================================================================
// Master meta strip
// ============================================================================

function MasterMetaStrip({ brief }: { brief: Brief }) {
  return (
    <div className="bs-editor-meta-strip">
      <span className="bs-master-chip">v{brief.version}</span>
      <span className="bs-editor-meta-text">Updated {fmtRelative(brief.updated_at ?? brief.generated_at)}</span>
      {brief.tbd_count > 0 ? (
        <span className="bs-master-tbd">⚠ {brief.tbd_count} TBD{brief.tbd_count === 1 ? '' : 's'} remaining</span>
      ) : (
        <span className="bs-master-ok">✓ no TBDs</span>
      )}
    </div>
  );
}

// ============================================================================
// Page status bar — 3 steps: Planned → Briefed → Complete
// ============================================================================

function PageStatusBar({ status }: { status: string }) {
  const order: Array<{ key: string; label: string }> = [
    { key: 'planned', label: 'Planned' },
    { key: 'briefed', label: 'Briefed' },
    { key: 'complete', label: 'Complete' },
  ];
  const activeIdx = Math.max(0, order.findIndex((s) => s.key === status));
  return (
    <div className="bs-status-bar">
      {order.map((s, i) => (
        <span key={s.key} className={`bs-status-step ${i <= activeIdx ? 'active' : ''} ${i === activeIdx ? 'current' : ''}`}>
          <span className="bs-status-dot" />
          {s.label}
          {i < order.length - 1 && <span className="bs-status-arrow">→</span>}
        </span>
      ))}
    </div>
  );
}

// ============================================================================
// Interactive markdown with clickable TBD chips
// ============================================================================

interface InteractiveProps {
  markdown: string;
  activeChipIdx: number | null;
  chipInput: string;
  saving: boolean;
  onChipOpen: (idx: number, field: string) => void;
  onChipChange: (v: string) => void;
  onChipSave: (idx: number) => void;
  onChipCancel: () => void;
}

function BriefMarkdownInteractive({
  markdown, activeChipIdx, chipInput, saving,
  onChipOpen, onChipChange, onChipSave, onChipCancel,
}: InteractiveProps) {
  // Single global counter so chip indices match the regex match positions
  // in handleFillChip (tbdMatches array is built off the same regex).
  let chipIdx = -1;

  const lines = markdown.split('\n');
  const out: ReactNode[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    if (line.startsWith('# ')) {
      out.push(<div key={`l-${li}`} className="brief-h1">{line.slice(2)}</div>);
      continue;
    }
    if (line.startsWith('## ')) {
      out.push(<div key={`l-${li}`} className="brief-h2">{line}</div>);
      continue;
    }
    if (line.startsWith('### ')) {
      out.push(<div key={`l-${li}`} className="brief-h3">{line}</div>);
      continue;
    }
    if (line.startsWith('---')) {
      out.push(<div key={`l-${li}`} className="brief-divider" />);
      continue;
    }

    // Walk the line splitting on TBD tokens
    const parts: ReactNode[] = [];
    const re = new RegExp(TBD_PATTERN.source, 'gi');
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      chipIdx++;
      if (m.index > cursor) {
        parts.push(<TextSegment key={`s-${li}-${cursor}`} text={line.slice(cursor, m.index)} />);
      }
      const idx = chipIdx;
      const field = m[1].trim();
      parts.push(
        <TbdChip
          key={`t-${li}-${idx}`}
          field={field}
          active={activeChipIdx === idx}
          inputValue={chipInput}
          saving={saving}
          onOpen={() => onChipOpen(idx, field)}
          onChange={onChipChange}
          onSave={() => onChipSave(idx)}
          onCancel={onChipCancel}
        />
      );
      cursor = m.index + m[0].length;
    }
    if (cursor < line.length) {
      parts.push(<TextSegment key={`s-${li}-end`} text={line.slice(cursor)} />);
    }
    if (parts.length === 0) parts.push(<TextSegment key={`s-${li}-empty`} text="" />);

    out.push(<div key={`l-${li}`} className="brief-line">{parts}</div>);
  }

  return <div className="brief-editor">{out}</div>;
}

function TextSegment({ text }: { text: string }) {
  // Render plain text with **bold** support, as the existing BriefMarkdown does.
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="brief-md-strong">$1</strong>');
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function TbdChip({
  field, active, inputValue, saving, onOpen, onChange, onSave, onCancel,
}: {
  field: string;
  active: boolean;
  inputValue: string;
  saving: boolean;
  onOpen: () => void;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (!active) {
    return (
      <button type="button" className="bs-tbd-chip" onClick={onOpen} title="Click to fill">
        ⚠ {field}
      </button>
    );
  }
  return (
    <span className="bs-tbd-chip-edit">
      <input
        autoFocus
        value={inputValue}
        onChange={(e) => onChange(e.target.value === field ? '' : e.target.value)}
        placeholder={field}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onSave(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
      />
      <button type="button" className="bs-tbd-save" disabled={saving} onClick={onSave}>
        {saving ? '…' : '✓'}
      </button>
      <button type="button" className="bs-tbd-cancel" onClick={onCancel}>✕</button>
    </span>
  );
}

// ============================================================================
// Time helpers
// ============================================================================

function parseTs(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

function fmtTime(ts: string | null | undefined): string {
  const d = parseTs(ts);
  if (!d) return 'unknown';
  return d.toLocaleString();
}

function fmtRelative(ts: string | null | undefined): string {
  const d = parseTs(ts);
  if (!d) return 'never';
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
