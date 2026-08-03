import type { Lead } from '../../lib/types';
import { tierSdeltaSublabel } from '../../lib/pricing';
import { Gem, Sparkles, Zap } from 'lucide-react';

interface TierStatsProps {
  leads: Lead[];
}

export function TierStats({ leads }: TierStatsProps) {
  // "Prospects" here = leads still in the active calling pool — excludes
  // qualified (demo booked), client (signed), not_interested (declined),
  // and dead (churned).
  const prospects = leads.filter(l =>
    l.status !== 'qualified'
    && l.status !== 'client'
    && l.status !== 'not_interested'
    && l.status !== 'dead'
  );
  const t3 = prospects.filter(l => l.recommended_tier === 3).length;
  const t2 = prospects.filter(l => l.recommended_tier === 2).length;
  const t1 = prospects.filter(l => l.recommended_tier === 1).length;

  const tiers = [
    { tier: 3 as const, count: t3, icon: Gem, iconClass: 'bg-violet-50 text-violet-600', valueClass: 'text-violet-700' },
    { tier: 2 as const, count: t2, icon: Sparkles, iconClass: 'bg-amber-50 text-amber-600', valueClass: 'text-amber-700' },
    { tier: 1 as const, count: t1, icon: Zap, iconClass: 'bg-emerald-50 text-emerald-600', valueClass: 'text-emerald-700' },
  ];

  return (
    <section className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {tiers.map(({ tier, count, icon: Icon, iconClass, valueClass }) => (
        <div key={tier} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconClass}`}><Icon className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2"><span className={`text-2xl font-bold leading-none ${valueClass}`}>{count}</span><span className="truncate text-[11px] font-bold uppercase tracking-wider text-slate-500">Tier {tier}</span></div>
            <p className="mt-1 truncate text-[11px] text-slate-400">{tierSdeltaSublabel(tier)}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
