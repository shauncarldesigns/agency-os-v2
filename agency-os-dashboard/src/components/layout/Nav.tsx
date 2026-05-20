import type { Tab, NavCounts } from '../../lib/types';

interface NavProps {
  active: Tab;
  onChange: (t: Tab) => void;
  counts: NavCounts;
}

const TABS: Array<{ key: Tab; icon: string; label: string; countKey: keyof NavCounts | null }> = [
  { key: 'prospect', icon: '🔍', label: 'Prospect', countKey: 'prospect' },
  { key: 'pipeline', icon: '📋', label: 'Pipeline', countKey: 'pipeline' },
  { key: 'build', icon: '⚡', label: 'Build', countKey: 'build' },
  { key: 'sites', icon: '🌐', label: 'Sites', countKey: 'sites' },
  { key: 'reports', icon: '📊', label: 'Reports', countKey: null },
];

export function Nav({ active, onChange, counts }: NavProps) {
  return (
    <div className="nav">
      {TABS.map(t => {
        const count = t.countKey ? counts[t.countKey] : null;
        return (
          <button
            key={t.key}
            type="button"
            className={`ntab ${active === t.key ? 'active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
            {count !== null && count !== undefined && <span className="nc">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
