import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { CallIntelligenceReport, ShowToast } from '../../lib/types';

type Transcript = NonNullable<CallIntelligenceReport['transcript']>;

function timestamp(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function TranscriptCorrectionEditor({ callId, transcript, onQueued, showToast }: {
  callId: number;
  transcript: Transcript;
  onQueued: () => void | Promise<void>;
  showToast?: ShowToast;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [lines, setLines] = useState(() => transcript.transcript_json.map(row => row.transcript));
  useEffect(() => setLines(transcript.transcript_json.map(row => row.transcript)), [transcript]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      await api.calls.correctIntelligenceTranscript(callId, lines);
      setEditing(false);
      showToast?.('Transcript corrected. New coaching is being generated.', 'success');
      setMessage('Transcript corrected. New coaching is being generated.');
      await onQueued();
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : 'Could not save transcript correction', 'error');
      setMessage(error instanceof Error ? error.message : 'Could not save transcript correction');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) return <div>
    <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 font-sans text-xs leading-relaxed text-slate-100">{transcript.transcript_text}</pre>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Correct transcript</button>
      {transcript.corrected_at && <span className="text-xs text-emerald-700">Manually corrected</span>}
    </div>
    {message && <p className="mt-2 text-xs text-blue-700">{message}</p>}
  </div>;

  return <div className="mt-3 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
    <p className="text-xs text-slate-600">Correct only the words that were misheard. Speakers and timestamps remain attached to each line.</p>
    {transcript.transcript_json.map((row, index) => <label key={`${row.start}-${index}`} className="grid gap-1 md:grid-cols-[110px_minmax(0,1fr)] md:items-start">
      <span className="pt-2 text-xs font-semibold text-slate-500">[{timestamp(row.start)}] {row.speaker === transcript.shaun_speaker ? 'Shaun' : 'Prospect'}</span>
      <textarea rows={2} value={lines[index] ?? ''} onChange={event => setLines(current => current.map((line, lineIndex) => lineIndex === index ? event.target.value : line))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
    </label>)}
    <div className="flex gap-2 pt-1">
      <button type="button" disabled={saving || lines.some(line => !line.trim())} onClick={() => void save()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save correction and regenerate'}</button>
      <button type="button" disabled={saving} onClick={() => { setLines(transcript.transcript_json.map(row => row.transcript)); setEditing(false); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600">Cancel</button>
    </div>
  </div>;
}
