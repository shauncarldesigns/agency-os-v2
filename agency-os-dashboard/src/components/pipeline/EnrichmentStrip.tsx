import { useState } from 'react';
import type { Lead, ShowToast } from '../../lib/types';
import { api } from '../../lib/api';
import { Button } from '../shared/Button';

interface EnrichmentStripProps {
  leads: Lead[];
  /** Set of lead ids the operator has bulk-selected. When non-empty, the
   *  strip's primary button switches to "Re-enrich Selected". */
  selectedIds: Set<number>;
  /** Clear all selections (used when the operator cancels the bulk action). */
  onClearSelection: () => void;
  showToast: ShowToast;
  onComplete: () => void;
}

// UI safety cap. The Worker's per-invocation subrequest budget (1000 on
// paid) bounds how many leads a single bulk call can process — each lead
// burns ~15–20 subrequests with the post-fix Outscraper poll cadence.
// 25 leaves comfortable headroom; if the backend hits the cap mid-batch
// it now stops cleanly and reports `stoppedEarly`, but staying under the
// cap is the better path.
const BULK_LIMIT = 25;

export function EnrichmentStrip({
  leads, selectedIds, onClearSelection, showToast, onComplete,
}: EnrichmentStripProps) {
  const [running, setRunning] = useState(false);

  const total = leads.length;
  const enriched = leads.filter(l => l.enrichment_status === 'enriched').length;
  const enriching = leads.filter(l => l.enrichment_status === 'enriching').length;
  const pending = leads.filter(l => l.enrichment_status === 'pending').length;
  const failed = leads.filter(l => l.enrichment_status === 'failed').length;
  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;

  // Render whenever there's pipeline activity OR the operator has staged a
  // bulk action. A fully-enriched view with no selection still hides the strip.
  if (
    total === 0
    || (!hasSelection && pending === 0 && enriching === 0 && failed === 0)
  ) {
    return null;
  }

  const pct = total > 0 ? Math.round((enriched / total) * 100) : 0;

  async function handleEnrichAll() {
    if (running) return;

    if (hasSelection) {
      // Bulk re-enrich path. Filter out in-flight 'enriching' leads — the
      // user shouldn't double-fire those, and the backend would just race
      // with itself.
      const ids = leads
        .filter((l) => selectedIds.has(l.id) && l.enrichment_status !== 'enriching')
        .map((l) => l.id)
        .slice(0, BULK_LIMIT);

      if (ids.length === 0) {
        showToast('Selected leads are already enriching — nothing to re-fire', 'default');
        return;
      }

      const dropped = selectedCount - ids.length;
      setRunning(true);
      showToast(
        `Re-enriching ${ids.length} selected lead${ids.length === 1 ? '' : 's'}${dropped > 0 ? ` (skipped ${dropped} already in-flight)` : ''} — this may take a while`,
        'default'
      );
      try {
        const result = await api.leads.enrichAll({ ids, limit: BULK_LIMIT });
        showToast(formatResultToast(result, 'Re-enriched'), result.failed === 0 && !result.stoppedEarly ? 'success' : 'default');
        onComplete();
      } catch (err) {
        showToast(`Bulk re-enrich failed: ${(err as Error).message}`, 'error');
      } finally {
        setRunning(false);
      }
      return;
    }

    // No selection — legacy "enrich all pending" behavior.
    if (pending === 0) return;
    setRunning(true);
    showToast(`Enriching ${pending} pending leads — this may take a few minutes`, 'default');
    try {
      const result = await api.leads.enrichAll({ limit: Math.min(pending, BULK_LIMIT) });
      showToast(formatResultToast(result, 'Enriched'), result.failed === 0 && !result.stoppedEarly ? 'success' : 'default');
      onComplete();
    } catch (err) {
      showToast(`Enrichment failed: ${(err as Error).message}`, 'error');
    } finally {
      setRunning(false);
    }
  }

  /** Build a friendly toast covering the normal case + the new "stopped
   *  early" case where the Worker subrequest cap kicked in mid-batch. */
  function formatResultToast(
    result: {
      total: number;
      processed?: number;
      succeeded: number;
      failed: number;
      stoppedEarly?: string | null;
      remainingUnprocessed?: number;
    },
    verb: string
  ): string {
    const base = `${verb} ${result.succeeded} of ${result.total} (${result.failed} failed)`;
    if (result.stoppedEarly === 'subrequest_budget_exhausted') {
      const remaining = result.remainingUnprocessed ?? 0;
      return `${base} — hit Worker subrequest cap, ${remaining} left to retry in a smaller batch`;
    }
    if (result.stoppedEarly) {
      return `${base} — batch stopped early (${result.stoppedEarly})`;
    }
    return base;
  }

  const buttonLabel = (() => {
    if (running) return <>⏳ Working…</>;
    if (hasSelection) return <>↻ Re-enrich Selected ({selectedCount > BULK_LIMIT ? `${BULK_LIMIT}+` : selectedCount})</>;
    return <>⚡ Enrich All Now</>;
  })();

  const buttonDisabled = running
    || (hasSelection ? false : pending === 0);

  return (
    <div className="enrich-strip">
      <div className="enrich-icon">{hasSelection ? '↻' : '✦'}</div>
      <div style={{ flex: 1 }}>
        <div className="enrich-title">
          {hasSelection
            ? `Bulk action staged · ${selectedCount} selected`
            : enriching > 0
              ? 'Enrichment in progress'
              : 'Lead enrichment'}
        </div>
        <div className="enrich-sub">
          {hasSelection ? (
            <>
              {selectedCount > BULK_LIMIT && (
                <span style={{ color: 'var(--yellow)' }}>
                  Only the first {BULK_LIMIT} will run ·
                </span>
              )}
              {' '}re-enrichment overwrites Outscraper reviews + PageSpeed scores ·{' '}
              <button
                type="button"
                onClick={onClearSelection}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  font: 'inherit',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                clear selection
              </button>
            </>
          ) : (
            <>
              {total} leads · <strong>{enriched} enriched</strong>
              {enriching > 0 && <> · <strong>{enriching} enriching now</strong></>}
              {pending > 0 && <> · <strong>{pending} pending</strong></>}
              {failed > 0 && <> · <strong style={{ color: 'var(--red)' }}>{failed} failed</strong></>}
            </>
          )}
        </div>
      </div>
      {!hasSelection && (
        <div style={{ flex: '0 0 200px' }}>
          <div style={{ height: 5, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--green)', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text3)', textAlign: 'right' }}>{pct}% complete</div>
        </div>
      )}
      <Button
        variant="primary"
        size="xs"
        disabled={buttonDisabled}
        onClick={handleEnrichAll}
      >
        {buttonLabel}
      </Button>
    </div>
  );
}
