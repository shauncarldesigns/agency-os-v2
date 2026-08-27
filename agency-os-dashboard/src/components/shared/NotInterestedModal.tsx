import { useEffect, useState } from 'react';

export interface NotInterestedCloseout {
  reason: NotInterestedReason;
  note: string;
  receptionistInterested: boolean;
  email?: string;
  archive: true;
}

export type NotInterestedReason =
  | 'price_budget'
  | 'bad_timing'
  | 'existing_provider'
  | 'no_value'
  | 'do_it_themselves'
  | 'partner_approval'
  | 'outreach_trust'
  | 'business_change'
  | 'different_service'
  | 'other';

export const NOT_INTERESTED_REASONS: Array<{ value: NotInterestedReason; label: string }> = [
  { value: 'price_budget', label: 'Price or budget' },
  { value: 'bad_timing', label: 'Bad timing' },
  { value: 'existing_provider', label: 'Already has a website/provider' },
  { value: 'no_value', label: "Doesn't see the value" },
  { value: 'do_it_themselves', label: 'Prefers to do it themselves' },
  { value: 'partner_approval', label: 'Needs partner approval' },
  { value: 'outreach_trust', label: "Doesn't trust unsolicited outreach" },
  { value: 'business_change', label: 'Business closing or changing' },
  { value: 'different_service', label: 'Interested in another service' },
  { value: 'other', label: 'Other' },
];

export function NotInterestedModal({
  leadName,
  initialNote = '',
  initialEmail = '',
  busy = false,
  archiveOnly = false,
  onClose,
  onConfirm,
}: {
  leadName: string;
  initialNote?: string;
  initialEmail?: string;
  busy?: boolean;
  archiveOnly?: boolean;
  onClose: () => void;
  onConfirm: (closeout: NotInterestedCloseout) => void;
}) {
  const [note, setNote] = useState(initialNote);
  const [reason, setReason] = useState<NotInterestedReason | null>(null);
  const [email, setEmail] = useState(initialEmail);
  const [receptionistInterested, setReceptionistInterested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!receptionistInterested) setError(null);
  }, [receptionistInterested]);

  const submit = () => {
    const trimmedNote = note.trim();
    const trimmedEmail = email.trim();
    if (!reason) {
      setError('Choose the primary reason they are not interested.');
      return;
    }
    if (reason === 'other' && !trimmedNote) {
      setError('Add a note explaining the other reason.');
      return;
    }
    if (receptionistInterested && trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid email address or leave it blank.');
      return;
    }
    onConfirm({
      reason,
      note: trimmedNote,
      receptionistInterested,
      email: receptionistInterested && trimmedEmail ? trimmedEmail : undefined,
      archive: true,
    });
  };

  const actionLabel = receptionistInterested ? 'Archive website lead & save interest' : 'Mark not interested & archive';

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-900">Close website opportunity</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">Record why {leadName} declined. The website opportunity will be archived and removed from all active outreach.</p>

        <fieldset className="mt-4">
          <legend className="text-xs font-semibold text-slate-700">Why are they not interested? <span className="text-rose-500">*</span></legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {NOT_INTERESTED_REASONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={reason === option.value}
                onClick={() => { setReason(option.value); setError(null); }}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${reason === option.value
                  ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-4 block text-xs font-semibold text-slate-700">What did they say? {reason === 'other' ? <span className="text-rose-500">*</span> : <span className="font-normal text-slate-400">Optional</span>}</label>
        <textarea
          value={note}
          onChange={(event) => { setNote(event.target.value); setError(null); }}
          rows={3}
          placeholder="Their wording, concerns, and any useful context"
          className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
        />

        {!archiveOnly && <label className={`mt-3 flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 ${receptionistInterested ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
          <input
            type="checkbox"
            checked={receptionistInterested}
            onChange={(event) => {
              setReceptionistInterested(event.target.checked);
            }}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>
            <span className="block text-xs font-semibold text-slate-800">Interested in the automated receptionist</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">The website opportunity is still archived; receptionist interest remains active on its own page.</span>
          </span>
        </label>}

        {!archiveOnly && receptionistInterested && (
          <label className="mt-3 block text-xs font-semibold text-slate-700">
            Where should the demo number be sent?
            <input
              type="email"
              value={email}
              onChange={(event) => { setEmail(event.target.value); setError(null); }}
              placeholder="owner@business.com"
              className="mt-1.5 h-10 w-full rounded-xl border border-blue-200 bg-white px-3 text-sm font-normal text-slate-700 outline-none focus:ring-2 focus:ring-blue-100"
            />
            <span className="mt-1 block text-[10px] font-normal text-slate-400">Optional—interest is still recorded if they do not provide an email.</span>
          </label>
        )}

        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] leading-4 text-amber-800">Any active email/text automation and pending callbacks will stop. If a demo site exists, it will appear in Archived Leads as Cleanup required.</div>

        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            {busy ? 'Saving…' : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
