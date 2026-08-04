import type { Project } from '../../lib/types';
import { Building2, CalendarDays, ChevronDown } from 'lucide-react';

interface ClientFilterProps {
  projects: Project[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  period: string;
  onPeriodChange: (p: string) => void;
  lockClient?: boolean;
}

// Build the last 12 monthly periods as YYYY-MM strings.
function recentPeriods(count = 12): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });
    out.push({ value, label });
  }
  return out;
}

export function ClientFilter({ projects, selectedId, onSelect, period, onPeriodChange, lockClient = false }: ClientFilterProps) {
  const periods = recentPeriods();

  return (
    <div className={`grid min-w-0 flex-1 gap-3 ${lockClient ? '' : 'sm:grid-cols-2'}`}>
      {!lockClient && <label className="block min-w-0">
        <span className="mb-1.5 block text-xs font-semibold text-slate-600">Client</span>
        <span className="relative block">
          <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <select
          className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          value={selectedId ?? ''}
          onChange={e => onSelect(parseInt(e.target.value, 10))}
        >
          {projects.length === 0 && <option value="">No Tier 3 clients</option>}
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.business_name} (Tier {p.tier})
            </option>
          ))}
        </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </span>
      </label>}
      <label className="block min-w-0">
        <span className="mb-1.5 block text-xs font-semibold text-slate-600">Reporting period</span>
        <span className="relative block">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <select
          className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          value={period}
          onChange={e => onPeriodChange(e.target.value)}
        >
          {periods.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </span>
      </label>
    </div>
  );
}
