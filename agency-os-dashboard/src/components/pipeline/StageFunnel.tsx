import type { Lead } from '../../lib/types';

export type StageFilter = 'all' | 'cold' | 'contacted' | 'qualified' | 'client' | 'dead';

interface StageFunnelProps {
  leads: Lead[];
  active: StageFilter;
  onChange: (s: StageFilter) => void;
}

export function StageFunnel({ leads, active, onChange }: StageFunnelProps) {
  const counts = {
    all: leads.length,
    cold: leads.filter(l => l.status === 'cold').length,
    contacted: leads.filter(l => l.status === 'contacted').length,
    qualified: leads.filter(l => l.status === 'qualified').length,
    client: leads.filter(l => l.status === 'client').length,
    dead: leads.filter(l => l.status === 'dead').length,
  };

  const stages: Array<{ key: StageFilter; label: string; muted?: boolean }> = [
    { key: 'all', label: 'All' },
    { key: 'cold', label: 'Cold' },
    { key: 'contacted', label: 'Contacted' },
    { key: 'qualified', label: 'Qualified' },
    { key: 'client', label: 'Client' },
    { key: 'dead', label: 'Dead', muted: true },
  ];

  return (
    <div className="stage-flow">
      {stages.map(s => (
        <button
          key={s.key}
          type="button"
          className={`sstep ${active === s.key ? 'active' : ''}`}
          onClick={() => onChange(s.key)}
          style={s.muted ? { borderLeft: '1px solid var(--border2)' } : undefined}
        >
          <div className="sstep-label" style={s.muted && active !== s.key ? { color: 'var(--red)', opacity: 0.7 } : undefined}>
            {s.label}
          </div>
          <div className="sstep-num" style={s.muted && active !== s.key ? { color: 'var(--text3)' } : undefined}>
            {counts[s.key]}
          </div>
        </button>
      ))}
    </div>
  );
}
