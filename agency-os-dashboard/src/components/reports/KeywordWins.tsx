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
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', padding: 18 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', letterSpacing: '1.5px', color: 'var(--text)', marginBottom: 14 }}>
        KEYWORD WINS
      </div>

      {wins.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text3)', fontSize: '0.74rem' }}>
          No keyword data for this period — run snapshot to pull from Search Console.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
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
                <tr key={w.query} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 10px', fontFamily: "'DM Mono', monospace", fontSize: '0.7rem', color: 'var(--text)' }}>
                    {w.query}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text3)', textDecoration: w.previousPosition !== null ? 'line-through' : undefined }}>
                    {w.previousPosition !== null ? Math.round(w.previousPosition) : '—'}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                    <span style={{
                      display: 'inline-block', minWidth: 24, height: 18, borderRadius: 4,
                      fontSize: '0.62rem', fontWeight: 700, lineHeight: '18px',
                      textAlign: 'center', padding: '0 4px',
                      ...positionPillStyle(w.currentPosition),
                    }}>
                      {Math.round(w.currentPosition)}
                    </span>
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: deltaColor, fontWeight: 600 }}>
                    {deltaText}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      padding: '7px 10px', textAlign: align,
      fontSize: '0.58rem', fontWeight: 600, letterSpacing: '1px',
      textTransform: 'uppercase', color: 'var(--text3)',
    }}>
      {children}
    </th>
  );
}
