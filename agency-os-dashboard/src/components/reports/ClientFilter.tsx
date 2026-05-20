import type { Project } from '../../lib/types';

interface ClientFilterProps {
  projects: Project[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  period: string;
  onPeriodChange: (p: string) => void;
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

export function ClientFilter({ projects, selectedId, onSelect, period, onPeriodChange }: ClientFilterProps) {
  const periods = recentPeriods();

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--rl)', padding: '12px 16px', marginBottom: 18,
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)' }}>
          Client:
        </span>
        <select
          className="finput"
          style={{ width: 'auto', minWidth: 240, padding: '6px 10px', fontSize: '0.78rem' }}
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
      </div>
      <div style={{ width: 1, height: 20, background: 'var(--border2)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)' }}>
          Period:
        </span>
        <select
          className="finput"
          style={{ width: 'auto', padding: '6px 10px', fontSize: '0.78rem' }}
          value={period}
          onChange={e => onPeriodChange(e.target.value)}
        >
          {periods.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
