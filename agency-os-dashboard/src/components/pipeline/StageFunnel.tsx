import type { Lead } from '../../lib/types';

export type StageFilter = 'all' | 'cold' | 'contacted' | 'qualified' | 'client' | 'not_interested' | 'dead';

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
    not_interested: leads.filter(l => l.status === 'not_interested').length,
    dead: leads.filter(l => l.status === 'dead').length,
  };

  // 'qualified' was generic in pre-Phase-0 vocabulary; now it specifically
  // means "demo booked, prospect project exists, awaiting outcome". Label
  // reflects that. 'not_interested' is the new cold-call-rejection slot.
  // 'dead' is reserved for churned former clients.
  const stages: Array<{ key: StageFilter; label: string; muted?: boolean }> = [
    { key: 'all', label: 'All' },
    { key: 'cold', label: 'Cold' },
    { key: 'contacted', label: 'Contacted' },
    { key: 'qualified', label: 'Demo booked' },
    { key: 'client', label: 'Client' },
    { key: 'not_interested', label: 'Not interested', muted: true },
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
