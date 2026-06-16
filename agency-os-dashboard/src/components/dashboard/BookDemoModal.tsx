import { useState, useEffect, useRef } from 'react';
import type { Lead, ShowToast } from '../../lib/types';
import { Modal, ModalHeader, ModalFooter } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { formatPhone } from '../../lib/format';

/**
 * Split-pane booking modal.
 *
 * Left pane — Lead summary with per-field copy-to-clipboard buttons, the
 * date/time the prospect agreed to, and a "Mark booked" CTA.
 *
 * Right pane — Embedded HoneyBook form. The HB controller script is injected
 * once globally (see ensureHoneyBookScript below) and finds the placeholder
 * div on render. The Phase 1 spike confirmed this works in our CSS-toggle
 * modal pattern — see honeybook-spike.html for the test harness.
 *
 * Operator flow:
 *   1. Operator quickly tells the prospect their info — uses copy buttons
 *      to paste into HoneyBook quickly.
 *   2. Enters the agreed datetime in the small picker on the left.
 *   3. Submits HoneyBook (right pane).
 *   4. Clicks "Mark booked" — writes a demos row and advances the session.
 */

interface BookDemoModalProps {
  open: boolean;
  lead: Lead | null;
  /** Called when the operator confirms the booking. Phase-5 wired this to the
   *  execution view's outcome handler — receives the scheduled datetime in
   *  ISO + whether the operator confirmed the HoneyBook form was submitted. */
  onConfirm: (scheduledFor: string, honeybookConfirmed: boolean) => Promise<void> | void;
  onClose: () => void;
  showToast: ShowToast;
}

// The HoneyBook placement ID powering the embed. Keep in sync with
// honeybook-spike.html and any future HB integration changes.
const HB_PLACEMENT_ID = '69d52358032fd10030b4783f';
const HB_CONTROLLER_SRC =
  'https://widget.honeybook.com/assets_users_production/websiteplacements/placement-controller.min.js';

/**
 * Inject the HoneyBook controller script exactly once on the page. Mirrors
 * the pattern from the spec snippet but wrapped in a ref-guard so StrictMode
 * double-mount + multiple modal opens don't double-init the controller.
 */
function ensureHoneyBookScript() {
  const w = window as unknown as { _HB_?: { pid?: string; __scriptInjected?: boolean } };
  w._HB_ = w._HB_ ?? {};
  w._HB_.pid = HB_PLACEMENT_ID;
  if (w._HB_.__scriptInjected) return;
  w._HB_.__scriptInjected = true;
  const t = document.createElement('script');
  t.type = 'text/javascript';
  t.async = true;
  t.src = HB_CONTROLLER_SRC;
  const e = document.getElementsByTagName('script')[0];
  e?.parentNode?.insertBefore(t, e);
}

