import { useState } from 'react';
import type { ProspectResult } from '../../lib/types';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { TierPill } from '../shared/TierPill';
import { stars, formatPhone, tierColor } from '../../lib/format';

interface ResultRowProps {
  result: ProspectResult;
  added: boolean;
  adding: boolean;
  onAdd: (placeId: string) => void;
}

export function ResultRow({ result, added, adding, onAdd }: ResultRowProps) {
  const [expanded, setExpanded] = useState(false);

  const tier = result.recommendedTier;
  const tierVariant = (`tier${tier}` as 'tier1' | 'tier2' | 'tier3');
  const fadeOpacity = added ? 0.3 : result.alreadyInPipeline ? 0.5 : 1;
  const isUnclaimed = !result.claimed;
  const rowBg = isUnclaimed ? 'rgba(167,139,250,0.04)' : undefined;

  function websiteCell() {
    if (!result.website) return <Badge color="red">No website</Badge>;
    // We don't have PSI yet at search-time; just show a generic "Has site"
    return <span style={{ color: 'var(--text2)', fontSize: '0.7rem' }}>{result.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>;
  }

  return (
    <>
      <tr style={{ background: rowBg, opacity: fadeOpacity, transition: 'opacity 0.3s' }}>
        <td style={{ width: 32, cursor: 'pointer' }} onClick={() => setExpanded(v => !v)}>
          <span style={{ color: 'var(--text3)', fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
        </td>
        <td className="td-co">
          {result.name}
          {result.alreadyInPipeline && !added && (
            <span style={{ marginLeft: 8, fontSize: '0.6rem', color: 'var(--text3)' }}>· in pipeline</span>
          )}
        </td>
        <td>
          <span className="score-num" style={{ color: tierColor(tier) }}>{result.opportunityScore}</span>
        </td>
        <td><TierPill tier={tier} /></td>
        <td>
          {result.claimed
            ? <span className="gbp-pill claimed">✓ Claimed</span>
            : <span className="gbp-pill unclaimed">⭐ Unclaimed</span>}
        </td>
        <td>{websiteCell()}</td>
        <td>
          {result.rating != null ? (
            <>
              <span className="stars">{stars(result.rating)}</span>{' '}
              {result.rating.toFixed(1)} ({result.reviewCount ?? 0})
            </>
          ) : <span style={{ color: 'var(--text3)' }}>—</span>}
        </td>
        <td style={{ width: 140 }}>
          {added ? (
            <Badge color="green">✓ Added</Badge>
          ) : result.alreadyInPipeline ? (
            <span style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>Already in pipeline</span>
          ) : (
            <Button
              variant={tierVariant}
              size="xs"
              disabled={adding}
              onClick={e => { e.stopPropagation(); onAdd(result.placeId); }}
            >
              {adding ? '⏳' : '+'} Add to Pipeline
            </Button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: isUnclaimed ? 'rgba(167,139,250,0.06)' : 'var(--surface2)' }}>
          <td colSpan={8} style={{ padding: 0 }}>
            <div className="expand-detail">
              <div className="detail-grid">
                <div className="detail-section">
                  <div className="detail-label" style={{ color: isUnclaimed ? 'var(--purple)' : undefined }}>
                    {isUnclaimed ? '⭐ Why this is a great target' : '🎯 Why this tier'}
                  </div>
                  <div className="detail-value">
                    {result.reasoning || 'No specific factors flagged — base score from review activity and presence.'}
                  </div>
                </div>
                <div className="detail-section">
                  <div className="detail-label">📞 Contact info</div>
                  <div className="detail-value" style={{ fontSize: '0.7rem', lineHeight: 1.6 }}>
                    {result.phone && <>Phone: {formatPhone(result.phone)}<br /></>}
                    {result.address && <>Address: {result.address}<br /></>}
                    {result.primaryType && <>Category: {result.primaryType.replace(/_/g, ' ')}<br /></>}
                    {!result.hasDescription && !result.hasHours && (
                      <span style={{ color: 'var(--text3)' }}>
                        {!result.hasDescription && 'No description · '}
                        {!result.hasHours && 'no hours set · '}
                        {result.photoCount === 0 && 'no photos'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
