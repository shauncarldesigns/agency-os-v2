import { useState, useEffect, useCallback } from 'react';
import type { Project, ShowToast } from '../../lib/types';
import { api, ApiError, type DnsStatusResponse } from '../../lib/api';
import { Modal, ModalHeader, ModalFooter } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Badge } from '../shared/Badge';
import { Spinner } from '../shared/Spinner';

/**
 * "Manage DNS" detail view — opened from the Quick Action button after a
 * project has a Cloudflare zone. Surfaces:
 *
 *   - Zone status (pending while CF waits for nameserver delegation; active
 *     once delegated)
 *   - Assigned Cloudflare nameservers with copy-to-clipboard (operator hands
 *     these to the client / registrar)
 *   - Per-record found/missing state
 *   - Refresh (re-pull from CF)
 *   - Retry DNS Setup (only when status='failed' — re-creates missing records)
 *
 * Status is fetched live on open; no polling in this view because the operator
 * is actively present. Sidebar polling (phase 4) handles passive updates.
 */

interface DnsManagePanelProps {
  open: boolean;
  project: Project;
  onClose: () => void;
  showToast: ShowToast;
  /** Fired after any state-changing action (refresh, retry) so the parent can
   *  re-fetch the project — keeps the sidebar DNS section in sync. */
  onProjectChanged: () => void;
}

export function DnsManagePanel({ open, project, onClose, showToast, onProjectChanged }: DnsManagePanelProps) {
  const [status, setStatus] = useState<DnsStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (kind: 'initial' | 'refresh') => {
    if (kind === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await api.projects.dns.status(project.id);
      setStatus(res);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (!open) {
      setStatus(null);
      setError(null);
      return;
    }
    void load('initial');
  }, [open, load]);

  async function handleRetry() {
    setRetrying(true);
    setError(null);
    try {
      const res = await api.projects.dns.retry(project.id);
      if (res.created.length > 0 && res.failures.length === 0) {
        showToast(`Created ${res.created.length} missing record(s).`, 'success');
      } else if (res.created.length > 0 && res.failures.length > 0) {
        showToast(`Created ${res.created.length}; ${res.failures.length} still failing.`, 'error');
      } else if (res.failures.length > 0) {
        showToast(`Retry failed: ${res.failures.length} record(s) could not be created.`, 'error');
      } else {
        showToast('No missing records — nothing to retry.', 'default');
      }
      onProjectChanged();
      await load('refresh');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg);
    } finally {
      setRetrying(false);
    }
  }

  function copyNameservers() {
    if (!status?.nameservers?.length) return;
    void navigator.clipboard.writeText(status.nameservers.join('\n'));
    showToast('Nameservers copied to clipboard', 'success');
  }

  function copyOne(ns: string) {
    void navigator.clipboard.writeText(ns);
    showToast(`Copied ${ns}`, 'success');
  }

  const dnsStatus = status?.dns_status ?? project.dns_status;
  const showRetry = dnsStatus === 'failed';

  return (
    <Modal open={open} onClose={onClose} width={640}>
      <ModalHeader title={`DNS — ${project.domain ?? '—'}`} onClose={onClose} />
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '70vh', overflowY: 'auto' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--text3)', fontSize: '0.78rem' }}>
            <Spinner /> Fetching live DNS state from Cloudflare…
          </div>
        )}

        {!loading && error && (
          <div style={errorBoxStyle}>{error}</div>
        )}

        {!loading && status && (
          <>
            {/* Zone status */}
            <Section title="Zone status">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ZoneStatusBadge dnsStatus={dnsStatus} />
                {status.last_checked && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--text3)' }}>
                    Last checked {new Date(status.last_checked).toLocaleString()}
                  </span>
                )}
              </div>
              {dnsStatus === 'pending' && (
                <p style={hintStyle}>
                  Cloudflare is waiting for the nameserver delegation to propagate from the registrar.
                  This usually takes minutes to a few hours, sometimes up to 24h.
                </p>
              )}
              {dnsStatus === 'failed' && (
                <p style={{ ...hintStyle, color: 'var(--red)' }}>
                  One or more landingsite records failed to create. Click <strong>Retry DNS setup</strong> below.
                </p>
              )}
            </Section>

            {/* Nameservers */}
            <Section
              title="Cloudflare nameservers"
              right={
                status.nameservers.length > 0 && (
                  <Button variant="ghost" size="xs" onClick={copyNameservers}>
                    📋 Copy both
                  </Button>
                )
              }
            >
              {status.nameservers.length === 0 ? (
                <div style={{ fontSize: '0.74rem', color: 'var(--text3)' }}>None assigned yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {status.nameservers.map((ns) => (
                    <div
                      key={ns}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '7px 10px',
                        background: 'var(--surface2)',
                        borderRadius: 4,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: '0.74rem',
                      }}
                    >
                      <span>{ns}</span>
                      <button
                        onClick={() => copyOne(ns)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text3)',
                          cursor: 'pointer',
                          fontSize: '0.72rem',
                          padding: '2px 6px',
                        }}
                        title="Copy this nameserver"
                      >
                        📋
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p style={hintStyle}>
                Update both nameservers at the registrar (replace the existing NS records). Cloudflare detects the
                delegation within minutes once propagated.
              </p>
            </Section>

            {/* Records */}
            <Section title="Landingsite records">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {status.records.map((r, i) => (
                  <div
                    key={`${r.type}-${r.hostname}-${r.content}-${i}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '50px 1fr auto',
                      gap: 10,
                      alignItems: 'center',
                      padding: '8px 10px',
                      background: 'var(--surface2)',
                      borderRadius: 4,
                      fontSize: '0.74rem',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: 'var(--text2)', fontFamily: 'ui-monospace, monospace' }}>
                      {r.type}
                    </span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text)' }}>
                      <span style={{ color: 'var(--text3)' }}>{r.hostname}</span>
                      <span style={{ color: 'var(--text3)', margin: '0 6px' }}>→</span>
                      {r.content}
                    </span>
                    <span style={r.found ? { color: '#4ade80', fontWeight: 500 } : { color: 'var(--red)', fontWeight: 500 }}>
                      {r.found ? '✓ Found' : '✗ Missing'}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button variant="ghost" size="sm" disabled={loading || refreshing} onClick={() => void load('refresh')}>
          {refreshing ? <><Spinner /> Refreshing…</> : '↻ Refresh'}
        </Button>
        {showRetry && (
          <Button variant="primary" size="sm" disabled={retrying} onClick={handleRetry}>
            {retrying ? <><Spinner /> Retrying…</> : 'Retry DNS setup'}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

// ---------- helpers ----------

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: '0.62rem',
            fontWeight: 600,
            letterSpacing: '0.4px',
            color: 'var(--text3)',
            textTransform: 'uppercase',
          }}
        >
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function ZoneStatusBadge({ dnsStatus }: { dnsStatus: 'not_created' | 'pending' | 'active' | 'failed' }) {
  if (dnsStatus === 'active') return <Badge color="green">Active</Badge>;
  if (dnsStatus === 'pending') return <Badge color="yellow">Pending</Badge>;
  if (dnsStatus === 'failed') return <Badge color="red">Failed</Badge>;
  return <Badge color="gray">Not created</Badge>;
}

const hintStyle: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: '0.7rem',
  color: 'var(--text3)',
  lineHeight: 1.5,
};

const errorBoxStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: 'rgba(248,113,113,0.08)',
  border: '1px solid rgba(248,113,113,0.35)',
  borderRadius: 6,
  fontSize: '0.74rem',
  color: 'var(--red)',
  lineHeight: 1.4,
};
