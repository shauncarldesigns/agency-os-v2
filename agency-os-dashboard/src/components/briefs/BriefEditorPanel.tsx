import { useState, useEffect, type ReactNode } from 'react';
import type { Brief, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

interface BriefEditorPanelProps {
  open: boolean;
  brief: Brief | null;
  onClose: () => void;
  showToast: ShowToast;
  /** Called after PATCH (raw markdown edit). Parent refreshes dependent UI
   *  (matrix, brief list). */
  onChanged?: (updated: Brief) => void;
  /** Called after a page brief's status flips to 'complete'. */
  onPageCompleted?: (pageId: number) => void;
}

const TBD_PATTERN = /\[TBD:\s*([^\]]+)\]/gi;

/**
 * Right-side slide-in editor panel for master + page briefs.
 *
 * - Master variant: meta strip with version + last-updated + TBD count,
 *   plus a Regenerate button.
 * - Page variant: 3-step status bar (Planned → Briefed → Complete) and a
 *   Mark complete action when status='briefed'.
 *
 * Markdown is rendered with `[TBD: <field>]` tokens highlighted as inline
 * yellow text so the operator can see what's unfilled — but they are NOT
 * clickable. The fix path for TBDs is now: open the project editor modal
 * via Edit Project Info, fill in the underlying project field, then
 * Save & Regenerate. The Edit button still drops to a raw markdown
 * textarea for manual one-off edits.
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

  useEffect(() => {
    setCurrent(brief);
    setEditing(false);
    setDraft(brief?.content_markdown ?? '');
  }, [brief?.id, brief?.version]);

  if (!open || !current) return null;

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
        + 'Manual edits on this version will be lost — the existing brief is archived '
        + 'as a prior version, not deleted.'
    );
    if (!ok) return;

    setRegenerating(true);
    try {
      const next = await api.briefs.regenerateMaster(current.project_id);
      setCurrent(next);
      setDraft(next.content_markdown);
      setEditing(false);
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
            <BriefMarkdownReadOnly markdown={current.content_markdown} />
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
        <span className="bs-master-tbd">⚠ {brief.tbd_count} TBD{brief.tbd_count === 1 ? '' : 's'} — fill in Edit Project Info, then Regenerate</span>
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
// Read-only markdown render with TBD tokens highlighted (not interactive)
// ============================================================================

function BriefMarkdownReadOnly({ markdown }: { markdown: string }) {
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
    out.push(<div key={`l-${li}`} className="brief-line">{renderLine(line, li)}</div>);
  }

  return <div className="brief-editor">{out}</div>;
}

/** Walk a single line, emitting plain text segments and TBD highlights. */
function renderLine(line: string, lineKey: number): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = new RegExp(TBD_PATTERN.source, 'gi');
  let cursor = 0;
  let m: RegExpExecArray | null;
  let tokenIdx = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > cursor) {
      parts.push(<TextSegment key={`s-${lineKey}-${cursor}`} text={line.slice(cursor, m.index)} />);
    }
    parts.push(
      <span
        key={`t-${lineKey}-${tokenIdx++}`}
        className="bs-tbd-readonly"
        title="Fill the underlying field in Edit Project Info, then regenerate the brief"
        style={{
          display: 'inline-block',
          padding: '0 6px',
          margin: '0 2px',
          fontSize: '0.85em',
          color: 'var(--yellow)',
          background: 'rgba(245,200,66,0.08)',
          border: '1px solid rgba(245,200,66,0.3)',
          borderRadius: 6,
          fontWeight: 600,
        }}
      >
        ⚠ {m[1].trim()}
      </span>
    );
    cursor = m.index + m[0].length;
  }
  if (cursor < line.length) {
    parts.push(<TextSegment key={`s-${lineKey}-end`} text={line.slice(cursor)} />);
  }
  if (parts.length === 0) parts.push(<TextSegment key={`s-${lineKey}-empty`} text="" />);
  return parts;
}

function TextSegment({ text }: { text: string }) {
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="brief-md-strong">$1</strong>');
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
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
