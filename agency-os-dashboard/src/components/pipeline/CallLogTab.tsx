import { useState } from 'react';
import type { CallEntry, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { formatDateTime, todayIso, outcomeBadge } from '../../lib/format';

interface CallLogTabProps {
  leadId: number;
  calls: CallEntry[];
  showToast: ShowToast;
  onCallsChanged: () => void;
}

const OUTCOMES = [
  'No Answer',
  'Voicemail Left',
  'Spoke with Owner',
  'Callback Requested',
  'Not Interested',
  'Interested',
  'Qualified for Tier',
];

export function CallLogTab({ leadId, calls, showToast, onCallsChanged }: CallLogTabProps) {
  const [outcome, setOutcome] = useState(OUTCOMES[2]);
  const [notes, setNotes] = useState('');
  const [followup, setFollowup] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!notes.trim()) {
      showToast('Add some notes before saving', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.calls.create(leadId, {
        outcome,
        notes: notes.trim(),
        followup_date: followup || null,
      });
      showToast('Call logged', 'success');
      setNotes('');
      setFollowup('');
      onCallsChanged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Save failed: ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.calls.delete(id);
      showToast('Call entry removed', 'default');
      onCallsChanged();
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`, 'error');
    }
  }

  return (
    <div style={{ padding: 0, maxHeight: '55vh', overflowY: 'auto' }}>
      {/* New call entry form */}
      <div style={{ padding: '16px 20px', background: 'var(--accent-dim)', borderBottom: '1px solid rgba(255,107,43,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--accent)' }}>📞 Log a call</div>
          <div style={{ fontSize: '0.62rem', color: 'var(--text3)' }}>Today · {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginBottom: 10 }}>
          <div className="fg">
            <label className="flabel">Outcome</label>
            <select className="finput" value={outcome} onChange={e => setOutcome(e.target.value)}>
              {OUTCOMES.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="fg">
            <label className="flabel">Follow-up date</label>
            <input
              type="date"
              className="finput"
              value={followup}
              min={todayIso()}
              onChange={e => setFollowup(e.target.value)}
            />
          </div>
        </div>

        <div className="fg" style={{ marginBottom: 10 }}>
          <label className="flabel">Call notes</label>
          <textarea
            className="finput"
            rows={3}
            placeholder="What did they say? What's the next action? Any objections to handle?"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            style={{ resize: 'vertical', fontFamily: "'DM Sans', sans-serif" }}
          />
        </div>

        <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={() => { setNotes(''); setFollowup(''); }}>Clear</Button>
          <Button variant="primary" size="sm" disabled={saving} onClick={handleSave}>
            {saving ? '⏳ Saving…' : '💾 Save Call Entry'}
          </Button>
        </div>
      </div>

      {/* History */}
      <div style={{ padding: '14px 20px' }}>
        <div style={{ fontSize: '0.62rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 }}>
          Call History · {calls.length} {calls.length === 1 ? 'entry' : 'entries'}
        </div>

        {calls.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text3)', fontSize: '0.74rem' }}>
            No calls logged yet.
          </div>
        ) : (
          calls.map(c => {
            const ob = outcomeBadge(c.outcome);
            return (
              <div key={c.id} className="call-entry">
                <div className="call-entry-header">
                  <div>
                    <span className="call-entry-date">{formatDateTime(c.created_at)}</span>
                    <span style={{ marginLeft: 8 }}>
                      <Badge color={ob.color}>{ob.label}</Badge>
                    </span>
                  </div>
                  <button className="btn btn-ghost btn-xs" style={{ padding: '2px 6px' }} onClick={() => handleDelete(c.id)} aria-label="Delete entry">✕</button>
                </div>
                <div className="call-entry-notes">{c.notes}</div>
                {c.followup_date && (
                  <div className="call-entry-followup">📅 Follow-up: {new Date(c.followup_date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
