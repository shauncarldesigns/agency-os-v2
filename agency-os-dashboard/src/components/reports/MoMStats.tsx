import type { ReportSnapshot } from '../../lib/types';

interface MoMStatsProps {
  current: ReportSnapshot | null;
  previous: ReportSnapshot | null;
}

export function MoMStats({ current, previous }: MoMStatsProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
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
  const color = !showDelta ? 'var(--text3)' : isImproved ? 'var(--green)' : 'var(--red)';
  const valColor = !hasCur ? 'var(--text3)' : showDelta ? color : 'var(--accent)';

  return (
    <div className="mom-card">
      <div className="mom-label">{label}</div>
      <div className="mom-row">
        <div className="mom-prev">{hasPrev ? format(prev!) : '—'}</div>
        <div className="mom-arrow">→</div>
        <div className="mom-current" style={{ color: valColor }}>
          {hasCur ? format(cur) : '—'}
        </div>
      </div>
      <div className="mom-delta" style={{ color }}>{deltaText}</div>
    </div>
  );
}
