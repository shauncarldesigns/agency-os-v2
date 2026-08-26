import { useEffect, useState } from 'react';

export interface NotInterestedCloseout {
  note: string;
  receptionistInterested: boolean;
  email?: string;
  archive: true;
}

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
  const [email, setEmail] = useState(initialEmail);
  const [receptionistInterested, setReceptionistInterested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!receptionistInterested) setError(null);
  }, [receptionistInterested]);

  const submit = () => {
    const trimmedNote = note.trim();
    const trimmedEmail = email.trim();
    if (!trimmedNote) {
      setError('Add a note about what happened before closing this lead.');
      return;
    }
    if (receptionistInterested && trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid email address or leave it blank.');
      return;
    }
    onConfirm({
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

        <label className="mt-4 block text-xs font-semibold text-slate-700">What happened? <span className="text-rose-500">*</span></label>
        <textarea
          autoFocus
          value={note}
          onChange={(event) => { setNote(event.target.value); setError(null); }}
          rows={3}
          placeholder="What they said, concerns, and any useful context"
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
