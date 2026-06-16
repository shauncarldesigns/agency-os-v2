import { useState } from 'react';
import type { Project, ShowToast, Tab } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Button } from '../shared/Button';
import { TierPill } from '../shared/TierPill';
import { formatDate } from '../../lib/format';
import { TIER_MRR } from '../../lib/pricing';

interface SiteCardProps {
  project: Project;
  showToast: ShowToast;
  onSwitchTab: (tab: Tab) => void;
  /** Open the Brief Studio detail (Tier 3 only — Tier 1/2 cards short-circuit
   *  this to Edit Info instead). */
  onOpenDetail: () => void;
  /** Open the Edit Project modal (tier change / business info / delete). */
  onEditInfo: () => void;
  /** Open the Quick Brief modal — business name + reviews verbatim, for the
   *  pre-call landingsite paste. Available on every tier. */
  onQuickBrief: () => void;
  /** Called after the project's status has been flipped via the card's
   *  "Mark as Active Client" action so the parent can reload the projects
   *  list and refresh stats/MRR. */
  onProjectChanged: () => void;
}

export function SiteCard({
  project, onSwitchTab, onOpenDetail, onEditInfo, onQuickBrief, onProjectChanged, showToast,
}: SiteCardProps) {
  const tier = project.tier;
  const liveUrl = project.custom_domain ?? project.landingsite_url;
  const isBuilding = project.status === 'building';
  const isProspect = project.status === 'prospect';
  const mrr = TIER_MRR[tier] ?? 0;
  const pagesBuilt = project.pages_built ?? 0;
  const monthlyTarget = project.monthly_pages_target ?? (tier === 3 ? 5 : 0);
  const hasBriefStudio = tier === 3;
  const [signing, setSigning] = useState(false);

  const subtitle = (() => {
    const where = [project.city, project.state].filter(Boolean).join(', ');
    if (isProspect) return `${where} · Prospect (qualified, not yet signed)`;
    if (project.contract_start) {
      return `${where} · Client since ${formatDate(project.contract_start, { year: 'numeric', month: 'short' })}`;
    }
    return `${where} · ${project.status === 'building' ? 'Just signed' : project.status}`;
  })();

  async function handleMarkActive() {
    if (signing) return;
    setSigning(true);
    try {
      await api.projects.update(project.id, {
        status: 'building',
        contract_start: new Date().toISOString(),
      });
      showToast(`${project.business_name} marked as active client`, 'success');
      onProjectChanged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not mark active: ${msg}`, 'error');
    } finally {
      setSigning(false);
    }
  }

  // Demo happened, prospect declined. Project becomes a 'dead' historical
  // record and the lead returns to 'contacted' so they can be re-engaged.
  // Destructive enough to warrant a confirm dialog — the project leaves
  // the active Sites view immediately.
  async function handleDemoPassed() {
    if (signing) return;
    const confirmed = window.confirm(
      `Mark "${project.business_name}" as demo passed?\n\n` +
      `The project will be archived as 'dead' (kept for audit), and the lead ` +
      `returns to the calling pipeline as 'contacted' so you can re-engage later.`
    );
    if (!confirmed) return;
    setSigning(true);
    try {
      await api.projects.demoPassed(project.id);
      showToast(`${project.business_name} archived — lead returned to pipeline`, 'default');
      onProjectChanged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not mark demo passed: ${msg}`, 'error');
    } finally {
      setSigning(false);
    }
  }

  // Tier 3 → header opens Brief Studio (existing behaviour).
  // Tier 1/2 → no Brief Studio exists; header opens Edit Info instead so the
  // card still has a primary action and the operator can upsell from here.
  const headerAction = hasBriefStudio ? onOpenDetail : onEditInfo;
  const headerTitle = hasBriefStudio ? 'Open Brief Studio' : 'Edit project info';

  return (
    <div className={`scard2 t${tier}`}>
      <div
        className="scard-header"
        onClick={headerAction}
        role="button"
        title={headerTitle}
        style={{ cursor: 'pointer' }}
      >
        <div>
          <div className="scard-title">{project.business_name}</div>
          <div className="scard-sub">{subtitle}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isProspect && (
            <span
              style={{
                fontSize: '0.6rem',
                fontWeight: 700,
                letterSpacing: '0.5px',
                color: 'var(--yellow)',
                background: 'rgba(245,200,66,0.1)',
                border: '1px solid rgba(245,200,66,0.3)',
                padding: '2px 7px',
                borderRadius: 999,
                textTransform: 'uppercase',
              }}
              title="Qualified for pitch, not yet signed. Excluded from MRR."
            >
              📝 Prospect
            </span>
          )}
          <TierPill tier={tier} />
        </div>
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

        <div style={{ display: 'flex', gap: 7, marginTop: 12, flexWrap: 'wrap' }}>
          {/* Prospects get a dedicated "they signed!" button at the top of
              the action row. Once flipped, the card becomes a regular active
              client and this button stops rendering. */}
          {isProspect && (
            <>
              <Button variant="primary" size="sm" onClick={handleMarkActive} disabled={signing}
                      title="They signed. Move to active client status — counts toward MRR.">
                {signing ? '⏳ Marking…' : '✓ Mark as active client'}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDemoPassed} disabled={signing}
                      title="The demo happened and they declined. Archive the project and send the lead back to the pipeline."
                      style={{ color: 'var(--red)' }}>
                ✗ Demo passed
              </Button>
            </>
          )}
          {hasBriefStudio ? (
            <>
              {!isProspect && (
                <Button variant="primary" size="sm" onClick={onOpenDetail}>
                  📋 Brief Studio
                </Button>
              )}
              {isProspect && (
                <Button variant="ghost" size="sm" onClick={onOpenDetail}>
                  📋 Brief Studio
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onQuickBrief} title="Business + reviews verbatim, for the pre-call landingsite paste">
                ⚡ Quick brief
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onSwitchTab('reports')}>
                📈 Report
              </Button>
              <Button variant="ghost" size="sm" onClick={onEditInfo}>
                ✎ Edit
              </Button>
            </>
          ) : (
            <>
              {!isProspect && (
                <Button variant="primary" size="sm" onClick={onEditInfo}>
                  ✎ Edit Info
                </Button>
              )}
              {isProspect && (
                <Button variant="ghost" size="sm" onClick={onEditInfo}>
                  ✎ Edit
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onQuickBrief} title="Business + reviews verbatim, for the pre-call landingsite paste">
                ⚡ Quick brief
              </Button>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: '0.62rem',
                color: 'var(--text3)',
                fontStyle: 'italic',
              }}>
                Upgrade to Tier 3 for Brief Studio
              </span>
            </>
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