export function BookDemoModal({ open, lead, onConfirm, onClose, showToast }: BookDemoModalProps) {
  const [scheduledFor, setScheduledFor] = useState(defaultDateTimeLocal());
  const [honeybookConfirmed, setHoneybookConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Track which field was just copied so we can render an inline ✓ briefly.
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    ensureHoneyBookScript();
    setScheduledFor(defaultDateTimeLocal());
    setHoneybookConfirmed(false);
  }, [open]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  if (!lead) return null;

  function copy(field: string, value: string | null | undefined) {
    if (!value) return;
    void navigator.clipboard.writeText(value);
    setCopied(field);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1200);
  }

  async function handleSubmit() {
    if (!scheduledFor) {
      showToast('Enter the agreed date/time first', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const iso = new Date(scheduledFor).toISOString();
      await onConfirm(iso, honeybookConfirmed);
      onClose();
    } catch (err) {
      showToast(`Could not record booking: ${(err as Error).message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => undefined : onClose} width={1040}>
      <ModalHeader title={`Book demo · ${lead.company}`} onClose={submitting ? () => undefined : onClose} />
      <div style={{
        display: 'grid',
        gridTemplateColumns: '340px 1fr',
        gap: 0,
        minHeight: 540,
        maxHeight: '75vh',
      }}>
        {/* LEFT PANE — copy fields + date picker */}
        <div style={{
          padding: 18,
          borderRight: '1px solid var(--border)',
          background: 'var(--surface2)',
          overflowY: 'auto',
        }}>
          <SectionTitle>Lead info</SectionTitle>
          <p style={{ fontSize: '0.68rem', color: 'var(--text3)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Click a field to copy. Paste into HoneyBook on the right.
          </p>

          <CopyField label="Company" value={lead.company} copied={copied === 'company'} onCopy={() => copy('company', lead.company)} />
          <CopyField label="Contact name" value={lead.contact ?? ''} copied={copied === 'contact'} onCopy={() => copy('contact', lead.contact)} />
          <CopyField label="Phone" value={lead.phone ? formatPhone(lead.phone) : ''} copied={copied === 'phone'} onCopy={() => copy('phone', lead.phone)} />
          <CopyField label="Email" value={lead.email ?? ''} copied={copied === 'email'} onCopy={() => copy('email', lead.email)} />
          <CopyField label="City / State" value={[lead.city, lead.state].filter(Boolean).join(', ')} copied={copied === 'where'} onCopy={() => copy('where', [lead.city, lead.state].filter(Boolean).join(', '))} />

          <div style={{ marginTop: 18 }}>
            <Button variant="ghost" size="xs" onClick={() => {
              const block = [
                lead.company,
                lead.contact ?? '',
                lead.phone ? formatPhone(lead.phone) : '',
                lead.email ?? '',
                [lead.city, lead.state].filter(Boolean).join(', '),
              ].filter(Boolean).join('\n');
              void navigator.clipboard.writeText(block);
              showToast('All fields copied', 'success');
            }}>
              📋 Copy all fields
            </Button>
          </div>

          <SectionTitle style={{ marginTop: 22 }}>Booking</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={fieldLabelStyle}>Scheduled for (your local time)</div>
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                style={inputStyle}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.74rem', color: 'var(--text2)' }}>
              <input
                type="checkbox"
                checked={honeybookConfirmed}
                onChange={(e) => setHoneybookConfirmed(e.target.checked)}
              />
              <span>HoneyBook form submitted</span>
            </label>
          </div>
        </div>

        {/* RIGHT PANE — HoneyBook embed */}
        <div style={{
          padding: 18,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <SectionTitle>HoneyBook form</SectionTitle>
          <p style={{ fontSize: '0.68rem', color: 'var(--text3)', margin: '0 0 8px', lineHeight: 1.5 }}>
            Fill the form using the copy buttons on the left. The form takes a second to load on
            first open. Tick "HoneyBook form submitted" after you hit submit.
          </p>
          <div style={{
            flex: 1,
            background: 'white',
            border: '1px solid var(--border)',
            borderRadius: 4,
            minHeight: 420,
            overflow: 'hidden',
          }}>
            {/* Placeholder div — HB controller scans for this class name and
                injects the iframe. Class name must match HB_PLACEMENT_ID. */}
            <div className={`hb-p-${HB_PLACEMENT_ID}-2`} style={{ width: '100%', height: '100%' }} />
            {/* Tracking pixel per the snippet — adds a 1x1 invisible image. */}
            <img height={1} width={1} alt="" style={{ display: 'none' }}
                 src={`https://www.honeybook.com/p.png?pid=${HB_PLACEMENT_ID}`} />
          </div>
        </div>
      </div>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting}>
          {submitting ? <><Spinner /> Recording…</> : '✓ Mark booked & advance'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ---------- small helpers ----------

function SectionTitle({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: '0.62rem',
      fontWeight: 700,
      letterSpacing: '0.5px',
      color: 'var(--text3)',
      textTransform: 'uppercase',
      marginBottom: 8,
      ...style,
    }}>{children}</div>
  );
}

function CopyField({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={fieldLabelStyle}>{label}</div>
      <button
        type="button"
        onClick={onCopy}
        disabled={!value}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '7px 10px',
          fontSize: '0.78rem',
          color: 'var(--text)',
          fontFamily: 'inherit',
          cursor: value ? 'pointer' : 'default',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          opacity: value ? 1 : 0.5,
        }}
        title={value ? 'Click to copy' : '(empty)'}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || '—'}
        </span>
        <span style={{ fontSize: '0.65rem', color: copied ? 'var(--green)' : 'var(--text3)', flexShrink: 0 }}>
          {copied ? '✓ Copied' : '📋'}
        </span>
      </button>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '0.58rem',
  fontWeight: 700,
  letterSpacing: '0.4px',
  color: 'var(--text3)',
  textTransform: 'uppercase',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '7px 10px',
  fontSize: '0.78rem',
  color: 'var(--text)',
  fontFamily: 'inherit',
};

function defaultDateTimeLocal(): string {
  const d = new Date();
  d.setHours(d.getHours() + 24, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
