import type { Lead } from '../../lib/types';

interface TierStatsProps {
  leads: Lead[];
}

export function TierStats({ leads }: TierStatsProps) {
  // Only count leads that aren't dead/clients yet — these are *prospects*
  const prospects = leads.filter(l => l.status !== 'dead' && l.status !== 'client');
  const t3 = prospects.filter(l => l.recommended_tier === 3).length;
  const t2 = prospects.filter(l => l.recommended_tier === 2).length;
  const t1 = prospects.filter(l => l.recommended_tier === 1).length;

  return (
    <div className="stats-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      <div className="tier-stat t3">
        <div className="tier-num t3">{t3}</div>
        <div className="slabel" style={{ color: 'var(--tier3)' }}>Tier 3 prospects</div>
        <div className="sdelta" style={{ color: 'var(--text3)' }}>$499/mo each potential</div>
      </div>
      <div className="tier-stat t2">
        <div className="tier-num t2">{t2}</div>
        <div className="slabel" style={{ color: 'var(--tier2)' }}>Tier 2 prospects</div>
        <div className="sdelta" style={{ color: 'var(--text3)' }}>$400 + $79/mo each</div>
      </div>
      <div className="tier-stat t1">
        <div className="tier-num t1">{t1}</div>
        <div className="slabel" style={{ color: 'var(--tier1)' }}>Tier 1 prospects</div>
        <div className="sdelta" style={{ color: 'var(--text3)' }}>$800 one-time each</div>
      </div>
    </div>
  );
}
