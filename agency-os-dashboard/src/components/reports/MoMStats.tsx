import type { ReportSnapshot } from '../../lib/types';

interface MoMStatsProps {
  current: ReportSnapshot | null;
  previous: ReportSnapshot | null;
}

export function MoMStats({ current, previous }: MoMStatsProps) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-900">Month-over-month performance</h2><span className="text-[11px] text-slate-400">Previous → current</span></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card
        label="Impressions"
        prev={previous?.impressions}
        cur={current?.impressions}
        format={n => n.toLocaleString()}
        higherIsBetter
      />
      <Card
        label="Clicks"
        prev={previous?.clicks}
        cur={current?.clicks}
        format={n => n.toLocaleString()}
        higherIsBetter
      />
      <Card
        label="Avg Position"
        prev={previous?.avg_position}
        cur={current?.avg_position}
        format={n => n.toFixed(1)}
        higherIsBetter={false}
        deltaSuffix="spots"
      />
      <Card
        label="CTR"
        prev={previous?.ctr}
        cur={current?.ctr}
        format={n => `${(n * 100).toFixed(1)}%`}
        higherIsBetter
        deltaSuffix="pp"
        scaleDeltaBy={100}
      />
      </div>
    </section>
  );
}

interface CardProps {
  label: string;
  prev: number | null | undefined;
  cur: number | null | undefined;
  format: (n: number) => string;
  higherIsBetter: boolean;
  deltaSuffix?: string;
  scaleDeltaBy?: number;
}

function Card({ label, prev, cur, format, higherIsBetter, deltaSuffix, scaleDeltaBy = 1 }: CardProps) {
  const hasCur = cur != null;
  const hasPrev = prev != null && prev !== 0;
  const showDelta = hasCur && hasPrev;
  const isImproved = showDelta
    ? higherIsBetter ? cur > prev! : cur < prev!
    : false;
  const deltaText = (() => {
    if (!showDelta) return '—';
    if (deltaSuffix === 'pp') {
      const ppDiff = Math.abs(cur * scaleDeltaBy - prev! * scaleDeltaBy);
      return `${isImproved ? '↑' : '↓'} ${ppDiff.toFixed(1)} pp`;
    }
    if (deltaSuffix === 'spots') {
      return `${isImproved ? '↑' : '↓'} ${Math.abs(prev! - cur).toFixed(1)} spots`;
    }
    const pct = ((cur - prev!) / prev!) * 100;
    return `${isImproved ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}%`;
  })();
  const deltaClass = !showDelta ? 'text-slate-400' : isImproved ? 'text-emerald-600' : 'text-rose-600';
  const valueClass = !hasCur ? 'text-slate-400' : showDelta ? deltaClass : 'text-blue-600';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-3 flex items-baseline gap-2">
        <div className="text-xs text-slate-400">{hasPrev ? format(prev!) : '—'}</div>
        <div className="text-xs text-slate-300">→</div>
        <div className={`text-xl font-semibold tracking-tight ${valueClass}`}>
          {hasCur ? format(cur) : '—'}
        </div>
      </div>
      <div className={`mt-2 text-xs font-semibold ${deltaClass}`}>{deltaText}</div>
    </div>
  );
}
