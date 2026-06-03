import { useMemo, useState } from 'react';
import type { Project, Lead, ShowToast } from '../../lib/types';
import { Modal, ModalHeader, ModalFooter } from '../shared/Modal';
import { Button } from '../shared/Button';

interface QuickBriefModalProps {
  open: boolean;
  project: Project | null;
  /** Fresh lead row if available — has the most up-to-date reviews after any
   *  re-enrichment. Falls back to project.reviews_snapshot if not provided. */
  lead: Lead | null;
  onClose: () => void;
  showToast: ShowToast;
}

interface ParsedReview {
  author: string;
  rating: number | null;
  text: string;
  relativeTime: string;
  publishTime: string;
}

/**
 * Quick brief modal.
 *
 * Shows the bare minimum landingsite.ai needs to generate a decent demo
 * site from a cold prospect: business name + the Google reviews verbatim.
 * No Claude synthesis, no operator-supplied positioning, no opportunity
 * for platform-default fluff — just the raw signal landingsite needs.
 *
 * Used between qualification and the full master brief. Operator copies
 * the text, pastes into landingsite for a same-day demo to show on the
 * sales call. Master brief / page briefs come after the deal closes.
 *
 * This replaces the pre-PR-#17 "Generate Homepage Demo" feature, but in
 * a saner form — manual trigger only, no auto-project-spawn, and no
 * agency-side Claude call that could itself produce the fluff we're
 * trying to avoid.
 */
export function QuickBriefModal({
  open, project, lead, onClose, showToast,
}: QuickBriefModalProps) {
  const [copied, setCopied] = useState(false);

  const content = useMemo(() => {
    if (!project) return '';
    return formatQuickBrief(project, lead);
  }, [project, lead]);

  if (!open || !project) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      showToast('Quick brief copied — paste into landingsite.ai', 'success');
      // Visual ✓ Copied confirmation for 2s, then back to default.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not access clipboard — select the text and copy manually', 'error');
    }
  }

  const reviewCount = parseReviews(lead?.google_reviews ?? project.reviews_snapshot).length;

  return (
    <Modal open={open} onClose={onClose} width={640}>
      <ModalHeader title={`Quick Brief — ${project.business_name}`} onClose={onClose} />

      <div style={{ padding: 18 }}>
        <p style={{ fontSize: '0.74rem', color: 'var(--text2)', marginBottom: 14, lineHeight: 1.5 }}>
          Business name + {reviewCount} Google review{reviewCount === 1 ? '' : 's'} verbatim.
          Paste into landingsite.ai for a same-day demo. The full master brief comes after
          you've talked to them — this gets you something on screen before the call.
        </p>

        <textarea
          value={content}
          readOnly
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: 320,
            maxHeight: '50vh',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r)',
            padding: '10px 12px',
            color: 'var(--text2)',
            fontSize: '0.74rem',
            fontFamily: "'DM Mono', monospace",
            lineHeight: 1.55,
            resize: 'vertical',
            whiteSpace: 'pre-wrap',
          }}
        />

        {reviewCount === 0 && (
          <div style={{
            marginTop: 10,
            padding: '8px 12px',
            background: 'rgba(245,200,66,0.06)',
            border: '1px solid rgba(245,200,66,0.2)',
            borderRadius: 8,
            fontSize: '0.7rem',
            color: 'var(--text2)',
          }}>
            <strong style={{ color: 'var(--yellow)' }}>Heads up:</strong> no reviews on file for
            this project. The quick brief just has the business name — landingsite will produce
            something generic. Re-enrich the lead in the Pipeline to pull reviews first if you can.
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        <Button variant="primary" size="sm" onClick={handleCopy}>
          {copied ? '✓ Copied' : '📋 Copy'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ============================================================================
// Formatting + parsing
// ============================================================================

function formatQuickBrief(project: Project, lead: Lead | null): string {
  const reviews = parseReviews(lead?.google_reviews ?? project.reviews_snapshot);
  const lines: string[] = [];

  lines.push('## Business Context');
  lines.push('');
  lines.push('**Business:**');
  lines.push(project.business_name);
  lines.push('');

  if (reviews.length === 0) {
    lines.push('_No reviews on file._');
    return lines.join('\n');
  }

  for (const r of reviews) {
    lines.push('');
    lines.push(r.author);
    const meta: string[] = [];
    if (r.rating != null) meta.push(`${r.rating}★`);
    if (r.relativeTime) meta.push(r.relativeTime);
    if (meta.length) lines.push(meta.join(' · '));
    lines.push(r.text);
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}

function parseReviews(raw: string | null | undefined): ParsedReview[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .map((r: { author?: string; rating?: number; text?: string; relativeTime?: string; publishTime?: string }) => ({
        author: r.author ?? 'Anonymous',
        rating: r.rating ?? null,
        text: (r.text ?? '').trim(),
        relativeTime: r.relativeTime ?? '',
        publishTime: r.publishTime ?? '',
      }))
      .filter((r) => r.text.length > 0);
  } catch {
    return [];
  }
}
