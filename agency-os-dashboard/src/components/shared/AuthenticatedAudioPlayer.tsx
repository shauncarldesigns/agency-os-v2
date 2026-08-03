import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Volume2 } from 'lucide-react';
import { api } from '../../lib/api';

export function AuthenticatedAudioPlayer({ url, compact = false }: { url: string; compact?: boolean }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let nextObjectUrl: string | null = null;
    setObjectUrl(null);
    setError(null);

    void api.recordings.fetchBlob(url)
      .then((blob) => {
        if (cancelled) return;
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'Recording could not be loaded');
      });

    return () => {
      cancelled = true;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [url]);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        {error}
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading recording…
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-slate-200 bg-white ${compact ? 'p-2' : 'p-3'}`}>
      {!compact && <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-slate-600"><Volume2 className="h-3.5 w-3.5" />Call recording</div>}
      <audio controls preload="metadata" src={objectUrl} className="h-9 w-full" />
    </div>
  );
}
