import type { KeywordWin } from '../../lib/types';

interface KeywordWinsProps {
  wins: KeywordWin[];
}

function positionPillStyle(position: number): React.CSSProperties {
  if (position <= 3) {
    return {
      background: 'rgba(62,207,142,0.15)',
      color: 'var(--green)',
    };
  }
  if (position <= 10) {
    return {
      background: 'rgba(96,165,250,0.12)',
      color: 'var(--blue)',
    };
  }
  return { background: 'var(--yellow-bg)', color: 'var(--yellow)' };
}

export function KeywordWins({ wins }: KeywordWinsProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5"><h2 className="text-sm font-semibold text-slate-900">Keyword wins</h2><p className="mt-0.5 text-xs text-slate-500">Search position movement for this reporting period</p></div>

      {wins.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-slate-400">
          No keyword data for this period — run snapshot to pull from Search Console.
        </div>
      ) : (
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <Th>Query</Th>
              <Th align="right">Last</Th>
              <Th align="right">Now</Th>
              <Th align="right">Δ</Th>
            </tr>
          </thead>
          <tbody>
            {wins.map(w => {
              const isNew = w.delta === 'NEW';
              const numericDelta = typeof w.delta === 'number' ? w.delta : 0;
              const deltaText = isNew
                ? 'NEW'
                : numericDelta > 0 ? `↑ ${numericDelta.toFixed(0)}`
                : numericDelta < 0 ? `↓ ${Math.abs(numericDelta).toFixed(0)}`
                : '—';
              const deltaColor = isNew || numericDelta > 0 ? 'var(--green)' : numericDelta < 0 ? 'var(--red)' : 'var(--text3)';

              return (
                <tr key={w.query} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 sm:px-5">
                    {w.query}
                  </td>
                  <td className={`px-4 py-3 text-right text-xs text-slate-400 ${w.previousPosition !== null ? 'line-through' : ''}`}>
                    {w.previousPosition !== null ? Math.round(w.previousPosition) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span style={{
                      display: 'inline-block', minWidth: 24, height: 18, borderRadius: 4,
                      fontSize: '0.62rem', fontWeight: 700, lineHeight: '18px',
                      textAlign: 'center', padding: '0 4px',
                      ...positionPillStyle(w.currentPosition),
                    }}>
                      {Math.round(w.currentPosition)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-semibold" style={{ color: deltaColor }}>
                    {deltaText}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </section>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400" style={{ textAlign: align }}>
      {children}
    </th>
  );
}
