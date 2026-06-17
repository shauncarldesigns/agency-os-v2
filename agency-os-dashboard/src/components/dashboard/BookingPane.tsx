import { useState, useEffect, useRef } from 'react';
import type { Lead, ShowToast } from '../../lib/types';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { InlineEditField } from '../shared/InlineEditField';
import { formatPhone } from '../../lib/format';

/**
 * Inline booking pane — lives inside the ExecutionView's main column when
 * the operator picks the "Booked demo" outcome. Replaces the old
 * BookDemoModal (which created an awkward modal-on-page stacking).
 *
 * Layout: lead-info copy buttons + booking form fields stacked above the
 * HoneyBook embed. Single column so the embedded iframe gets full width.
 */

interface BookingPaneProps {
  lead: Lead;
  showToast: ShowToast;
  /** Called when operator hits "Mark booked & advance" — same signature as
   *  the old BookDemoModal's onConfirm. */
  onConfirm: (scheduledFor: string, honeybookConfirmed: boolean) => Promise<void> | void;
  /** Called when operator hits "← Back to outcomes" — returns to the
   *  outcome buttons without writing anything. */
  onCancel: () => void;
  /** Persist an inline edit on the active lead. Mirrors the cockpit
   *  header — owner name / email captured here update the lead record
   *  and propagate everywhere else (Pipeline modal, BookingPane copy
   *  fields, etc). */
  onLeadFieldUpdate?: (field: 'contact' | 'email', value: string | null) => Promise<void> | void;
}

// The HoneyBook placement ID driving the embed. Same as the original modal.
const HB_PLACEMENT_ID = '69d52358032fd10030b4783f';
const HB_CONTROLLER_SRC =
  'https://widget.honeybook.com/assets_users_production/websiteplacements/placement-controller.min.js';

// One-time script injection. Ref-guarded so StrictMode double-mount + repeated
// session opens don't double-init the controller. Mirrors the original modal.
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

export function BookingPane({ lead, showToast, onConfirm, onCancel, onLeadFieldUpdate }: BookingPaneProps) {
  const [scheduledFor, setScheduledFor] = useState(defaultDateTimeLocal());
  const [honeybookConfirmed, setHoneybookConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inject the HB controller on mount; reset booking-time state when lead changes.
  useEffect(() => {
    ensureHoneyBookScript();
  }, []);

  useEffect(() => {
    setScheduledFor(defaultDateTimeLocal());
    setHoneybookConfirmed(false);
    setCopied(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

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
    } catch (err) {
      showToast(`Could not record booking: ${(err as Error).message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Top bar — back affordance */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            background: 'transparent', border: 'none', color: 'var(--text2)',
            fontSize: '0.78rem', cursor: 'pointer', padding: 0,
            fontFamily: 'inherit',
          }}
        >
          ← Back to outcomes
        </button>
        <div style={{
          fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.5px',
          color: '#4ade80', textTransform: 'uppercase',
        }}>
          ✓ Booking demo with {lead.company}
        </div>
      </div>

      {/* Step 1 — Copy lead info */}
      <Section title="1 · Lead info — copy into HoneyBook">
        <p style={hintStyle}>Click any field to copy. The "Copy all" button copies everything as a multi-line block.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          <CopyField label="Company" value={lead.company} copied={copied === 'company'} onCopy={() => copy('company', lead.company)} />
          <EditableField
            label="Contact name"
            value={lead.contact}
            suggested={firstMinedOwner(lead.owner_names)}
            placeholder="+ add name"
            copied={copied === 'contact'}
            onCopy={() => copy('contact', lead.contact)}
            onSave={onLeadFieldUpdate ? (v) => onLeadFieldUpdate('contact', v) : undefined}
          />
          <CopyField label="Phone" value={lead.phone ? formatPhone(lead.phone) : ''} copied={copied === 'phone'} onCopy={() => copy('phone', lead.phone)} />
          <EditableField
            label="Email"
            value={lead.email}
            placeholder="+ add email"
            type="email"
            copied={copied === 'email'}
            onCopy={() => copy('email', lead.email)}
            onSave={onLeadFieldUpdate ? (v) => onLeadFieldUpdate('email', v) : undefined}
          />
          <CopyField label="City / State" value={[lead.city, lead.state].filter(Boolean).join(', ')} copied={copied === 'where'} onCopy={() => copy('where', [lead.city, lead.state].filter(Boolean).join(', '))} />
        </div>
        <div style={{ marginTop: 10 }}>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              const block = [
                lead.company,
                lead.contact ?? '',
                lead.phone ? formatPhone(lead.phone) : '',
                lead.email ?? '',
                [lead.city, lead.state].filter(Boolean).join(', '),
              ].filter(Boolean).join('\n');
              void navigator.clipboard.writeText(block);
              showToast('All fields copied', 'success');
            }}
          >
            📋 Copy all fields
          </Button>
        </div>
      </Section>

      {/* Step 2 — Fill out the HoneyBook form */}
      <Section title="2 · Fill HoneyBook form below, then submit">
        <div style={{
          background: 'white',
          border: '1px solid var(--border)',
          borderRadius: 4,
          minHeight: 500,
          overflow: 'hidden',
        }}>
          {/* Placeholder div — HB controller scans for this class name and
              injects the form. The class name must match HB_PLACEMENT_ID. */}
          <div className={`hb-p-${HB_PLACEMENT_ID}-2`} style={{ width: '100%' }} />
          {/* Tracking pixel per the snippet. */}
          <img height={1} width={1} alt="" style={{ display: 'none' }}
               src={`https://www.honeybook.com/p.png?pid=${HB_PLACEMENT_ID}`} />
        </div>
      </Section>

      {/* Step 3 — Confirm */}
      <Section title="3 · Record the booking">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Agreed date/time (your local time)">
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Submitted in HoneyBook?">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: 'var(--text2)', padding: '7px 0' }}>
              <input
                type="checkbox"
                checked={honeybookConfirmed}
                onChange={(e) => setHoneybookConfirmed(e.target.checked)}
              />
              <span>Yes, form was submitted</span>
            </label>
          </Field>
        </div>
      </Section>

      {/* Footer — Cancel + Confirm */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 8,
        paddingTop: 14, borderTop: '1px solid var(--border)',
      }}>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting}>
          {submitting ? <><Spinner /> Recording…</> : '✓ Mark booked & advance'}
        </Button>
      </div>
    </div>
  );
}

// ---------- small in-file components ----------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.5px',
        color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 10,
      }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={fieldLabelStyle}>{label}</div>
      {children}
    </div>
  );
}

