import { useState } from 'react';
import type { Lead, ShowToast } from '../../lib/types';
import { api } from '../../lib/api';
import { Button } from '../shared/Button';

interface EnrichmentStripProps {
  leads: Lead[];
  showToast: ShowToast;
  onComplete: () => void;
}

export function EnrichmentStrip({ leads, showToast, onComplete }: EnrichmentStripProps) {
  const [running, setRunning] = useState(false);

  const total = leads.length;
  const enriched = leads.filter(l => l.enrichment_status === 'enriched').length;
  const enriching = leads.filter(l => l.enrichment_status === 'enriching').length;
  const pending = leads.filter(l => l.enrichment_status === 'pending').length;
  const failed = leads.filter(l => l.enrichment_status === 'failed').length;

  // Only render the strip if there's anything interesting to show
  if (total === 0 || (pending === 0 && enriching === 0 && failed === 0)) return null;

  const pct = total > 0 ? Math.round((enriched / total) * 100) : 0;

  async function handleEnrichAll() {
    if (pending === 0 || running) return;
    setRunning(true);
    showToast(`Enriching ${pending} pending leads — this may take a few minutes`, 'default');
    try {
      const result = await api.leads.enrichAll(Math.min(pending, 50));
      showToast(`Enriched ${result.succeeded} of ${result.total} (${result.failed} failed)`, result.failed === 0 ? 'success' : 'default');
      onComplete();
    } catch (err) {
      showToast(`Enrichment failed: ${(err as Error).message}`, 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="enrich-strip">
      <div className="enrich-icon">✦</div>
      <div style={{ flex: 1 }}>
        <div className="enrich-title">
          {enriching > 0 ? 'Enrichment in progress' : 'Lead enrichment'}
        </div>
        <div className="enrich-sub">
          {total} leads · <strong>{enriched} enriched</strong>
          {enriching > 0 && <> · <strong>{enriching} enriching now</strong></>}
          {pending > 0 && <> · <strong>{pending} pending</strong></>}
          {failed > 0 && <> · <strong style={{ color: 'var(--red)' }}>{failed} failed</strong></>}
        </div>
      </div>
      <div style={{ flex: '0 0 200px' }}>
        <div style={{ height: 5, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--green)', borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        <div style={{ fontSize: '0.6rem', color: 'var(--text3)', textAlign: 'right' }}>{pct}% complete</div>
      </div>
      <Button
        variant="primary"
        size="xs"
        disabled={pending === 0 || running}
        onClick={handleEnrichAll}
      >
        {running ? <>⏳ Working…</> : <>⚡ Enrich All Now</>}
      </Button>
    </div>
  );
}
