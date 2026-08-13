import { forwardRef, useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import { api, ApiError } from '../../lib/api';
import type { ShowToast } from '../../lib/types';
import { Check, Circle, LoaderCircle, Square, TriangleAlert } from 'lucide-react';

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

export interface RecordedCall {
  url: string;
  callId: number;
}

export interface RecordButtonHandle {
  /** Stops an active recording and resolves only after its upload finishes. */
  stopAndSave: () => Promise<RecordedCall | null>;
}

interface RecordingDeferred {
  promise: Promise<RecordedCall | null>;
  resolve: (recording: RecordedCall | null) => void;
}

export const RecordButton = forwardRef<RecordButtonHandle, RecordButtonProps>(function RecordButton(
  { leadId, showToast, onStart, onRecorded, resetKey },
  ref,
) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedS, setElapsedS] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<RecorderState>('idle');
  const deferredRef = useRef<RecordingDeferred | null>(null);
  const lastRecordedRef = useRef<RecordedCall | null>(null);

  function updateState(next: RecorderState) {
    stateRef.current = next;
    setState(next);
  }

  // Reset everything when the lead changes (resetKey is the lead id from caller).
  useEffect(() => {
    cleanup();
    updateState('idle');
    setElapsedS(0);
    chunksRef.current = [];
    startedAtRef.current = null;
    deferredRef.current?.resolve(null);
    deferredRef.current = null;
    lastRecordedRef.current = null;
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
      updateState('denied');
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
    let resolveRecording!: (recording: RecordedCall | null) => void;
    const promise = new Promise<RecordedCall | null>((resolve) => { resolveRecording = resolve; });
    deferredRef.current = { promise, resolve: resolveRecording };
    lastRecordedRef.current = null;

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      void finalize().then((recording) => {
        lastRecordedRef.current = recording;
        deferredRef.current?.resolve(recording);
      });
    };
    rec.onerror = (e) => {
      showToast(`Recorder error: ${(e as ErrorEvent).message ?? 'unknown'}`, 'error');
      cleanup();
      updateState('idle');
      deferredRef.current?.resolve(null);
    };

    rec.start(1000); // emit dataavailable every 1s so chunks are bounded
    startedAtRef.current = Date.now();
    updateState('recording');
    onStart?.();

    tickRef.current = setInterval(() => {
      if (startedAtRef.current) {
        setElapsedS(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, showToast, onStart]);

  const stopRecording = useCallback(() => {
    if (stateRef.current !== 'recording') return;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop(); // triggers onstop → finalize
    }
  }, []);

  async function finalize(): Promise<RecordedCall | null> {
    updateState('uploading');
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    const chunks = chunksRef.current;
    if (chunks.length === 0) {
      showToast('No audio captured', 'error');
      updateState('idle');
      return null;
    }
    // Pick ext from the first chunk's type (or default webm).
    const firstType = chunks[0].type || 'audio/webm';
    const ext = firstType.includes('mp4') ? 'm4a' : 'webm';
    const blob = new Blob(chunks, { type: firstType });

    try {
      const res = await api.recordings.upload(leadId, blob, ext);
      onRecorded?.(res.url, res.call_id);
      updateState('done');
      const sizeKb = Math.round(res.bytes / 1024);
      showToast(`Recording saved (${sizeKb} KB)`, 'success');
      return { url: res.url, callId: res.call_id };
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Upload failed: ${msg}`, 'error');
      updateState('idle');
      return null;
    }
  }

  const stopAndSave = useCallback(async (): Promise<RecordedCall | null> => {
    if (stateRef.current === 'done') return lastRecordedRef.current;
    if (stateRef.current === 'recording') stopRecording();
    if (stateRef.current === 'uploading' || stateRef.current === 'recording') {
      return deferredRef.current?.promise ?? null;
    }
    return null;
  }, [stopRecording]);

  useImperativeHandle(ref, () => ({ stopAndSave }), [stopAndSave]);

  function handleClick() {
    if (state === 'idle' || state === 'denied' || state === 'done') void startRecording();
    else if (state === 'recording') stopRecording();
  }

  const mmss = formatMMSS(elapsedS);
  const label = (() => {
    switch (state) {
      case 'idle': return <><Circle size={11} fill="currentColor" /> REC</>;
      case 'recording': return <><Square size={11} fill="currentColor" /> STOP · {mmss}</>;
      case 'uploading': return <><LoaderCircle size={12} className="animate-spin" /> Uploading…</>;
      case 'done': return <><Check size={12} /> Recorded {mmss} · click to re-record</>;
      case 'denied': return <><TriangleAlert size={12} /> Mic blocked — retry</>;
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
});

function formatMMSS(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
