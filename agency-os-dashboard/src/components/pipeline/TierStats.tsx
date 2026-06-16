import type { Lead } from '../../lib/types';
import { tierSdeltaSublabel } from '../../lib/pricing';

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

  return (
    <div className="stats-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      <div className="tier-stat t3">
        <div className="tier-num t3">{t3}</div>
        <div className="slabel" style={{ color: 'var(--tier3)' }}>Tier 3 prospects</div>
        <div className="sdelta" style={{ color: 'var(--text3)' }}>{tierSdeltaSublabel(3)}</div>
      </div>
      <div className="tier-stat t2">
        <div className="tier-num t2">{t2}</div>
        <div className="slabel" style={{ color: 'var(--tier2)' }}>Tier 2 prospects</div>
        <div className="sdelta" style={{ color: 'var(--text3)' }}>{tierSdeltaSublabel(2)}</div>
      </div>
      <div className="tier-stat t1">
        <div className="tier-num t1">{t1}</div>
        <div className="slabel" style={{ color: 'var(--tier1)' }}>Tier 1 prospects</div>
        <div className="sdelta" style={{ color: 'var(--text3)' }}>{tierSdeltaSublabel(1)}</div>
      </div>
    </div>
  );
}
