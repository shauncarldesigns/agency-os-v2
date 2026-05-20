import type { Project, ShowToast, Tab } from '../../lib/types';
import { Button } from '../shared/Button';
import { TierPill } from '../shared/TierPill';
import { formatDate } from '../../lib/format';

interface SiteCardProps {
  project: Project;
  showToast: ShowToast;
  onSwitchTab: (tab: Tab) => void;
  onOpenMatrix: () => void;
}

export function SiteCard({ project, showToast, onSwitchTab, onOpenMatrix }: SiteCardProps) {
  const tier = project.tier;
  const liveUrl = project.custom_domain ?? project.landingsite_url;
  const isBuilding = project.status === 'building';

  const subtitle = (() => {
    const where = [project.city, project.state].filter(Boolean).join(', ');
    if (project.contract_start) {
      return `${where} · Client since ${formatDate(project.contract_start, { year: 'numeric', month: 'short' })}`;
    }
    return `${where} · ${project.status === 'building' ? 'Just signed' : project.status}`;
  })();

  return (
    <div className={`scard2 t${tier}`}>
      <div className="scard-header">
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
              <a href={liveUrl} target="_blank" rel="noreferrer" className="url-link" aria-label="Open site">↗</a>
            </>
          ) : (
            <span className="url-mono" style={{ color: 'var(--text3)' }}>—</span>
          )}
        </div>

        {/* Tier 3 — coverage summary + schedule mini */}
        {tier === 3 && (
          <CoverageSummaryStub project={project} onClick={onOpenMatrix} />
        )}

        {tier === 3 && project.next_pages_due && (
          <div className="schedule-mini">
            <div className="schedule-label">
              Next batch due {formatDate(project.next_pages_due, { month: 'short', day: 'numeric' })}
            </div>
            <div className="schedule-item">
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className="schedule-status-dot dot-queued" />
                3 service-area pages queued
              </div>
              <span style={{ fontSize: '0.6rem', color: 'var(--text3)' }}>Auto</span>
            </div>
          </div>
        )}

        {/* Tier 1 handoff banner */}
        {tier === 1 && project.status === 'live' && (
          <div style={{
            background: 'rgba(62,207,142,0.06)',
            border: '1px solid rgba(62,207,142,0.2)',
            borderRadius: 'var(--r)',
            padding: '9px 11px',
            marginBottom: 10,
            fontSize: '0.7rem',
          }}>
            <div style={{ color: 'var(--green)', fontWeight: 600, marginBottom: 3 }}>✓ Handoff Complete</div>
            <div style={{ color: 'var(--text3)', fontSize: '0.62rem' }}>Client owns the site. No ongoing relationship. Reference only.</div>
          </div>
        )}

        {/* Tier 2 hosting status */}
        {tier === 2 && project.status === 'live' && (
          <div style={{ background: 'var(--surface2)', borderRadius: 'var(--r)', padding: '9px 11px', marginBottom: 10, fontSize: '0.7rem', color: 'var(--text2)' }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 5 }}>
              Hosting Status
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--green)' }}>✓ Active · $79/mo</span>
            </div>
          </div>
        )}

        {/* Action buttons — tier-aware */}
        <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
          {tier === 3 && (
            <>
              <Button variant="tier3" size="sm" onClick={onOpenMatrix}>
                + Add Pages
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onSwitchTab('reports')}>
                📊 Report
              </Button>
            </>
          )}
          {tier === 2 && (
            <Button variant="ghost" size="sm" disabled={!liveUrl} onClick={() => liveUrl && window.open(liveUrl, '_blank')}>
              View Site
            </Button>
          )}
          {tier === 1 && project.status === 'live' && (
            <Button variant="ghost" size="sm" onClick={() => showToast('Upsell flow lands in a future phase', 'default')}>
              🎯 Upsell to Tier 2
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CoverageSummaryStub({ project, onClick }: { project: Project; onClick: () => void }) {
  const built = project.pages_built ?? 0;
  const planned = Math.max(project.pages_planned ?? 0, built);
  const pct = planned > 0 ? Math.round((built / planned) * 100) : 0;

  return (
    <div className="coverage-summary" onClick={onClick} role="button">
      <div className="cov-top">
        <span className="cov-label">SEO Coverage</span>
        <span className="cov-val">{built} / {planned} pages</span>
      </div>
      <div className="cov-bar">
        <div className="cov-fill" style={{ width: `${pct}%`, background: 'var(--tier3)' }} />
      </div>
      <div className="cov-bottom">
        <span className="cov-mini-label">Click to open coverage matrix</span>
        <span className="cov-cta">View matrix →</span>
      </div>
    </div>
  );
}
