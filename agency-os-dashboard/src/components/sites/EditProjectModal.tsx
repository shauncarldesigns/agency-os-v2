import { useState, useEffect } from 'react';
import type { Project, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Modal, ModalHeader, ModalFooter } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

interface EditProjectModalProps {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  showToast: ShowToast;
  /** Fired after a successful PUT. Parent reloads its list. */
  onSaved: (project: Project) => void;
  /** Fired after a successful DELETE. Parent removes the project from its
   *  view and (if it was showing the detail panel) navigates back. */
  onDeleted: (projectId: number) => void;
}

type Tier = 1 | 2 | 3;

const TIER_OPTIONS: ReadonlyArray<{
  tier: Tier;
  label: string;
  price: string;
  blurb: string;
}> = [
  { tier: 1, label: 'Tier 1 · Foundation', price: '$800 one-time', blurb: 'No ongoing service.' },
  { tier: 2, label: 'Tier 2 · Managed', price: '$79/mo', blurb: 'Hosting + edits.' },
  { tier: 3, label: 'Tier 3 · SEO Program', price: '$499/mo', blurb: 'Brief Studio + monthly SEO pages.' },
];

export function EditProjectModal({
  open, project, onClose, showToast, onSaved, onDeleted,
}: EditProjectModalProps) {
  const [tier, setTier] = useState<Tier>(3);
  const [businessName, setBusinessName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!open || !project) return;
    setTier(project.tier);
    setBusinessName(project.business_name);
    setCity(project.city ?? '');
    setState(project.state ?? '');
    setPhone(project.phone ?? '');
    setEmail(project.email ?? '');
    setConfirmingDelete(false);
  }, [open, project]);

  if (!open || !project) return null;

  const tierChanged = tier !== project.tier;
  const demotingFromT3 = project.tier === 3 && tier !== 3;
  const promotingToT3 = project.tier !== 3 && tier === 3;
  const busy = saving || deleting;

  async function handleSave() {
    if (!project) return;
    setSaving(true);
    try {
      const res = await api.projects.update(project.id, {
        tier,
        business_name: businessName.trim(),
        city: city.trim() || null,
        state: state.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
      });
      showToast(
        tierChanged ? `Project updated · now Tier ${tier}` : 'Project updated',
        'success'
      );
      onSaved(res.project);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Save failed: ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!project) return;
    setDeleting(true);
    try {
      await api.projects.delete(project.id);
      showToast(`${project.business_name} deleted — lead returned to Pipeline as 'qualified'`, 'success');
      onDeleted(project.id);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Delete failed: ${msg}`, 'error');
      setDeleting(false);
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} width={580}>
      <ModalHeader
        title={`Edit Project · ${project.business_name}`}
        onClose={busy ? () => undefined : onClose}
      />

      <div style={{ padding: '18px 20px', maxHeight: '70vh', overflowY: 'auto' }}>
        <label className="flabel" style={{ marginBottom: 8 }}>Tier</label>
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {TIER_OPTIONS.map((opt) => {
            const selected = tier === opt.tier;
            return (
              <button
                key={opt.tier}
                type="button"
                onClick={() => setTier(opt.tier)}
                disabled={busy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '10px 13px',
                  background: selected ? 'var(--surface2)' : 'var(--surface)',
                  border: selected
                    ? `2px solid var(--tier${opt.tier})`
                    : '1px solid var(--border)',
                  borderRadius: 'var(--r)',
                  cursor: busy ? 'default' : 'pointer',
                  textAlign: 'left',
                  color: 'inherit',
                  fontFamily: 'inherit',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.78rem', color: `var(--tier${opt.tier})`, marginBottom: 2 }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: '0.66rem', color: 'var(--text3)' }}>{opt.blurb}</div>
                </div>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  {opt.price}
                </div>
              </button>
            );
          })}
        </div>

        {demotingFromT3 && (
          <div style={{
            marginBottom: 14,
            padding: '8px 12px',
            background: 'rgba(245,200,66,0.06)',
            border: '1px solid rgba(245,200,66,0.2)',
            borderRadius: 8,
            fontSize: '0.7rem',
            color: 'var(--text2)',
            lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--yellow)' }}>Heads up:</strong> Demoting from Tier 3
            hides the Brief Studio. The master brief, page matrix, and brand data stay in the
            database — promoting back to Tier 3 restores access.
          </div>
        )}

        {promotingToT3 && (
          <div style={{
            marginBottom: 14,
            padding: '8px 12px',
            background: 'rgba(62,207,142,0.06)',
            border: '1px solid rgba(62,207,142,0.2)',
            borderRadius: 8,
            fontSize: '0.7rem',
            color: 'var(--text2)',
            lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--green)' }}>Upsell:</strong> Promoting to Tier 3
            unlocks the Brief Studio. Generate a master brief next to populate the page matrix.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div className="fg" style={{ gridColumn: 'span 2' }}>
            <label className="flabel">Business name</label>
            <input
              className="finput"
              value={businessName}
              disabled={busy}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </div>
          <div className="fg">
            <label className="flabel">City</label>
            <input className="finput" value={city} disabled={busy} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="fg">
            <label className="flabel">State</label>
            <input className="finput" value={state} disabled={busy} onChange={(e) => setState(e.target.value)} />
          </div>
          <div className="fg">
            <label className="flabel">Phone</label>
            <input className="finput" value={phone} disabled={busy} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="fg">
            <label className="flabel">Client email</label>
            <input className="finput" type="email" value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>

        <div style={{
          marginTop: 18,
          padding: 14,
          background: 'rgba(248,113,113,0.04)',
          border: '1px solid rgba(248,113,113,0.18)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>
            Danger zone
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text2)', lineHeight: 1.5, marginBottom: 10 }}>
            Delete this project (client churn, mistaken qualification, etc). Cascades to all
            pages, briefs, brand attributes, and testimonials. The lead returns to the Pipeline
            with status <code>qualified</code> so you can re-qualify or move on.
          </div>
          {!confirmingDelete ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
            >
              🗑 Delete project
            </Button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--red)' }}>
                Really delete {project.business_name}? This cannot be undone.
              </span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleDelete}
                disabled={busy}
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
              >
                {deleting ? <><Spinner /> Deleting…</> : 'Confirm delete'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={busy || !businessName.trim()}>
          {saving ? <><Spinner /> Saving…</> : 'Save changes'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