function EditableField({
  label, value, suggested, placeholder, type = 'text', copied, onCopy, onSave,
}: {
  label: string;
  value: string | null | undefined;
  suggested?: string | null;
  placeholder: string;
  type?: 'text' | 'email';
  copied: boolean;
  onCopy: () => void;
  onSave?: (next: string | null) => Promise<void> | void;
}) {
  // Three-row stack: label, editable input, copy chip below. Persist the
  // edit via the parent's update callback so it flows into the lead record.
  // If no onSave wired up, falls back to read-only CopyField behavior.
  if (!onSave) {
    return <CopyField label={label} value={value ?? ''} copied={copied} onCopy={onCopy} />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <InlineEditField
        label={label}
        variant="boxed"
        type={type}
        value={value}
        suggested={suggested}
        placeholder={placeholder}
        onSave={onSave}
      />
      <button
        type="button"
        onClick={onCopy}
        disabled={!value}
        style={{
          alignSelf: 'flex-start',
          background: 'transparent', border: 'none', padding: 0,
          fontSize: '0.6rem', color: copied ? 'var(--green)' : 'var(--text3)',
          fontFamily: 'inherit', cursor: value ? 'pointer' : 'default',
          opacity: value ? 1 : 0.5,
        }}
      >
        {copied ? '✓ Copied' : '📋 Copy'}
      </button>
    </div>
  );
}

function CopyField({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div>
      <div style={fieldLabelStyle}>{label}</div>
      <button
        type="button"
        onClick={onCopy}
        disabled={!value}
        style={{
          width: '100%', textAlign: 'left',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '7px 10px',
          fontSize: '0.78rem', color: 'var(--text)', fontFamily: 'inherit',
          cursor: value ? 'pointer' : 'default',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
          opacity: value ? 1 : 0.5,
        }}
        title={value ? 'Click to copy' : '(empty)'}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</span>
        <span style={{ fontSize: '0.65rem', color: copied ? 'var(--green)' : 'var(--text3)', flexShrink: 0 }}>
          {copied ? '✓ Copied' : '📋'}
        </span>
      </button>
    </div>
  );
}

// ---------- styles ----------

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.4px',
  color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface2)',
  border: '1px solid var(--border)', borderRadius: 4,
  padding: '7px 10px', fontSize: '0.78rem',
  color: 'var(--text)', fontFamily: 'inherit',
};

const hintStyle: React.CSSProperties = {
  margin: '0 0 10px', fontSize: '0.68rem', color: 'var(--text3)', lineHeight: 1.5,
};

// Mirror of ExecutionView's helper — parses the first owner name out of the
// JSON-stringified owner_names column written by enrichment. Returns null if
// the field is empty or unparseable.
function firstMinedOwner(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0];
  } catch { /* fall through */ }
  return null;
}

function defaultDateTimeLocal(): string {
  const d = new Date();
  d.setHours(d.getHours() + 24, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
