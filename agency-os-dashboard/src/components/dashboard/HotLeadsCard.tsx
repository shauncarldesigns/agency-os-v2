import { useEffect, useState, useCallback } from 'react';
import { api, type SessionWithProgress } from '../../lib/api';
import type { ShowToast, Tab } from '../../lib/types';
import { Button } from '../shared/Button';

/**
 * Hot leads card — operator-curated priority queue.
 *
 * Sits above the WeekPlanner. Shows the count of leads waiting in the
 * hot session + a Continue button that opens the cockpit on the hot
 * session. Empty state explains how to populate it from the Pipeline.
 *
 * Listens to hot:added events broadcast by EnrichmentStrip so the card
 * auto-refreshes the moment the operator adds leads from another tab.
 */

interface HotLeadsCardProps {
  showToast: ShowToast;
  onOpenSession?: (sessionId: number) => void;
  onSwitchTab?: (tab: Tab) => void;
}

export function HotLeadsCard({ showToast: _showToast, onOpenSession, onSwitchTab }: HotLeadsCardProps) {
  const [session, setSession] = useState<SessionWithProgress | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.sessions.hot();
      setSession(res.session);
    } catch {
      // Silent fail — card stays in loading/empty state. Don't toast; the
      // dashboard is already noisy enough.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh when EnrichmentStrip dispatches the hot:added event.
  useEffect(() => {
    function onAdded() { void load(); }
    window.addEventListener('hotleads:added', onAdded);
    return () => window.removeEventListener('hotleads:added', onAdded);
  }, [load]);

  const uncalled = session ? session.lead_count - session.called_count : 0;
  const hasActive = uncalled > 0;

  return (
    <div className={`hotleads-card${hasActive ? ' hotleads-card-active' : ''}`}>
      <div className="hotleads-body">
        <div className="hotleads-tag">🔥 HOT LEADS</div>
        {loading && !session ? (
          <div className="hotleads-sub">Loading…</div>
        ) : !session || session.lead_count === 0 ? (
          <>
            <div className="hotleads-title">No hot leads yet</div>
            <div className="hotleads-sub">
              Hand-pick from the Pipeline (select rows → <strong>🔥 Add to hot leads</strong>)
              to queue priority calls outside the auto-composed sessions.
              {onSwitchTab && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => onSwitchTab('pipeline')}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', font: 'inherit', padding: 0, textDecoration: 'underline' }}
                  >
                    open Pipeline
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="hotleads-title">
              {uncalled > 0
                ? <>{uncalled} hot lead{uncalled === 1 ? '' : 's'} waiting</>
                : <>All caught up — {session.called_count} called</>}
            </div>
            <div className="hotleads-sub">
              {session.lead_count} total · {session.called_count} called
              {session.booked_count > 0 && <> · <strong style={{ color: 'var(--green)' }}>{session.booked_count} booked</strong></>}
              {session.callback_count > 0 && <> · {session.callback_count} callback{session.callback_count === 1 ? '' : 's'}</>}
              {session.voicemail_count > 0 && <> · {session.voicemail_count} voicemail{session.voicemail_count === 1 ? '' : 's'}</>}
            </div>
          </>
        )}
      </div>
      {session && session.lead_count > 0 && (
        <Button
          variant={uncalled > 0 ? 'primary' : 'ghost'}
          size="default"
          onClick={() => onOpenSession?.(session.id)}
        >
          {uncalled > 0 ? 'Call hot leads →' : 'Review →'}
        </Button>
      )}
    </div>
  );
}
