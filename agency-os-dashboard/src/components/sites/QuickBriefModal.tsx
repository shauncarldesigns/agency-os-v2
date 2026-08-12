import { useMemo, useState } from 'react';
import type { Brief, Lead, Project, ShowToast } from '../../lib/types';
import { Modal, ModalHeader, ModalFooter } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Check, Copy, FileText } from 'lucide-react';

interface QuickBriefModalProps {
  open: boolean;
  project: Project | null;
  lead: Lead | null;
  outreachBrief: Brief | null;
  onClose: () => void;
  showToast: ShowToast;
}

/**
 * Historical outreach artifact viewer. The former Quick Brief generator was
 * weaker than the pipeline brief that actually produced the demo site, so the
 * client workspace now preserves and exposes that original brief instead of
 * manufacturing a competing prompt.
 */
export function QuickBriefModal({ open, project, lead, outreachBrief, onClose, showToast }: QuickBriefModalProps) {
  const [copied, setCopied] = useState(false);
  const content = useMemo(() => outreachBrief?.content_markdown ?? lead?.pipeline_brief ?? '', [lead?.pipeline_brief, outreachBrief?.content_markdown]);

  if (!open || !project) return null;

  async function handleCopy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      showToast('Outreach brief copied', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch { showToast('Could not access clipboard — select the text and copy manually', 'error'); }
  }

  const generatedAt = outreachBrief?.generated_at ?? lead?.updated_at ?? null;
  return <Modal open={open} onClose={onClose} width={720}>
    <ModalHeader title={`Outreach Brief — ${project.business_name}`} onClose={onClose} />
    <div className="p-5">
      {content ? <>
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800"><FileText className="mt-0.5 h-4 w-4 shrink-0" /><div><strong className="block">Original one-page build brief</strong><span className="mt-0.5 block text-xs text-blue-600">Preserved from Email or Text Outreach and supplied to the Master Brief as lower-priority continuity context.{generatedAt ? ` Saved ${formatDate(generatedAt)}.` : ''}</span></div></div>
        <textarea value={content} readOnly onClick={(event) => (event.target as HTMLTextAreaElement).select()} spellCheck={false} className="min-h-96 max-h-[58dvh] w-full resize-y whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700" />
      </> : <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><FileText className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-3 text-sm font-semibold text-slate-800">No outreach brief available</h3><p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">This workspace was not converted from an Email or Text Outreach lead with a generated brief. The Master Brief will use confirmed project, Discovery, and review data.</p></div>}
    </div>
    <ModalFooter><Button variant="ghost" size="sm" onClick={onClose}>Close</Button>{content && <Button variant="primary" size="sm" onClick={handleCopy}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy outreach brief</>}</Button>}</ModalFooter>
  </Modal>;
}

function formatDate(value: string) {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
