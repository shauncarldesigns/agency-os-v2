import type { Lead } from '../../lib/types';

export type StageFilter = 'all' | 'cold' | 'contacted' | 'qualified' | 'client';

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
  };

  // 'qualified' was generic in pre-Phase-0 vocabulary; now it specifically
  // means "demo booked, prospect project exists, awaiting outcome". Label
  // reflects that. Not Interested is an archive reason, not an active stage.
  // 'dead' is reserved for churned former clients.
  const stages: Array<{ key: StageFilter; label: string; muted?: boolean }> = [
    { key: 'all', label: 'All' },
    { key: 'cold', label: 'Cold' },
    { key: 'contacted', label: 'Contacted' },
    { key: 'qualified', label: 'Demo booked' },
    { key: 'client', label: 'Client' },
  ];

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex items-center justify-between px-1">
        <div>
          <h3 className="text-sm font-bold text-slate-900">CRM stages</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">Filter the pipeline by relationship stage</p>
        </div>
        {active !== 'all' && <button onClick={() => onChange('all')} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Clear filter</button>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {stages.map(s => {
          const selected = active === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange(s.key)}
              aria-pressed={selected}
              className={`min-w-0 rounded-xl border px-3 py-3 text-left transition ${selected ? 'border-blue-200 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
            >
              <div className={`truncate text-[10px] font-bold uppercase tracking-[0.12em] ${selected ? 'text-blue-600' : s.muted ? 'text-rose-400' : 'text-slate-400'}`}>{s.label}</div>
              <div className={`mt-1 text-2xl font-bold leading-none ${selected ? 'text-blue-700' : s.muted ? 'text-slate-500' : 'text-slate-800'}`}>{counts[s.key]}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
