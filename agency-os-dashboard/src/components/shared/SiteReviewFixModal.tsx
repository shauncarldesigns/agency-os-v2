import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export const SITE_REVIEW_REASON_LABELS: Record<string, string> = {
  legibility_colors: 'Legibility or colors',
  incorrect_logo: 'Incorrect logo',
  bad_images: 'Bad images',
  bad_reviews: 'Bad reviews',
  incorrect_business_info: 'Incorrect business info',
  content_problem: 'Content problem',
  layout_problem: 'Layout problem',
  other: 'Other',
};

export function parseSiteReviewReasons(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function SiteReviewIssueSummary({ reasons, note }: { reasons: string[]; note: string | null }) {
  return (
    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800">
      <div className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-3 w-3" /> Needs fix</div>
      {reasons.length > 0 && (
        <p className="mt-1 leading-snug">{reasons.map((reason) => SITE_REVIEW_REASON_LABELS[reason] ?? reason).join(' · ')}</p>
      )}
      {note && <p className="mt-1 whitespace-pre-wrap leading-snug text-rose-700">{note}</p>}
    </div>
  );
}

export function SiteReviewFixModal({
  leadName,
  initialReasons = [],
  initialNote = '',
  onClose,
  onSave,
}: {
  leadName: string;
  initialReasons?: string[];
  initialNote?: string;
  onClose: () => void;
  onSave: (reasons: string[], note: string) => Promise<void>;
}) {
  const [reasons, setReasons] = useState<string[]>(initialReasons);
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  const save = async () => {
    if (reasons.length === 0 && !note.trim()) {
      setError('Choose at least one issue or add a note.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(reasons, note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save review');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Mark site as Needs fix</h2>
            <p className="mt-0.5 text-sm text-slate-500">{leadName} will stay in Built Needs Review.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What needs attention?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(SITE_REVIEW_REASON_LABELS).map(([value, label]) => {
              const selected = reasons.includes(value);
              return (
                <button key={value} type="button" onClick={() => setReasons((current) => selected ? current.filter((item) => item !== value) : [...current, value])} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${selected ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="site-review-note">Fix note</label>
        <textarea id="site-review-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={4} placeholder="Describe exactly what should be corrected…" className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save Needs fix'}</button>
        </div>
      </div>
    </div>
  );
}
