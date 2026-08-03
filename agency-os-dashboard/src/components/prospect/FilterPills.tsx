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

  const Pill: React.FC<{ filter: ProspectFilter; children: React.ReactNode }> = ({ filter, children }) => {
    const isActive = active === filter;
    return (
      <button
        type="button"
        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${isActive ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
        onClick={() => onChange(isActive ? 'all' : filter)}
      >
        {children}
      </button>
    );
  };

  return (
    <div className="my-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Filter</span>
        <Pill filter="t3">Tier 3 ({t3})
        </Pill>
        <Pill filter="t2">Tier 2 ({t2})
        </Pill>
        <Pill filter="t1">Tier 1 ({t1})
        </Pill>
        <Pill filter="unclaimed">Unclaimed GBP ({unclaimed})
        </Pill>
        <Pill filter="no-website">No website ({noWebsite})</Pill>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="text-xs text-slate-500">
          Showing <strong className="text-slate-800">{filteredCount}</strong> new
          {inPipelineCount > 0 && <> · <strong>{inPipelineCount}</strong> in pipeline</>}
        </span>
        <select className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" value={sortBy} onChange={e => onSortChange(e.target.value as SortBy)}>
          <option value="score">Opportunity score</option>
          <option value="reviews">Review count</option>
          <option value="pagespeed">Website status</option>
        </select>
      </div>
    </div>
  );
}
