import { useState, useEffect } from 'react';
import type { Lead, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Modal, ModalHeader } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { BriefMarkdown } from '../briefs/BriefMarkdown';

interface HomepageDemoModalProps {
  open: boolean;
  lead: Lead | null;
  onClose: () => void;
  showToast: ShowToast;
}

/**
 * Ephemeral homepage demo brief generator.
 *
 * Opens from the Pipeline tab on qualified leads. Generates a homepage-only
 * brief from the lead's mined data — pre-signing, no project yet, brief is
 * NOT persisted. Operator copies and pastes into landingsite.ai to build a
 * demo homepage they'll show on the next call.
 */
export function HomepageDemoModal({ open, lead, onClose, showToast }: HomepageDemoModalProps) {
  const [loading, setLoading] = useState(false);
  const [markdown, setMarkdown] = useState<string>('');
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !lead) {
      setMarkdown('');
      setGeneratedAt(null);
      setModel(null);
      return;
    }
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.id]);

  async function run() {
    if (!lead) return;
    setLoading(true);
    try {
      const res = await api.leads.generateHomepageDemo(lead.id);
      setMarkdown(res.markdown);
      setGeneratedAt(res.generatedAt);
      setModel(res.model);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Demo generation failed: ${msg}`, 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      showToast('Demo brief copied — paste into landingsite.ai', 'success');
    } catch {
      showToast('Could not access clipboard', 'error');
    }
  }

  if (!open || !lead) return null;

  return (
    <Modal open={open} onClose={loading ? () => undefined : onClose} width={820}>
      <ModalHeader title={`Homepage Demo — ${lead.company}`} onClose={loading ? () => undefined : onClose}>
        <span style={{ fontSize: '0.62rem', color: 'var(--text3)', marginLeft: 10 }}>
          Ephemeral · not persisted
        </span>
      </ModalHeader>

      <div style={{ padding: 18, maxHeight: '65vh', overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: '0.78rem' }}>
            <Spinner /> Generating homepage demo brief… (~30–60s)
          </div>
        ) : markdown ? (
          <BriefMarkdown markdown={markdown} />
        ) : (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>No brief yet.</div>
        )}
      </div>

      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.62rem', color: 'var(--text3)' }}>
          {model && generatedAt ? `${model} · ${new Date(generatedAt).toLocaleString()}` : 'Generating…'}
        </span>
        <div style={{ display: 'flex', gap: 7 }}>
          <Button variant="ghost" size="sm" disabled={loading} onClick={run}>
            ↻ Regenerate
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          <Button variant="primary" size="sm" disabled={!markdown} onClick={handleCopy}>
            📋 Copy markdown
          </Button>
        </div>
      </div>
    </Modal>
  );
}
