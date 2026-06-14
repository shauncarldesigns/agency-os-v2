import { useState, useEffect } from 'react';
import type { Project, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Modal, ModalHeader, ModalFooter } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

/**
 * First-time domain + Cloudflare zone setup for a project.
 *
 * Deliberately separate from the general Edit Project modal — initial DNS
 * setup is a discrete operational event with side-effects (zone created in
 * CF, records pre-populated, nameservers handed back for registrar update).
 * Putting it in the regular form would make it feel like just another
 * editable field and risk operators triggering zone creation unintentionally.
 */

interface DnsSetupModalProps {
  open: boolean;
  project: Project;
  onClose: () => void;
  showToast: ShowToast;
  /** Fired after a successful setup so the parent can refresh the project
   *  (and the sidebar's Quick Action button flips from "Add" to "Manage"). */
  onSetupComplete: () => void;
}

// Same tight apex-domain regex used by the backend. Mirrored client-side so
// the operator gets immediate feedback before submit.
const DOMAIN_RE =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function normalizeDomain(d: string): string {
  return d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export function DnsSetupModal({ open, project, onClose, showToast, onSetupComplete }: DnsSetupModalProps) {
  const [domain, setDomain] = useState('');
  const [registrar, setRegistrar] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDomain('');
    setRegistrar('');
    setOwnerEmail('');
    setError(null);
    setSubmitting(false);
  }, [open]);

  const normalized = normalizeDomain(domain);
  const domainValid = normalized.length > 0 && DOMAIN_RE.test(normalized);
  const showDomainHint = domain.trim().length > 0 && !domainValid;

  async function handleSubmit() {
    if (!domainValid) {
      setError('Enter a valid apex domain (e.g. example.com — no http://, no www, no path).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.projects.dns.setup(project.id, {
        domain: normalized,
        registrar: registrar.trim() || undefined,
        domain_owner_email: ownerEmail.trim() || undefined,
      });
      if (res.failures.length > 0) {
        // Zone created but some records didn't — operator can use Manage → Retry
        showToast(
          `Zone created for ${normalized}, but ${res.failures.length} record(s) failed. Use Manage DNS → Retry.`,
          'error'
        );
      } else {
        showToast(`Cloudflare zone created for ${normalized}. Update nameservers at your registrar.`, 'success');
      }
      onSetupComplete();
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => undefined : onClose} width={520}>
      <ModalHeader title="Add domain & DNS" onClose={onClose} />
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text2)', lineHeight: 1.5 }}>
          A Cloudflare zone will be created for this domain and pre-populated with the
          standard landingsite records (2 A records at apex + 1 CNAME on <code>www</code>,
          all with proxy off). You'll get two nameservers back to enter at the client's
          registrar.
        </p>

        <Field label="Domain *">
          <Input
            value={domain}
            onChange={setDomain}
            placeholder="example.com"
            autoFocus
            invalid={showDomainHint}
          />
          {showDomainHint && (
            <div style={{ fontSize: '0.68rem', color: 'var(--red)', marginTop: 4 }}>
              Use the apex form — no <code>http://</code>, no <code>www</code>, no trailing slash.
            </div>
          )}
        </Field>

        <Field label="Registrar (optional)">
          <Input
            value={registrar}
            onChange={setRegistrar}
            placeholder="Squarespace · GoDaddy · Namecheap…"
          />
        </Field>

        <Field label="Domain owner email (optional)">
          <Input
            value={ownerEmail}
            onChange={setOwnerEmail}
            placeholder="owner@example.com"
            type="email"
          />
        </Field>

        {error && (
          <div
            style={{
              padding: '10px 12px',
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.35)',
              borderRadius: 6,
              fontSize: '0.74rem',
              color: 'var(--red)',
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}
      </div>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={submitting || !domainValid}
        >
          {submitting ? (
            <>
              <Spinner /> Creating zone…
            </>
          ) : (
            'Create Cloudflare zone'
          )}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// Small in-file Field/Input components matching the OperatorInputForm pattern
// (uppercase muted label + surface2 input). Kept local because the same pattern
// elsewhere in the codebase is also inline rather than promoted to shared.

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: '0.62rem',
          fontWeight: 600,
          letterSpacing: '0.4px',
          color: 'var(--text3)',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  autoFocus,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        background: 'var(--surface2)',
        border: `1px solid ${invalid ? 'rgba(248,113,113,0.55)' : 'var(--border)'}`,
        borderRadius: 4,
        padding: '8px 10px',
        fontSize: '0.78rem',
        color: 'var(--text)',
        fontFamily: 'inherit',
      }}
    />
  );
}
