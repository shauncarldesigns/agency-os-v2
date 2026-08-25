import { useEffect, useState } from 'react';

export interface NotInterestedCloseout {
  note: string;
  receptionistInterested: boolean;
  email?: string;
  archive: boolean;
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
  const [archive, setArchive] = useState(archiveOnly);
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
    if (archive && !window.confirm(`Archive ${leadName}? This fully closes the lead and removes it from active outreach.`)) {
      return;
    }
    onConfirm({
      note: trimmedNote,
      receptionistInterested,
      email: receptionistInterested && trimmedEmail ? trimmedEmail : undefined,
      archive,
    });
  };

  const actionLabel = archive
    ? 'Archive lead'
    : receptionistInterested
      ? 'Save & add to Receptionist Interest'
      : 'Mark not interested';

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-900">Close website opportunity</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">{archiveOnly ? `Record why ${leadName} declined before removing them from active outreach.` : `Mark ${leadName} as not interested in the website and record what happened.`}</p>

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
              if (event.target.checked) setArchive(false);
            }}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>
            <span className="block text-xs font-semibold text-slate-800">Interested in the automated receptionist</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">Adds this business to Receptionist Interest instead of archiving it.</span>
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

        {!archiveOnly && <label className={`mt-3 flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 ${archive ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
          <input
            type="checkbox"
            checked={archive}
            onChange={(event) => {
              setArchive(event.target.checked);
              if (event.target.checked) setReceptionistInterested(false);
            }}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
          />
          <span>
            <span className="block text-xs font-semibold text-slate-800">Also archive this lead</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">Fully closes the lead. Archived leads cannot be added to Receptionist Interest.</span>
          </span>
        </label>}

        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className={`rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${archive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {busy ? 'Saving…' : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
