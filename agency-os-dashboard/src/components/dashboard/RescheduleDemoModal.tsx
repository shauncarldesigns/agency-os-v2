import { useState, useEffect } from 'react';
import type { ShowToast } from '../../lib/types';
import type { DemoWithLead } from '../../lib/api';
import { api, ApiError } from '../../lib/api';
import { Modal, ModalHeader, ModalFooter } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

/**
 * Reschedule demo modal — replaces the Phase 4 window.prompt.
 *
 * Operator picks a new datetime + optionally adds context notes. Calls
 * PUT /api/demos/:id/status with status='rescheduled' + newDate. The backend
 * updates the demo's scheduled_for + writes a demo_events row with the old
 * date in event_data for the audit trail.
 */

interface RescheduleDemoModalProps {
  open: boolean;
  demo: DemoWithLead | null;
  showToast: ShowToast;
  onClose: () => void;
  onRescheduled: () => Promise<void> | void;
}

export function RescheduleDemoModal({ open, demo, showToast, onClose, onRescheduled }: RescheduleDemoModalProps) {
  const [newDate, setNewDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !demo) return;
    // Default to 3 days after the originally-scheduled date so the operator
    // doesn't have to retype the entire datetime — most reschedules are short
    // shifts.
    const orig = new Date(demo.scheduled_for);
    if (!Number.isNaN(orig.getTime())) {
      const next = new Date(orig.getTime() + 3 * 24 * 3600 * 1000);
      setNewDate(toLocalInputValue(next));
    } else {
      const next = new Date(Date.now() + 24 * 3600 * 1000);
      setNewDate(toLocalInputValue(next));
    }
    setNotes('');
  }, [open, demo]);

  if (!demo) return null;

  async function handleSave() {
    if (!demo) return;
    if (!newDate) {
      showToast('Pick a new date/time first', 'error');
      return;
    }
    setSaving(true);
    try {
      const iso = new Date(newDate).toISOString();
      await api.demos.setStatus(demo.id, { status: 'rescheduled', newDate: iso, notes: notes.trim() || undefined });
      showToast(`Demo with ${demo.company} rescheduled`, 'success');
      await onRescheduled();
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Reschedule failed: ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={saving ? () => undefined : onClose} width={480}>
      <ModalHeader title={`Reschedule · ${demo.company}`} onClose={onClose} />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{
          fontSize: '0.72rem',
          color: 'var(--text2)',
          padding: '8px 12px',
          background: 'var(--surface2)',
          borderRadius: 4,
        }}>
          Originally <strong>{formatDt(demo.scheduled_for)}</strong>
          {demo.contact ? ` · ${demo.contact}` : ''}
          {demo.phone ? ` · ${demo.phone}` : ''}
        </div>

        <Field label="New date/time (your local time)">
          <input
            type="datetime-local"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field label="Notes (optional)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why rescheduled? Any context for next time."
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>

        <div style={{ fontSize: '0.66rem', color: 'var(--text3)', lineHeight: 1.4 }}>
          The previous date is preserved in the demo's audit trail. The lead stays
          in "Demo booked" status on the Sites tab.
        </div>
      </div>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <><Spinner /> Saving…</> : 'Reschedule'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ---------- helpers ----------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.4px', color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '7px 10px',
  fontSize: '0.78rem',
  color: 'var(--text)',
  fontFamily: 'inherit',
};
