import { useState } from 'react';
import type { Lead, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { ScoreHover } from '../shared/ScoreHover';
import { TierPill } from '../shared/TierPill';
import { formatPhone, scoreColor, statusBadge, outcomeBadge, tierColor } from '../../lib/format';

interface LeadsTableProps {
  leads: Lead[];
  selectedIds: Set<number>;
  onToggleSelected: (id: number) => void;
  onToggleAllVisible: (on: boolean) => void;
  showToast: ShowToast;
  onLeadUpdated: () => void;
  onOpenLead: (id: number) => void;
  onQualify: (lead: Lead) => void;
}

export function LeadsTable({
  leads, selectedIds, onToggleSelected, onToggleAllVisible,
  showToast, onLeadUpdated, onOpenLead, onQualify,
}: LeadsTableProps) {
  if (leads.length === 0) {
    return (
      <div className="twrap" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)' }}>
        No leads match the current filters.
      </div>
    );
  }

  // Header checkbox tri-state: all visible selected → checked,
  // some → indeterminate, none → unchecked.
  const visibleIds = leads.map((l) => l.id);
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleChecked = visibleSelectedCount === visibleIds.length;
  const someVisibleChecked = visibleSelectedCount > 0 && !allVisibleChecked;

  return (
    <div className="twrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                checked={allVisibleChecked}
                ref={(el) => { if (el) el.indeterminate = someVisibleChecked; }}
                onChange={(e) => onToggleAllVisible(e.target.checked)}
                title={allVisibleChecked ? 'Deselect all visible' : 'Select all visible'}
                aria-label="Select all visible leads"
              />
            </th>
            <th>Company</th>
            <th>Status</th>
            <th>Tier</th>
            <th>Score</th>
            <th>Reviews</th>
            <th>City</th>
            <th>Website</th>
            <th>Phone</th>
            <th>Outcome</th>
            <th>Stage</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {leads.map(l => (
            <LeadRow
              key={l.id}
              lead={l}
              selected={selectedIds.has(l.id)}
              onToggleSelected={onToggleSelected}
              showToast={showToast}
              onLeadUpdated={onLeadUpdated}
              onOpenLead={onOpenLead}
              onQualify={onQualify}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface LeadRowProps {
  lead: Lead;
  selected: boolean;
  onToggleSelected: (id: number) => void;
  showToast: ShowToast;
  onLeadUpdated: () => void;
  onOpenLead: (id: number) => void;
  onQualify: (lead: Lead) => void;
}

function LeadRow({
  lead, selected, onToggleSelected, showToast, onLeadUpdated, onOpenLead, onQualify,
}: LeadRowProps) {
  const [enriching, setEnriching] = useState(false);
  const stage = statusBadge(lead.status);
  const outcome = outcomeBadge(lead.outcome);

  // Row visual state varies by enrichment status
  let rowStyle: React.CSSProperties = { cursor: 'pointer' };
  if (lead.enrichment_status === 'enriching') rowStyle = { ...rowStyle, background: 'rgba(245,200,66,0.04)' };
  else if (lead.enrichment_status === 'pending') rowStyle = { ...rowStyle, opacity: 0.78 };
  else if (lead.enrichment_status === 'failed') rowStyle = { ...rowStyle, opacity: 0.6, background: 'rgba(248,113,113,0.04)' };

  const enrichmentBadge = renderEnrichmentBadge(lead);

  async function handleEnrich() {
    setEnriching(true);
    try {
      await api.leads.enrich(lead.id);
      showToast(`Enriched ${lead.company}`, 'success');
      onLeadUpdated();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Enrichment failed: ${msg}`, 'error');
    } finally {
      setEnriching(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Move "${lead.company}" to trash? You can restore it later.`)) return;
    try {
      await api.leads.delete(lead.id);
      showToast(`${lead.company} moved to trash`, 'default');
      onLeadUpdated();
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`, 'error');
    }
  }

  async function handleRestore() {
    try {
      await api.leads.restore(lead.id);
      showToast(`${lead.company} restored`, 'success');
      onLeadUpdated();
    } catch (err) {
      showToast(`Restore failed: ${(err as Error).message}`, 'error');
    }
  }

  async function handleHardDelete() {
    if (!window.confirm(
      `Permanently delete "${lead.company}"? This cannot be undone — all call history will be lost.`
    )) return;
    try {
      await api.leads.hardDelete(lead.id);
      showToast(`${lead.company} permanently deleted`, 'default');
      onLeadUpdated();
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`, 'error');
    }
  }

  // stopPropagation wrapper so action-cell clicks don't trigger the row's
  // open-modal behaviour
  const stop = (e: React.MouseEvent | React.ChangeEvent) => e.stopPropagation();

  return (
    <tr style={rowStyle} onClick={() => onOpenLead(lead.id)}>
      <td onClick={stop} style={{ width: 32, textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(lead.id)}
          onClick={stop}
          aria-label={`Select ${lead.company}`}
          title={selected ? `Deselect ${lead.company}` : `Select ${lead.company} for bulk re-enrich`}
        />
      </td>
      <td
        className="td-co"
        style={lead.status === 'dead' || lead.status === 'not_interested'
          ? { textDecoration: 'line-through', color: 'var(--text3)' }
          : undefined}
      >
        {lead.company}
      </td>
      <td>{enrichmentBadge}</td>

      {/* For enriching/pending/failed, span tier + score + reviews columns with explanatory text */}
      {lead.enrichment_status !== 'enriched' ? (
        <td colSpan={3} style={{
          color: lead.enrichment_status === 'failed' ? 'var(--red)' : 'var(--text3)',
          fontSize: '0.7rem',
          fontStyle: lead.enrichment_status === 'pending' ? 'italic' : undefined,
        }}>
          {lead.enrichment_status === 'enriching' && 'Fetching reviews, scoring website…'}
          {lead.enrichment_status === 'pending' && 'Not yet enriched'}
          {lead.enrichment_status === 'failed' && (lead.enrichment_error?.slice(0, 50) || 'Enrichment failed')}
        </td>
      ) : (
        <>
          <td>
            {lead.recommended_tier && [1, 2, 3].includes(lead.recommended_tier) ? (
              <TierPill tier={lead.recommended_tier as 1 | 2 | 3} />
            ) : <span style={{ color: 'var(--text3)' }}>—</span>}
          </td>
          <td>
            {lead.opportunity_score != null ? (
              <ScoreHover
                score={lead.opportunity_score}
                reasoning={lead.opportunity_reasoning}
                color={tierColor(lead.recommended_tier as 1 | 2 | 3 | null)}
                meta={lead.recommended_tier ? `Recommended Tier ${lead.recommended_tier}` : undefined}
              />
            ) : <span style={{ color: 'var(--text3)' }}>—</span>}
          </td>
          <td>{renderReviewsCell(lead)}</td>
        </>
      )}

      <td>{lead.city ?? <span style={{ color: 'var(--text3)' }}>—</span>}</td>
      <td onClick={stop}>{renderWebsiteCell(lead)}</td>
      <td className="td-mono" style={lead.enrichment_status === 'enriching' ? { opacity: 0.7 } : lead.enrichment_status === 'failed' ? { color: 'var(--text3)' } : undefined}>
        {formatPhone(lead.phone)}
      </td>
      <td><Badge color={outcome.color}>{outcome.label}</Badge></td>
      <td><Badge color={stage.color}>{stage.label}</Badge></td>
      <td onClick={stop}>
        <div style={{ display: 'flex', gap: 5 }}>
          {lead.enrichment_status === 'enriched'
            && lead.status !== 'qualified'
            && lead.status !== 'client'
            && lead.status !== 'not_interested'
            && lead.status !== 'dead'
            && !lead.deleted_at && (
              <Button
                variant="primary"
                size="xs"
                onClick={() => onQualify(lead)}
                title="Book a demo — creates a Sites prospect project at the chosen tier so Quick Brief is available for demo prep"
              >
                → Book demo
              </Button>
          )}
          {lead.enrichment_status === 'pending' && (
            <Button variant="primary" size="xs" disabled={enriching} onClick={handleEnrich}>
              {enriching ? '⏳' : '✦'} Enrich
            </Button>
          )}
          {lead.enrichment_status === 'enriching' && (
            <Button variant="ghost" size="xs" disabled>⌛ Wait</Button>
          )}
          {lead.enrichment_status === 'failed' && (
            <Button variant="ghost" size="xs" disabled={enriching} onClick={handleEnrich}>↻ Retry</Button>
          )}
          {lead.deleted_at ? (
            <>
              <Button variant="ghost" size="xs" onClick={handleRestore} title="Restore from trash">↺ Restore</Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleHardDelete}
                title="Permanently delete — cannot be undone"
                style={{ color: 'var(--red)' }}
              >
                🗑 Delete forever
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="xs" onClick={handleDelete} title="Move to trash">🗑</Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// Reviews cell. Shows Google review count + average rating — a quick signal
// for "is this lead worth calling." A high count with a strong rating means
// a real, established business with an online footprint; a low count or no
// rating means either a new business or a poor Places match. Always
// rendered for enriched leads only (the colSpan above covers the rest).
function renderReviewsCell(lead: Lead): React.ReactNode {
  const count = lead.google_review_count;
  const rating = lead.google_rating;
  if (count == null && rating == null) {
    return <span style={{ color: 'var(--text3)' }}>—</span>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }}>
      <span style={{ fontWeight: 600 }}>{count ?? 0}</span>
      {rating != null && (
        <span style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>
          · {rating.toFixed(1)}★
        </span>
      )}
    </span>
  );
}

// Website cell. No-website leads are the priority targets, so they get a
// prominent "No site" badge; leads with a site show a muted clickable domain.
// Only enriched leads have a reliable website signal — for everything else we
// don't yet know, so show a neutral dash rather than a misleading "No site".
function renderWebsiteCell(lead: Lead): React.ReactNode {
  if (lead.enrichment_status !== 'enriched') {
    return <span style={{ color: 'var(--text3)' }}>—</span>;
  }
  if (lead.website) {
    const href = lead.website.startsWith('http') ? lead.website : `https://${lead.website}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="td-mono"
        style={{ color: 'var(--text3)', textDecoration: 'none' }}
        title={lead.website}
      >
        {cleanDomain(lead.website)} ↗
      </a>
    );
  }
  return <Badge color="blue">No site</Badge>;
}

// Strip protocol, www., and trailing path so the column stays scannable.
function cleanDomain(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '');
}

function renderEnrichmentBadge(lead: Lead): React.ReactNode {
  switch (lead.enrichment_status) {
    case 'enriched':
      return <span className="enrich-badge enriched">✓ Enriched</span>;
    case 'enriching':
      return <span className="enrich-badge enriching"><span className="enrich-spin">⚙</span> Enriching…</span>;
    case 'pending':
      return <span className="enrich-badge pending">⏳ Pending</span>;
    case 'failed':
      return <span className="enrich-badge failed">⚠ Failed</span>;
    default:
      return <span className="enrich-badge pending">{lead.enrichment_status}</span>;
  }
}

// Re-export so the parent can show the score color helper if needed
export { scoreColor };
