interface ExecSummaryProps {
  businessName: string;
  period: string; // already formatted ("April 2026")
  text: string | null | undefined;
  loading?: boolean;
  onRegenerate?: () => void;
  regenerating?: boolean;
}

export function ExecSummary({ businessName, period, text, loading, onRegenerate, regenerating }: ExecSummaryProps) {
  const empty = !text || !text.trim();

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><FileText className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">Executive summary</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">{businessName} · {period}</p>
          </div>
        </div>
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating || loading}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {empty ? <Sparkles className="h-3.5 w-3.5" /> : <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />}
            {regenerating ? 'Generating…' : empty ? 'Generate' : 'Regenerate'}
          </button>
        )}
      </div>
      <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700">
        {loading
          ? <em className="text-slate-400">Loading…</em>
          : empty
            ? <em className="text-slate-400">No summary yet — generate one from this period’s performance data.</em>
            : text}
      </div>
    </section>
  );
}
import { FileText, RefreshCw, Sparkles } from 'lucide-react';
