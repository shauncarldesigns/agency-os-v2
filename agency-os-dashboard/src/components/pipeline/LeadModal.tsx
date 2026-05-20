import { useState, useEffect } from 'react';
import type { Lead, CallEntry, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Modal } from '../shared/Modal';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { TierPill } from '../shared/TierPill';
import { Spinner } from '../shared/Spinner';
import { CallLogTab } from './CallLogTab';
import { formatPhone, parseList, stars } from '../../lib/format';

type LMTab = 'overview' | 'reviews' | 'pitch' | 'call';

interface LeadModalProps {
  open: boolean;
  leadId: number | null;
  onClose: () => void;
  showToast: ShowToast;
  onLeadUpdated: () => void;
  onBuildSite: (lead: Lead) => void;
}

interface LeadDetail {
  lead: Lead;
  calls: CallEntry[];
}

export function LeadModal({ open, leadId, onClose, showToast, onLeadUpdated, onBuildSite }: LeadModalProps) {
  const [tab, setTab] = useState<LMTab>('overview');
  const [data, setData] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || leadId == null) {
      setData(null);
      return;
    }
    loadLead(leadId);
    setTab('overview');
  }, [open, leadId]);

  async function loadLead(id: number) {
    setLoading(true);
    try {
      const res = await api.leads.get(id);
      setData(res);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load lead: ${msg}`, 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(field: 'status' | 'outcome', value: string) {
    if (!data) return;
    const original = data.lead;
    setData({ ...data, lead: { ...original, [field]: value as Lead['status'] | string } });
    try {
      await api.leads.update(original.id, { [field]: value } as Partial<Lead>);
      onLeadUpdated();
    } catch (err) {
      setData({ ...data, lead: original }); // rollback
      showToast(`Update failed: ${(err as Error).message}`, 'error');
    }
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} width={620}>
      {loading || !data ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)' }}>
          <Spinner /> Loading lead…
        </div>
      ) : (
        <LeadModalBody
          detail={data}
          tab={tab}
          setTab={setTab}
          onClose={onClose}
          onStatusChange={handleStatusChange}
          onCallsChanged={() => loadLead(data.lead.id)}
          onBuildSite={onBuildSite}
          showToast={showToast}
        />
      )}
    </Modal>
  );
}

interface LeadModalBodyProps {
  detail: LeadDetail;
  tab: LMTab;
  setTab: (t: LMTab) => void;
  onClose: () => void;
  onStatusChange: (field: 'status' | 'outcome', value: string) => void;
  onCallsChanged: () => void;
  onBuildSite: (lead: Lead) => void;
  showToast: ShowToast;
}

function LeadModalBody({
  detail, tab, setTab, onClose, onStatusChange, onCallsChanged, onBuildSite, showToast,
}: LeadModalBodyProps) {
  const { lead, calls } = detail;
  const tier = lead.recommended_tier && [1, 2, 3].includes(lead.recommended_tier)
    ? (lead.recommended_tier as 1 | 2 | 3)
    : null;
  const reviewCount = lead.google_review_count ?? 0;

  return (
    <>
      <div className="lm-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div className="lm-name">{lead.company.toUpperCase()}</div>
            <div style={{ display: 'flex', gap: 7, marginTop: 7, flexWrap: 'wrap', alignItems: 'center' }}>
              {lead.industry && <Badge color="blue">🏠 {lead.industry}</Badge>}
              {lead.google_rating != null && (
                <Badge color="yellow">★ {lead.google_rating.toFixed(1)} ({reviewCount} reviews)</Badge>
              )}
              {(lead.city || lead.state) && (
                <span style={{ color: 'var(--text3)', fontSize: '0.66rem' }}>
                  📍 {[lead.city, lead.state].filter(Boolean).join(', ')}
                </span>
              )}
            </div>
          </div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
      </div>

      {tier && (
        <div className={`lm-tier-banner t${tier}`}>
          <div className="lm-tier-text">
            ⭐ <strong>Recommended: Tier {tier}</strong>
            {lead.opportunity_score != null && <> — score {lead.opportunity_score}</>}
          </div>
          <TierPill tier={tier} />
        </div>
      )}

      <div className="lm-tabs">
        <button type="button" className={`lm-tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" className={`lm-tab ${tab === 'reviews' ? 'active' : ''}`} onClick={() => setTab('reviews')}>
          Reviews{reviewCount ? ` (${reviewCount})` : ''}
        </button>
        <button type="button" className={`lm-tab ${tab === 'pitch' ? 'active' : ''}`} onClick={() => setTab('pitch')}>Pitch Prep</button>
        <button type="button" className={`lm-tab ${tab === 'call' ? 'active' : ''}`} onClick={() => setTab('call')}>
          Call Log {calls.length > 0 && (
            <span style={{ background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: '0.55rem', fontWeight: 700, padding: '1px 6px', borderRadius: 8, marginLeft: 4 }}>
              {calls.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'overview' && <OverviewPane lead={lead} onStatusChange={onStatusChange} />}
      {tab === 'reviews' && <ReviewsPane lead={lead} />}
      {tab === 'pitch' && <PitchPrepPane lead={lead} />}
      {tab === 'call' && (
        <CallLogTab
          leadId={lead.id}
          calls={calls}
          showToast={showToast}
          onCallsChanged={onCallsChanged}
        />
      )}

      <div style={{ padding: '13px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        {tier && lead.status !== 'client' && lead.status !== 'dead' && (
          <Button
            variant={`tier${tier}` as 'tier1' | 'tier2' | 'tier3'}
            onClick={() => { onBuildSite(lead); onClose(); }}
          >
            ⚡ Build Tier {tier} Site
          </Button>
        )}
      </div>
    </>
  );
}

// --- Tab panes ---

const PANE_STYLE: React.CSSProperties = { padding: '18px 20px', maxHeight: '50vh', overflowY: 'auto' };

function OverviewPane({ lead, onStatusChange }: { lead: Lead; onStatusChange: (field: 'status' | 'outcome', value: string) => void }) {
  const services = parseList<string>(lead.extracted_services);
  const areas = parseList<string>(lead.extracted_service_areas);
  const ownerNames = parseList<string>(lead.owner_names);

  return (
    <div style={PANE_STYLE}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div className="fg">
          <label className="flabel">Phone</label>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.95rem', color: 'var(--accent)', fontWeight: 500 }}>
            {formatPhone(lead.phone) || '—'}
          </div>
        </div>
        <div className="fg">
          <label className="flabel">Existing Website</label>
          <div style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>
            {lead.website ? (
              <>
                <a href={lead.website} target="_blank" rel="noreferrer" style={{ color: 'var(--text2)' }}>{lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>
                {lead.pagespeed_mobile != null && (
                  <Badge color={lead.pagespeed_mobile < 50 ? 'red' : lead.pagespeed_mobile < 70 ? 'yellow' : 'green'}>PSI {lead.pagespeed_mobile}</Badge>
                )}
              </>
            ) : <span style={{ color: 'var(--text3)' }}>None</span>}
          </div>
        </div>
        <div className="fg">
          <label className="flabel">GBP Status</label>
          <div style={{ fontSize: '0.78rem', color: lead.gbp_claimed ? 'var(--green)' : 'var(--purple)' }}>
            {lead.gbp_claimed ? '✓ Claimed' : '⭐ Unclaimed'}
            {lead.gbp_photos_count != null && <> · {lead.gbp_photos_count} photos</>}
          </div>
        </div>
        <div className="fg">
          <label className="flabel">Owner Names (mined)</label>
          <div style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>
            {ownerNames.length > 0 ? ownerNames.join(', ') : <span style={{ color: 'var(--text3)' }}>—</span>}
          </div>
        </div>
      </div>

      {areas.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <label className="flabel">Service Areas Detected</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
            {areas.map(a => <span key={a} className="detail-tag review-found">{a}</span>)}
          </div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text3)', marginTop: 4 }}>
            {areas.length} {areas.length === 1 ? 'area' : 'areas'} mined from reviews
          </div>
        </div>
      )}

      {services.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <label className="flabel">Services Detected</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
            {services.map(s => <span key={s} className="detail-tag review-found">{s}</span>)}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="fg">
          <label className="flabel">Outcome</label>
          <select className="finput" value={lead.outcome ?? ''} onChange={e => onStatusChange('outcome', e.target.value)}>
            <option value="">—</option>
            <option>No Answer</option>
            <option>Voicemail Left</option>
            <option>Spoke with Owner</option>
            <option>Callback Requested</option>
            <option>Not Interested</option>
            <option>Interested</option>
            <option>Qualified for Tier</option>
          </select>
        </div>
        <div className="fg">
          <label className="flabel">Stage</label>
          <select className="finput" value={lead.status} onChange={e => onStatusChange('status', e.target.value)}>
            <option value="cold">Cold</option>
            <option value="contacted">Contacted</option>
            <option value="qualified">Qualified</option>
            <option value="client">Client</option>
            <option value="dead">Dead</option>
          </select>
        </div>
      </div>
    </div>
  );
}

interface RawReview { author: string; rating: number; text: string; relativeTime?: string; publishTime?: string }
interface PitchQuote { author: string; location?: string; quote: string; why?: string }

function ReviewsPane({ lead }: { lead: Lead }) {
  const reviews = parseList<RawReview>(lead.google_reviews);
  const pitchQuotes = parseList<PitchQuote>(lead.pitch_quotes);
  const pitchTexts = new Set(pitchQuotes.map(p => p.quote));

  if (reviews.length === 0) {
    return (
      <div style={PANE_STYLE}>
        <div style={{ textAlign: 'center', color: 'var(--text3)', padding: '24px 0', fontSize: '0.74rem' }}>
          No reviews on file. Run enrichment to fetch them from Google Places.
        </div>
      </div>
    );
  }

  return (
    <div style={PANE_STYLE}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text3)', marginBottom: 10 }}>
        Showing {reviews.length} review{reviews.length === 1 ? '' : 's'}
        {lead.google_rating && <> · {lead.google_rating.toFixed(1)} avg ★</>}
      </div>
      {reviews.map((r, i) => {
        const isPitch = pitchTexts.has(r.text);
        return (
          <div key={i} className="review-card">
            <div className="review-header">
              <span className="review-author">{r.author}</span>
              <span className="review-meta">{r.relativeTime ?? ''}</span>
            </div>
            <div className="review-stars">{stars(r.rating)}</div>
            <div className={`review-text ${isPitch ? 'pitch-quote' : ''}`} style={{ marginTop: 5 }}>
              {r.text}
            </div>
            {isPitch && <span className="review-tag">⭐ Pitch quote</span>}
          </div>
        );
      })}
    </div>
  );
}

function PitchPrepPane({ lead }: { lead: Lead }) {
  const pitchQuotes = parseList<PitchQuote>(lead.pitch_quotes);
  const strengths = parseList<string>(lead.extracted_strengths);
  const areas = parseList<string>(lead.extracted_service_areas);

  if (lead.enrichment_status !== 'enriched') {
    return (
      <div style={PANE_STYLE}>
        <div style={{ textAlign: 'center', color: 'var(--text3)', padding: '24px 0', fontSize: '0.74rem' }}>
          Pitch ammo is generated during enrichment. Run enrichment on this lead first.
        </div>
      </div>
    );
  }

  const tier = lead.recommended_tier ?? 1;
  const tierCopy: Record<number, string> = {
    1: '$800 one-time, no contract. Quick foundation site — 5 pages, complete handoff.',
    2: '$400 build + $79/mo. Hosting + edits handled. 5 pages, no contract beyond month-to-month.',
    3: '$499/mo, free build, 6-month commitment. 8-10 pages at launch + 3 SEO service-area pages every month.',
  };

  return (
    <div style={PANE_STYLE}>
      <div className="call-prep" style={{ border: 'none', padding: 0, background: 'transparent' }}>
        {areas.length > 0 && (
          <div className="cp-section">
            <div className="cp-label">🎯 Opening line</div>
            <div className="cp-content">
              "Hi{ownerSalutation(lead)} — I see you've been getting customers in {areas.slice(0, 3).join(', ')}{areas.length > 3 ? '…' : ''} from your reviews
              {lead.gbp_claimed === 0 ? ', but your Google Business Profile is unclaimed.' : `, but your Google profile only highlights ${lead.city ?? 'one area'}.`}"
            </div>
          </div>
        )}

        {pitchQuotes.length > 0 && (
          <div className="cp-section">
            <div className="cp-label">💎 Pitch ammo</div>
            <div className="cp-content">
              {pitchQuotes.slice(0, 2).map((q, i) => (
                <div key={i} style={{ marginBottom: i < 1 ? 8 : 0 }}>
                  "{q.quote}" — {q.author}{q.location ? `, ${q.location}` : ''}
                  {q.why && <div style={{ fontSize: '0.65rem', color: 'var(--text3)', marginTop: 2 }}>↳ {q.why}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="cp-section">
          <div className="cp-label">⚠ Their pain points</div>
          <div className="cp-content">
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {!lead.gbp_claimed && <li>Unclaimed Google Business Profile</li>}
              {lead.pagespeed_mobile != null && lead.pagespeed_mobile < 50 && (
                <li>Mobile site loads slow (PSI {lead.pagespeed_mobile})</li>
              )}
              {!lead.website && <li>No website — losing leads to competitors who have one</li>}
              {areas.length > 1 && <li>Service in {areas.length} cities, but only {lead.city ?? 'one'} has dedicated SEO presence</li>}
              {strengths.slice(0, 2).map(s => <li key={s}>Customers love: {s.toLowerCase()} (use this in copy)</li>)}
            </ul>
          </div>
        </div>

        <div className="cp-section">
          <div className="cp-label">💰 The pitch · Tier {tier}</div>
          <div className="cp-content">{tierCopy[tier]}</div>
        </div>
      </div>
    </div>
  );
}

function ownerSalutation(lead: Lead): string {
  const owners = parseList<string>(lead.owner_names);
  return owners[0] ? ` ${owners[0]}` : '';
}
