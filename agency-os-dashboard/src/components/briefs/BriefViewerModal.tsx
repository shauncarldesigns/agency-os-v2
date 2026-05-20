import { useState } from 'react';
import type { Brief, ShowToast } from '../../lib/types';
import { Modal, ModalHeader } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { BriefMarkdown } from './BriefMarkdown';
import { api, ApiError } from '../../lib/api';

interface BriefViewerModalProps {
  open: boolean;
  onClose: () => void;
  brief: Brief | null;
  showToast: ShowToast;
  onRegenerated?: (newBrief: Brief) => void;
}

const KIND_LABELS: Record<string, string> = {
  homepage_demo: 'Homepage Demo Brief',
  master: 'Master Brief',
  monthly_batch: 'Monthly Batch Brief',
};

export function BriefViewerModal({ open, onClose, brief, showToast, onRegenerated }: BriefViewerModalProps) {
  const [regenerating, setRegenerating] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  async function handleCopy() {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief.content_markdown);
      showToast('Brief copied — paste into landingsite.ai or Cowork', 'success');
    } catch {
      showToast('Could not access clipboard', 'error');
    }
  }

  async function handleRegenerate() {
    if (!brief) return;
    setRegenerating(true);
    try {
      const newBrief = await api.briefs.regenerate(brief.id, feedback.trim() || undefined);
      showToast('Brief regenerated — old version archived', 'success');
      setFeedback('');
      setShowFeedback(false);
      onRegenerated?.(newBrief);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Regenerate failed: ${msg}`, 'error');
    } finally {
      setRegenerating(false);
    }
  }

  if (!brief) return null;
  const title = KIND_LABELS[brief.kind] ?? 'Brief';
  const canRegenerate = brief.kind === 'homepage_demo' || brief.kind === 'master';

  return (
    <Modal open={open} onClose={onClose} width={860}>
      <ModalHeader title={title} onClose={onClose}>
        <span style={{ fontSize: '0.62rem', color: 'var(--text3)', marginLeft: 10 }}>
          {brief.generated_by_model ?? 'unknown model'} · {brief.generated_at}
        </span>
      </ModalHeader>

      <div style={{ padding: 18, maxHeight: '60vh', overflowY: 'auto' }}>
        <BriefMarkdown markdown={brief.content_markdown} />
      </div>

      {showFeedback && (
        <div style={{ padding: '0 18px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--text3)', margin: '14px 0 6px' }}>
            Feedback for regeneration (optional)
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Make the brand voice descriptors sharper — fewer adjectives, more specifics."
            rows={3}
            style={{
              width: '100%',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r)',
              padding: 10,
              color: 'var(--text)',
              fontSize: '0.74rem',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </div>
      )}

      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 7, justifyContent: 'flex-end', alignItems: 'center' }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--text3)', marginRight: 'auto' }}>
          {brief.content_markdown.length.toLocaleString()} chars · status: <strong style={{ color: 'var(--text2)' }}>{brief.status}</strong>
        </span>
        {canRegenerate && !showFeedback && (
          <Button variant="ghost" size="sm" disabled={regenerating} onClick={() => setShowFeedback(true)}>
            ↻ Regenerate…
          </Button>
        )}
        {canRegenerate && showFeedback && (
          <>
            <Button variant="ghost" size="sm" onClick={() => { setShowFeedback(false); setFeedback(''); }}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={regenerating} onClick={handleRegenerate}>
              {regenerating ? <><Spinner /> Regenerating…</> : 'Regenerate brief'}
            </Button>
          </>
        )}
        <Button variant="primary" size="sm" onClick={handleCopy}>
          📋 Copy markdown
        </Button>
      </div>
    </Modal>
  );
}
