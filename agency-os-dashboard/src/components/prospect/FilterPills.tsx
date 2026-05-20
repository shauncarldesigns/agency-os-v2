import type { ProspectResult } from '../../lib/types';

export type ProspectFilter = 'all' | 't3' | 't2' | 't1' | 'unclaimed' | 'no-website';

interface FilterPillsProps {
  results: ProspectResult[];
  active: ProspectFilter;
  onChange: (f: ProspectFilter) => void;
  filteredCount: number;
  inPipelineCount: number;
  sortBy: SortBy;
  onSortChange: (s: SortBy) => void;
}

export type SortBy = 'score' | 'reviews' | 'pagespeed';

export function FilterPills({ results, active, onChange, filteredCount, inPipelineCount, sortBy, onSortChange }: FilterPillsProps) {
  const t3 = results.filter(r => r.recommendedTier === 3 && !r.alreadyInPipeline).length;
  const t2 = results.filter(r => r.recommendedTier === 2 && !r.alreadyInPipeline).length;
  const t1 = results.filter(r => r.recommendedTier === 1 && !r.alreadyInPipeline).length;
  const unclaimed = results.filter(r => !r.claimed && !r.alreadyInPipeline).length;
  const noWebsite = results.filter(r => !r.website && !r.alreadyInPipeline).length;

  const Pill: React.FC<{ filter: ProspectFilter; className: string; children: React.ReactNode; outlineColor?: string }> = ({ filter, className, children, outlineColor }) => {
    const isActive = active === filter;
    return (
      <button
        type="button"
        className={className}
        onClick={() => onChange(isActive ? 'all' : filter)}
        style={{
          cursor: 'pointer',
          background: 'none',
          font: 'inherit',
          outline: isActive ? `2px solid ${outlineColor ?? 'var(--accent)'}` : 'none',
          outlineOffset: 2,
        }}
      >
        {children}
      </button>
    );
  };

  return (
    <div className="fbar">
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)' }}>
          Filter:
        </span>
        <Pill filter="t3" className="tier-pill t3" outlineColor="var(--tier3)">
          <span className="tier-icon" />Tier 3 ({t3})
        </Pill>
        <Pill filter="t2" className="tier-pill t2" outlineColor="var(--tier2)">
          <span className="tier-icon" />Tier 2 ({t2})
        </Pill>
        <Pill filter="t1" className="tier-pill t1" outlineColor="var(--tier1)">
          <span className="tier-icon" />Tier 1 ({t1})
        </Pill>
        <span style={{ color: 'var(--border2)' }}>|</span>
        <Pill filter="unclaimed" className="gbp-pill unclaimed" outlineColor="var(--purple)">
          ⭐ Unclaimed GBP ({unclaimed})
        </Pill>
        <button
          type="button"
          onClick={() => onChange(active === 'no-website' ? 'all' : 'no-website')}
          style={{
            cursor: 'pointer',
            background: 'var(--red-bg)',
            color: 'var(--red)',
            border: '1px solid rgba(248,113,113,0.3)',
            fontSize: '0.6rem',
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 20,
            outline: active === 'no-website' ? '2px solid var(--red)' : 'none',
            outlineOffset: 2,
          }}
        >
          🚫 No Website ({noWebsite})
        </button>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 7, alignItems: 'center' }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>
          Showing <strong style={{ color: 'var(--text)' }}>{filteredCount}</strong> new
          {inPipelineCount > 0 && <> · <strong style={{ color: 'var(--text3)' }}>{inPipelineCount}</strong> in pipeline</>}
        </span>
        <select className="fsel" value={sortBy} onChange={e => onSortChange(e.target.value as SortBy)}>
          <option value="score">Sort: Opportunity score</option>
          <option value="reviews">Sort: Reviews count</option>
          <option value="pagespeed">Sort: Has website</option>
        </select>
      </div>
    </div>
  );
}
