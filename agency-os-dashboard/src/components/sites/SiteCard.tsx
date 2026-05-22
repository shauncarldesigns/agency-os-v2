import type { Project, ShowToast, Tab } from '../../lib/types';
import { Button } from '../shared/Button';
import { TierPill } from '../shared/TierPill';
import { formatDate } from '../../lib/format';

interface SiteCardProps {
  project: Project;
  showToast: ShowToast;
  onSwitchTab: (tab: Tab) => void;
  onOpenDetail: () => void;
}

const TIER_MRR = { 1: 0, 2: 79, 3: 499 } as const;

export function SiteCard({ project, onSwitchTab, onOpenDetail, showToast: _showToast }: SiteCardProps) {
  const tier = project.tier;
  const liveUrl = project.custom_domain ?? project.landingsite_url;
  const isBuilding = project.status === 'building';
  const mrr = TIER_MRR[tier] ?? 0;
  const pagesBuilt = project.pages_built ?? 0;
  const monthlyTarget = project.monthly_pages_target ?? (tier === 3 ? 5 : 0);

  const subtitle = (() => {
    const where = [project.city, project.state].filter(Boolean).join(', ');
    if (project.contract_start) {
      return `${where} · Client since ${formatDate(project.contract_start, { year: 'numeric', month: 'short' })}`;
    }
    return `${where} · ${project.status === 'building' ? 'Just signed' : project.status}`;
  })();

  return (
    <div className={`scard2 t${tier}`}>
      <div
        className="scard-header"
        onClick={onOpenDetail}
        role="button"
        title="Open Brief Studio"
        style={{ cursor: 'pointer' }}
      >
        <div>
          <div className="scard-title">{project.business_name}</div>
          <div className="scard-sub">{subtitle}</div>
        </div>
        <TierPill tier={tier} />
      </div>
      <div className="scard-body">
        <div className="url-row">
          <span style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: '1px', color: 'var(--text3)', width: 50 }}>SITE</span>
          {isBuilding && !liveUrl ? (
            <>
              <span className="url-mono" style={{ color: 'var(--text3)' }}>Building…</span>
              <span style={{ display: 'inline-block', animation: 'spin 2s linear infinite', fontSize: 11 }}>⚙️</span>
            </>
          ) : liveUrl ? (
            <>
              <span className="url-mono">{liveUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
              <a
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
                className="url-link"
                aria-label="Open site"
                onClick={(e) => e.stopPropagation()}
              >↗</a>
            </>
          ) : (
            <span className="url-mono" style={{ color: 'var(--text3)' }}>—</span>
          )}
        </div>

        {/* MRR + pages-this-month — uniform across all tiers (no tier-gating in v2.2) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginTop: 10,
        }}>
          <MetricChip
            label="MRR"
            value={mrr > 0 ? `$${mrr}/mo` : '— '}
            tone={mrr > 0 ? 'green' : 'muted'}
          />
          <MetricChip
            label={monthlyTarget > 0 ? 'This month' : 'Pages built'}
            value={monthlyTarget > 0 ? `${pagesBuilt} / ${monthlyTarget}` : String(pagesBuilt)}
            tone={pagesBuilt > 0 ? 'accent' : 'muted'}
          />
        </div>

        <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
          <Button variant="primary" size="sm" onClick={onOpenDetail}>
            📋 Brief Studio
          </Button>
          {tier === 3 && (
            <Button variant="ghost" size="sm" onClick={() => onSwitchTab('reports')}>
              📈 Report
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricChip({
  label, value, tone,
}: {
  label: string; value: string; tone: 'accent' | 'green' | 'muted';
}) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'accent' ? 'var(--accent)' : 'var(--text3)';
  return (
    <div style={{
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r)',
      padding: '8px 11px',
    }}>
      <div style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)' }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.15rem', color, lineHeight: 1.2 }}>
        {value}
      </div>
    </div>
  );
}
