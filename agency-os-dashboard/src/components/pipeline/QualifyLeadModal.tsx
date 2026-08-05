import { useState, useEffect } from 'react';
import type { Lead, Project, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Modal, ModalHeader, ModalFooter } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { type Tier, TIER_LABEL, tierPriceShort } from '../../lib/pricing';

interface QualifyLeadModalProps {
  open: boolean;
  lead: Lead | null;
  onClose: () => void;
  showToast: ShowToast;
  /** Fired when the project is created. Parent should switch to Sites and
   *  open the project's Brief Studio when tier === 3 (T1/T2 have no Studio). */
  onQualified: (project: Project, tier: Tier) => void;
}

const TIER_OPTIONS: ReadonlyArray<{
  tier: Tier;
  label: string;
  price: string;
  blurb: string;
}> = [
  {
    tier: 1,
    label: TIER_LABEL[1],
    price: tierPriceShort(1),
    blurb: 'No contract. 5-page handoff site. No ongoing service.',
  },
  {
    tier: 2,
    label: TIER_LABEL[2],
    price: tierPriceShort(2),
    blurb: 'Hosting + edits. 5 pages. Month-to-month.',
  },
  {
    tier: 3,
    label: TIER_LABEL[3],
    // Qualify modal historically appends ", free build" to T3's price —
    // preserved here for byte-identical rendering.
    price: `${tierPriceShort(3)}, free build`,
    blurb: '6-mo commit. 8–10 pages at launch + 3 SEO pages/mo. Full Brief Studio.',
  },
];

export function QualifyLeadModal({
  open, lead, onClose, showToast, onQualified,
}: QualifyLeadModalProps) {
  const [tier, setTier] = useState<Tier>(3);
  const [note, setNote] = useState('');
  const [initialStatus, setInitialStatus] = useState<'building' | 'live'>('building');
  const [contractStart, setContractStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [clientEmail, setClientEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Default to the lead's recommended tier when the modal opens. Falls back to
  // T3 (which gates the Brief Studio) if no recommendation exists.
  useEffect(() => {
    if (!open || !lead) return;
    const rec = lead.recommended_tier;
    if (rec === 1 || rec === 2 || rec === 3) setTier(rec);
    else setTier(3);
    setNote('');
    setInitialStatus('building');
    setContractStart(new Date().toISOString().slice(0, 10));
    setClientEmail(lead.email ?? '');
  }, [open, lead]);

  if (!open || !lead) return null;

  async function handleSubmit() {
    if (!lead) return;
    setSubmitting(true);
    try {
      const res = await api.leads.convertToClient(lead.id, {
        tier,
        initialStatus,
        contractStart,
        clientEmail: clientEmail.trim() || undefined,
        note: note.trim() || undefined,
      });
      const label = `Tier ${tier}`;
      showToast(`${lead.company} converted to a ${label} client`, 'success');
      onQualified(res.project, tier);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Conversion failed: ${msg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => undefined : onClose} width={560}>
      <ModalHeader
        title={`Convert to client · ${lead.company}`}
        onClose={submitting ? () => undefined : onClose}
      />

      <div style={{ padding: '18px 20px', flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        <p style={{ margin: '0 0 14px', fontSize: '0.78rem', color: 'var(--text2)', lineHeight: 1.5 }}>
          Use this only after the business agrees to move forward. It creates the client project,
          carries over the outreach site and brief, stops active email automation, and moves the
          lead out of outreach in one transaction.
        </p>

        <label className="flabel" style={{ marginBottom: 8 }}>Tier</label>
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {TIER_OPTIONS.map((opt) => {
            const selected = tier === opt.tier;
            return (
              <button
                key={opt.tier}
                type="button"
                onClick={() => setTier(opt.tier)}
                disabled={submitting}
                className={`qlm-tier-card t${opt.tier} ${selected ? 'qlm-selected' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '11px 14px',
                  background: selected ? 'var(--surface2)' : 'var(--surface)',
                  border: selected
                    ? `2px solid var(--tier${opt.tier})`
                    : '1px solid var(--border)',
                  borderRadius: 'var(--r)',
                  cursor: submitting ? 'default' : 'pointer',
                  textAlign: 'left',
                  color: 'inherit',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    color: `var(--tier${opt.tier})`,
                    marginBottom: 3,
                  }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>{opt.blurb}</div>
                </div>
                <div style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: 'var(--text2)',
                  whiteSpace: 'nowrap',
                  paddingTop: 2,
                }}>
                  {opt.price}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <label>
            <span className="flabel">Starting stage</span>
            <select className="finput" value={initialStatus} onChange={(e) => setInitialStatus(e.target.value as 'building' | 'live')}>
              <option value="building">Building / onboarding</option>
              <option value="live">Already live</option>
            </select>
          </label>
          <label>
            <span className="flabel">Contract start</span>
            <input className="finput" type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} />
          </label>
        </div>

        <label className="flabel" htmlFor="convert-client-email">Report/client email</label>
        <input
          id="convert-client-email"
          className="finput"
          type="email"
          value={clientEmail}
          onChange={(e) => setClientEmail(e.target.value)}
          placeholder="client@example.com"
          style={{ marginBottom: 14 }}
        />

        <label className="flabel" htmlFor="qlm-note">Notes <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· optional</span></label>
        <textarea
          id="qlm-note"
          className="finput"
          rows={3}
          placeholder="What was agreed to? Any onboarding details to preserve."
          value={note}
          disabled={submitting}
          onChange={(e) => setNote(e.target.value)}
          style={{ resize: 'vertical', minHeight: 60, marginBottom: 4 }}
        />
        <div style={{ fontSize: '0.62rem', color: 'var(--text3)' }}>
          Saved in the conversion activity for the client timeline.
        </div>

        {tier !== 3 && (
          <div style={{
            marginTop: 12,
            padding: '8px 12px',
            background: 'rgba(245,200,66,0.06)',
            border: '1px solid rgba(245,200,66,0.2)',
            borderRadius: 8,
            fontSize: '0.7rem',
            color: 'var(--text2)',
            lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--yellow)' }}>Heads up:</strong> Tier {tier} doesn't
            include the Brief Studio. You can upsell to Tier 3 later from the Sites tab.
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? <><Spinner /> Converting…</> : `→ Convert to Tier ${tier} client`}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
