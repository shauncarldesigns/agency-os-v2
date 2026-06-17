import { useState, useRef, useEffect, useCallback } from 'react';
import { api, ApiError } from '../../lib/api';
import type { ShowToast } from '../../lib/types';

/**
 * In-cockpit audio recorder. Replaces the static "ON CALL HH:MM" timer
 * in the utility row with a clickable Record/Stop affordance + live
 * elapsed counter.
 *
 * Flow:
 *   - idle: shows "● REC" — click to request mic permission + start
 *   - recording: shows "⬛ STOP · MM:SS" — click to stop
 *   - uploading: shows "⏳ Uploading…" — disabled during R2 upload
 *   - done: shows "✓ Recorded MM:SS" — timer freezes at final value;
 *           operator can click to start a new recording (replaces prior)
 *
 * On stop the .webm blob is uploaded via api.recordings.upload(leadId, blob).
 * The returned URL is bubbled up via onRecorded(url) so ExecutionView can
 * attach it to the next outcome submit (which persists it to call_log).
 *
 * onStart fires the moment the MediaRecorder actually starts capturing —
 * ExecutionView uses this to rebase the call timer + objection-hit
 * timestamps from "cockpit-load" to "recording-start." Falls back to
 * cockpit-load if operator never records.
 *
 * Important: requires HTTPS (or localhost). getUserMedia is gated.
 */

type RecorderState = 'idle' | 'recording' | 'uploading' | 'done' | 'denied';

interface RecordButtonProps {
  leadId: number;
  showToast: ShowToast;
  /** Fires when recording actually starts (post-permission, post-MediaRecorder.start). */
  onStart?: () => void;
  /** Fires once the recording has been uploaded. URL is the public R2 link
   *  and callId is the call_log row /api/recordings already created (so
   *  the cockpit can pass it back on outcome submit to merge into the same
   *  row instead of duplicating). */
  onRecorded?: (url: string, callId: number) => void;
  /** Resets to idle on lead change. Pass a key that changes per lead. */
  resetKey?: string | number;
}

export function RecordButton({ leadId, showToast, onStart, onRecorded, resetKey }: RecordButtonProps) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedS, setElapsedS] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset everything when the lead changes (resetKey is the lead id from caller).
  useEffect(() => {
    cleanup();
    setState('idle');
    setElapsedS(0);
    chunksRef.current = [];
    startedAtRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Hard cleanup on unmount.
  useEffect(() => () => cleanup(), []);

  function cleanup() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* silent */ }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  const startRecording = useCallback(async () => {
    if (state === 'recording' || state === 'uploading') return;
    chunksRef.current = [];
    setElapsedS(0);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setState('denied');
      showToast(`Mic permission denied: ${(err as Error).message}`, 'error');
      return;
    }
    streamRef.current = stream;

    // Pick the most supported audio mimeType. Chrome/Firefox/Edge support
    // webm;opus. Safari uses mp4. Fall back to whatever the browser picks.
    const mimeCandidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ];
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));

    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => { void finalize(); };
    rec.onerror = (e) => {
      showToast(`Recorder error: ${(e as ErrorEvent).message ?? 'unknown'}`, 'error');
      cleanup();
      setState('idle');
    };

    rec.start(1000); // emit dataavailable every 1s so chunks are bounded
    startedAtRef.current = Date.now();
    setState('recording');
    onStart?.();

    tickRef.current = setInterval(() => {
      if (startedAtRef.current) {
        setElapsedS(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, showToast, onStart]);

  const stopRecording = useCallback(() => {
    if (state !== 'recording') return;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop(); // triggers onstop → finalize
    }
  }, [state]);

  async function finalize() {
    setState('uploading');
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    const chunks = chunksRef.current;
    if (chunks.length === 0) {
      showToast('No audio captured', 'error');
      setState('idle');
      return;
    }
    // Pick ext from the first chunk's type (or default webm).
    const firstType = chunks[0].type || 'audio/webm';
    const ext = firstType.includes('mp4') ? 'm4a' : 'webm';
    const blob = new Blob(chunks, { type: firstType });

    try {
      const res = await api.recordings.upload(leadId, blob, ext);
      onRecorded?.(res.url, res.call_id);
      setState('done');
      const sizeKb = Math.round(res.bytes / 1024);
      showToast(`Recording saved (${sizeKb} KB)`, 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Upload failed: ${msg}`, 'error');
      setState('idle');
    }
  }

  function handleClick() {
    if (state === 'idle' || state === 'denied' || state === 'done') void startRecording();
    else if (state === 'recording') stopRecording();
  }

  const mmss = formatMMSS(elapsedS);
  const label = (() => {
    switch (state) {
      case 'idle': return <>● REC</>;
      case 'recording': return <>⬛ STOP · {mmss}</>;
      case 'uploading': return <>⏳ Uploading…</>;
      case 'done': return <>✓ Recorded {mmss} · click to re-record</>;
      case 'denied': return <>⚠ Mic blocked — retry</>;
    }
  })();

  const cls = (() => {
    switch (state) {
      case 'recording': return 'recbtn recbtn-recording';
      case 'uploading': return 'recbtn recbtn-busy';
      case 'done': return 'recbtn recbtn-done';
      case 'denied': return 'recbtn recbtn-denied';
      default: return 'recbtn';
    }
  })();

  return (
    <button
      type="button"
      className={cls}
      onClick={handleClick}
      disabled={state === 'uploading'}
      title={state === 'recording' ? 'Click to stop + save' : 'Click to record this call'}
    >
      {label}
    </button>
  );
}

function formatMMSS(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
