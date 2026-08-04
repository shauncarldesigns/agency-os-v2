import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, X } from 'lucide-react';
import type { Lead, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { formatPhone, scoreColor, statusBadge, tierColor } from '../../lib/format';

interface LeadsTableProps {
  leads: Lead[];
  selectedIds: Set<number>;
  onToggleSelected: (id: number) => void;
  onToggleAllVisible: (on: boolean) => void;
  showToast: ShowToast;
  onLeadUpdated: () => void;
  onOpenLead: (id: number) => void;
  onQualify: (lead: Lead) => void;
}

export function LeadsTable({
  leads, selectedIds, onToggleSelected, onToggleAllVisible,
  showToast, onLeadUpdated, onOpenLead, onQualify,
}: LeadsTableProps) {
  const [tableSort, setTableSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  if (leads.length === 0) {
    return (
      <div className="twrap" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)' }}>
        No leads match the current filters.
      </div>
    );
  }

  // Header checkbox tri-state: all visible selected → checked,
  // some → indeterminate, none → unchecked.
  const displayedLeads = sortLeads(leads, tableSort);
  const visibleIds = displayedLeads.map((l) => l.id);
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleChecked = visibleSelectedCount === visibleIds.length;
  const someVisibleChecked = visibleSelectedCount > 0 && !allVisibleChecked;

  return (
    <div>
      {tableSort && (
        <div className="mb-2 flex items-center justify-end gap-2 text-xs text-slate-500">
          <span>
            Sorted by <span className="font-semibold text-slate-700">{sortLabel(tableSort.key)}</span>{' '}
            {tableSort.direction === 'asc' ? '↑' : '↓'}
          </span>
          <button
            type="button"
            onClick={() => setTableSort(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
          >
            ↺ Last updated
          </button>
        </div>
      )}
      <div className="twrap pipeline-leads-wrap">
      <table className="pipeline-leads-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                checked={allVisibleChecked}
                ref={(el) => { if (el) el.indeterminate = someVisibleChecked; }}
                onChange={(e) => onToggleAllVisible(e.target.checked)}
                title={allVisibleChecked ? 'Deselect all visible' : 'Select all visible'}
                aria-label="Select all visible leads"
              />
            </th>
            <SortHeader label="Company" sortKey="company" active={tableSort} onSort={setTableSort} />
            <SortHeader label="Fit" sortKey="fit" active={tableSort} onSort={setTableSort} />
            <SortHeader label="Route" sortKey="route" active={tableSort} onSort={setTableSort} />
            <SortHeader label="Outreach" sortKey="outreach" active={tableSort} onSort={setTableSort} />
            <SortHeader label="Latest touch" sortKey="latestTouch" active={tableSort} onSort={setTableSort} />
            <SortHeader label="Next action" sortKey="nextAction" active={tableSort} onSort={setTableSort} />
            <SortHeader label="CRM stage" sortKey="stage" active={tableSort} onSort={setTableSort} />
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {displayedLeads.map(l => (
            <LeadRow
              key={l.id}
              lead={l}
              selected={selectedIds.has(l.id)}
              onToggleSelected={onToggleSelected}
              showToast={showToast}
              onLeadUpdated={onLeadUpdated}
              onOpenLead={onOpenLead}
              onQualify={onQualify}
            />
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

type SortKey = 'company' | 'fit' | 'route' | 'outreach' | 'latestTouch' | 'nextAction' | 'stage';
type SortDirection = 'asc' | 'desc';
type TableSort = { key: SortKey; direction: SortDirection } | null;

function SortHeader({ label, sortKey, active, onSort }: { label: string; sortKey: SortKey; active: TableSort; onSort: (sort: TableSort) => void }) {
  const selected = active?.key === sortKey;
  const direction = selected ? active.direction : null;
  return (
    <th aria-sort={!selected ? 'none' : direction === 'asc' ? 'ascending' : 'descending'}>
      <button
        type="button"
        className={`pipeline-sort-header${selected ? ' active' : ''}`}
        onClick={() => onSort(
          !selected ? { key: sortKey, direction: 'asc' }
            : direction === 'asc' ? { key: sortKey, direction: 'desc' }
            : null
        )}
        title={!selected ? `Sort ${label} ascending` : direction === 'asc' ? `Sort ${label} descending` : 'Return to last updated'}
      >
        <span>{label}</span>
        <span className="pipeline-sort-arrow" aria-hidden="true">{selected ? (direction === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

function sortLabel(key: SortKey): string {
  const labels: Record<SortKey, string> = {
    company: 'Company', fit: 'Fit', route: 'Route', outreach: 'Outreach',
    latestTouch: 'Latest touch', nextAction: 'Next action', stage: 'CRM stage',
  };
  return labels[key];
}

function sortLeads(leads: Lead[], sort: TableSort): Lead[] {
  if (!sort) return leads;
  const outreachRank: Record<Lead['pipeline_status'], number> = {
    awaiting_build: 0, ready_to_send: 1, sent_no_reply: 2, engaged: 3, booked: 4, archived: 5,
  };
  const stageRank: Record<Lead['status'], number> = {
    cold: 0, contacted: 1, qualified: 2, client: 3, not_interested: 4, dead: 5,
  };
  const value = (lead: Lead): string | number => {
    if (sort.key === 'company') return lead.company.toLocaleLowerCase();
    if (sort.key === 'fit') return lead.opportunity_score ?? -1;
    if (sort.key === 'route') return routePresentation(lead).label.toLocaleLowerCase();
    if (sort.key === 'outreach') return outreachRank[lead.pipeline_status];
    if (sort.key === 'latestTouch') return timestampValue(lead.pipeline_last_action_created_at ?? lead.pipeline_last_action_at ?? lead.last_called_at);
    if (sort.key === 'nextAction') return nextActionPresentation(lead).label.toLocaleLowerCase();
    return stageRank[lead.status];
  };
  return [...leads].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    const compared = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
    if (compared !== 0) return sort.direction === 'asc' ? compared : -compared;
    return a.company.localeCompare(b.company);
  });
}

function timestampValue(raw: string | null | undefined): number {
  if (!raw) return 0;
  const date = new Date(raw.replace(' ', 'T') + (raw.includes('Z') || /[+-]\d\d:\d\d$/.test(raw) ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

interface LeadRowProps {
  lead: Lead;
  selected: boolean;
  onToggleSelected: (id: number) => void;
  showToast: ShowToast;
  onLeadUpdated: () => void;
  onOpenLead: (id: number) => void;
  onQualify: (lead: Lead) => void;
}

function LeadRow({
  lead, selected, onToggleSelected, showToast, onLeadUpdated, onOpenLead, onQualify,
}: LeadRowProps) {
  const [enriching, setEnriching] = useState(false);
  const [showEnrichmentProgress, setShowEnrichmentProgress] = useState(false);
  const [progressLead, setProgressLead] = useState<Lead>(lead);
  const stage = statusBadge(lead.status);
  const route = routePresentation(lead);
  const outreach = outreachPresentation(lead);
  const latestTouch = latestTouchPresentation(lead);
  const nextAction = nextActionPresentation(lead);

  useEffect(() => {
    if (!showEnrichmentProgress) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await api.leads.get(lead.id);
        if (!cancelled) setProgressLead(response.lead);
      } catch {
        // The enrich request owns error reporting. Keep the last real checkpoint visible.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [lead.id, showEnrichmentProgress]);

  // Row visual state varies by enrichment status
  let rowStyle: React.CSSProperties = { cursor: 'pointer' };
  if (lead.enrichment_status === 'enriching') rowStyle = { ...rowStyle, background: 'rgba(245,200,66,0.04)' };
  else if (lead.enrichment_status === 'pending') rowStyle = { ...rowStyle, opacity: 0.78 };
  else if (lead.enrichment_status === 'failed') rowStyle = { ...rowStyle, opacity: 0.6, background: 'rgba(248,113,113,0.04)' };

  async function handleEnrich() {
    setEnriching(true);
    setProgressLead({ ...lead, enrichment_status: 'enriching', enrichment_stage: 'preparing', enrichment_progress: 3 });
    setShowEnrichmentProgress(true);
    try {
      const response = await api.leads.enrich(lead.id);
      setProgressLead(response.lead);
      showToast(`Enriched ${lead.company}`, 'success');
      onLeadUpdated();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setProgressLead((current) => ({ ...current, enrichment_status: 'failed', enrichment_stage: 'failed', enrichment_error: msg }));
      showToast(`Enrichment failed: ${msg}`, 'error');
    } finally {
      setEnriching(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Move "${lead.company}" to trash? You can restore it later.`)) return;
    try {
      await api.leads.delete(lead.id);
      showToast(`${lead.company} moved to trash`, 'default', {
        label: 'Undo',
        onClick: async () => {
          try {
            await api.leads.restore(lead.id);
            showToast(`${lead.company} restored`, 'success');
            onLeadUpdated();
          } catch (err) {
            showToast(`Restore failed: ${(err as Error).message}`, 'error');
          }
        },
      });
      onLeadUpdated();
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`, 'error');
    }
  }

  async function handleRestore() {
    try {
      await api.leads.restore(lead.id);
      showToast(`${lead.company} restored`, 'success');
      onLeadUpdated();
    } catch (err) {
      showToast(`Restore failed: ${(err as Error).message}`, 'error');
    }
  }

  async function handleHardDelete() {
    if (!window.confirm(
      `Permanently delete "${lead.company}"? This cannot be undone — all call history will be lost.`
    )) return;
    try {
      await api.leads.hardDelete(lead.id);
      showToast(`${lead.company} permanently deleted`, 'default');
      onLeadUpdated();
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`, 'error');
    }
  }

  // stopPropagation wrapper so action-cell clicks don't trigger the row's
  // open-modal behaviour
  const stop = (e: React.MouseEvent | React.ChangeEvent) => e.stopPropagation();

  return (
    <>
    <tr style={rowStyle} onClick={() => onOpenLead(lead.id)}>
      <td onClick={stop} style={{ width: 32, textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(lead.id)}
          onClick={stop}
          aria-label={`Select ${lead.company}`}
          title={selected ? `Deselect ${lead.company}` : `Select ${lead.company} for bulk re-enrich`}
        />
      </td>
      <td
        className="td-co"
        style={lead.status === 'dead' || lead.status === 'not_interested'
          ? { textDecoration: 'line-through', color: 'var(--text3)' }
          : undefined}
      >
        <div style={{ minWidth: 190, lineHeight: 1.2 }}>
          <div style={{ fontWeight: 750 }}>{lead.company}</div>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, color: 'var(--text3)', fontFamily: 'var(--font)', fontSize: '0.63rem', fontWeight: 500 }}>
            {lead.city && <span>{lead.city}{lead.state ? `, ${lead.state}` : ''}</span>}
            {lead.city && <span style={{ color: 'var(--border)' }}>·</span>}
            {renderCompanyPhone(lead)}
            {renderCompanyWarning(lead)}
          </div>
        </div>
      </td>
      <td><FitSummary lead={lead} /></td>
      <td><CompactSignal label={route.label} sub={route.sub} tone={route.tone} /></td>
      <td><CompactSignal label={outreach.label} sub={outreach.sub} tone={outreach.tone} /></td>
      <td><CompactSignal label={latestTouch.label} sub={latestTouch.sub} tone={latestTouch.tone} /></td>
      <td><CompactSignal label={nextAction.label} sub={nextAction.sub} tone={nextAction.tone} /></td>
      <td><Badge color={stage.color}>{stage.label}</Badge></td>
      <td onClick={stop}>
        <div style={{ display: 'flex', gap: 5 }}>
          {lead.enrichment_status === 'enriched'
            && lead.status !== 'qualified'
            && lead.status !== 'client'
            && lead.status !== 'not_interested'
            && lead.status !== 'dead'
            && !lead.deleted_at && (
              <Button
                variant="primary"
                size="xs"
                onClick={() => onQualify(lead)}
                title="They signed — create the client workspace and carry over the outreach site and brief"
              >
                → Convert to client
              </Button>
          )}
          {lead.enrichment_status === 'pending' && (
            <Button variant="primary" size="xs" disabled={enriching} onClick={handleEnrich}>
              {enriching ? '⏳' : '✦'} Enrich
            </Button>
          )}
          {lead.enrichment_status === 'enriching' && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => { setProgressLead(lead); setShowEnrichmentProgress(true); }}
            >
              View progress
            </Button>
          )}
          {lead.enrichment_status === 'failed' && (
            <Button variant="ghost" size="xs" disabled={enriching} onClick={handleEnrich}>↻ Retry</Button>
          )}
          {lead.deleted_at ? (
            <>
              <Button variant="ghost" size="xs" onClick={handleRestore} title="Restore from trash">↺ Restore</Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleHardDelete}
                title="Permanently delete — cannot be undone"
                style={{ color: 'var(--red)' }}
              >
                🗑 Delete forever
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              onClick={handleDelete}
              title={lead.status === 'not_interested' ? 'Archive this closed prospect to recoverable Trash' : 'Move to trash'}
            >
              {lead.status === 'not_interested' ? 'Archive' : '🗑'}
            </Button>
          )}
        </div>
      </td>
    </tr>
    {showEnrichmentProgress && createPortal(
      <EnrichmentProgressModal
        lead={progressLead}
        onClose={() => setShowEnrichmentProgress(false)}
      />,
      document.body,
    )}
    </>
  );
}

const ENRICHMENT_STAGES = [
  ['preparing', 'Preparing lead'],
  ['matching_google_business', 'Matching Google Business profile'],
  ['loading_business_profile', 'Loading business details'],
  ['collecting_reviews_and_performance', 'Collecting reviews and performance'],
  ['analyzing_customer_reviews', 'Analyzing customer reviews'],
  ['calculating_opportunity_score', 'Calculating opportunity score'],
  ['saving_enrichment', 'Saving enrichment'],
  ['checking_phone_route', 'Checking phone route'],
] as const;

function EnrichmentProgressModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const failed = lead.enrichment_status === 'failed';
  const complete = lead.enrichment_status === 'enriched' || lead.enrichment_stage === 'complete';
  const progress = complete ? 100 : Math.max(3, Math.min(99, lead.enrichment_progress ?? 3));
  const activeIndex = ENRICHMENT_STAGES.findIndex(([key]) => key === lead.enrichment_stage);
  const resolvedIndex = complete ? ENRICHMENT_STAGES.length : Math.max(0, activeIndex);
  const remaining = complete ? 0 : Math.max(0, ENRICHMENT_STAGES.length - resolvedIndex - 1);
  const activeLabel = failed
    ? 'Enrichment stopped'
    : complete
      ? 'Enrichment complete'
      : ENRICHMENT_STAGES[resolvedIndex]?.[1] ?? 'Preparing lead';

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-slate-900/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !complete && !failed) onClose(); }}>
      <div className="w-full rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">Lead enrichment</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{lead.company}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close progress"><X className="h-4 w-4" /></button>
        </header>

        <div className="px-5 py-5">
          <div className={`flex items-center gap-3 rounded-xl px-4 py-3 ${failed ? 'bg-rose-50 text-rose-700' : complete ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
            {failed ? <X className="h-5 w-5" /> : complete ? <Check className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{activeLabel}</p>
              <p className="mt-0.5 text-[11px] opacity-75">{failed ? 'Review the error below and retry when ready.' : complete ? 'All enrichment steps finished successfully.' : `${remaining} step${remaining === 1 ? '' : 's'} remaining`}</p>
            </div>
            <strong className="text-xl tabular-nums">{progress}%</strong>
          </div>

          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${failed ? 'bg-rose-500' : complete ? 'bg-emerald-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`} style={{ width: `${progress}%` }} />
          </div>

          <div className="mt-5 space-y-1.5">
            {ENRICHMENT_STAGES.map(([key, label], index) => {
              const done = complete || index < resolvedIndex;
              const active = !failed && !complete && index === resolvedIndex;
              return (
                <div key={key} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs ${active ? 'bg-blue-50 font-semibold text-blue-700' : done ? 'text-slate-600' : 'text-slate-400'}`}>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${done ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-blue-500 text-blue-600' : 'border-slate-200 text-slate-300'}`}>
                    {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : index + 1}
                  </span>
                  {label}
                </div>
              );
            })}
          </div>

          {failed && lead.enrichment_error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-700">{lead.enrichment_error}</div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
          <p className="text-[11px] text-slate-400">You can close this window; enrichment will continue.</p>
          <button type="button" onClick={onClose} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800">{complete || failed ? 'Done' : 'Run in background'}</button>
        </footer>
      </div>
    </div>
  );
}

function FitSummary({ lead }: { lead: Lead }) {
  if (lead.enrichment_status !== 'enriched') {
    const label = lead.enrichment_status === 'enriching' ? 'Enriching…'
      : lead.enrichment_status === 'failed' ? 'Enrichment failed'
      : 'Not enriched';
    return <CompactSignal label={label} sub={lead.enrichment_status === 'failed' ? 'Retry needed' : 'Fit not scored'} tone={lead.enrichment_status === 'failed' ? 'red' : 'gray'} />;
  }
  const tier = lead.recommended_tier && [1, 2, 3].includes(lead.recommended_tier)
    ? `Tier ${lead.recommended_tier}` : 'No tier';
  const score = lead.opportunity_score != null ? ` · ${lead.opportunity_score}` : '';
  const reviewBits = [
    lead.google_review_count != null ? `${lead.google_review_count} reviews` : null,
    lead.google_rating != null ? `${lead.google_rating.toFixed(1)}★` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div style={{ minWidth: 105, lineHeight: 1.2 }}>
      <div style={{ color: tierColor(lead.recommended_tier as 1 | 2 | 3 | null), fontSize: '0.69rem', fontWeight: 800, whiteSpace: 'nowrap' }}>{tier}{score}</div>
      <div style={{ marginTop: 3, color: 'var(--text3)', fontSize: '0.61rem', whiteSpace: 'nowrap' }}>{reviewBits || 'No review data'}</div>
    </div>
  );
}

function renderCompanyPhone(lead: Lead): React.ReactNode {
  if (!lead.phone) return <span style={{ color: 'var(--red)', fontWeight: 750 }}>No phone</span>;
  if (lead.phone_valid === 0) return <span style={{ color: 'var(--red)', fontWeight: 750 }}>Invalid · {formatPhone(lead.phone)}</span>;
  if (lead.phone_route === 'review') return <span style={{ color: '#b7791f', fontWeight: 750 }}>⚠ Review · {formatPhone(lead.phone)}</span>;
  return <span>{formatPhone(lead.phone)}</span>;
}

function renderCompanyWarning(lead: Lead): React.ReactNode {
  if (lead.enrichment_status === 'failed') return <span title={lead.enrichment_error ?? 'Enrichment failed'} style={{ color: 'var(--red)', fontWeight: 750 }}>· Enrichment failed</span>;
  if (lead.enrichment_status === 'pending') return <span style={{ color: '#b7791f', fontWeight: 700 }}>· Not enriched</span>;
  if (lead.enrichment_status === 'enriching') return <span style={{ color: 'var(--blue)', fontWeight: 700 }}>· Enriching…</span>;
  return null;
}

type SignalTone = 'gray' | 'blue' | 'green' | 'yellow' | 'red';
interface SignalPresentation { label: string; sub?: string; tone: SignalTone }

const signalColors: Record<SignalTone, string> = {
  gray: 'var(--text3)', blue: 'var(--blue)', green: 'var(--green)',
  yellow: '#b7791f', red: 'var(--red)',
};

function CompactSignal({ label, sub, tone }: SignalPresentation) {
  return (
    <div style={{ minWidth: 92, maxWidth: 150, lineHeight: 1.2 }}>
      <div style={{ color: signalColors[tone], fontSize: '0.69rem', fontWeight: 750, whiteSpace: 'nowrap' }}>{label}</div>
      {sub && <div style={{ marginTop: 3, color: 'var(--text3)', fontSize: '0.61rem', whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  );
}

function routePresentation(lead: Lead): SignalPresentation {
  if (lead.phone_route === 'text') return { label: 'Text', sub: lead.phone_line_type ?? 'Textable number', tone: 'green' };
  if (lead.phone_route === 'call') return { label: 'Call', sub: lead.phone_line_type ?? 'Voice route', tone: 'blue' };
  if (lead.phone_route === 'review') return { label: 'Review', sub: lead.phone_line_type ?? 'Check routing', tone: 'yellow' };
  return { label: 'Unknown', sub: 'Not classified', tone: 'gray' };
}

function outreachPresentation(lead: Lead): SignalPresentation {
  const map: Record<Lead['pipeline_status'], SignalPresentation> = {
    awaiting_build: { label: 'Site needed', sub: 'Not ready to send', tone: 'gray' },
    ready_to_send: { label: 'Ready to send', sub: 'Intro not sent', tone: 'blue' },
    sent_no_reply: {
      label: lead.pipeline_no_reply_step ? `Follow-up ${lead.pipeline_no_reply_step}` : 'Sent · no reply',
      sub: 'Waiting for response', tone: 'yellow',
    },
    engaged: { label: 'Engaged', sub: engagementLabel(lead.engagement_grade), tone: 'green' },
    booked: { label: 'Demo booked', sub: lead.demo_scheduled_for ? shortDate(lead.demo_scheduled_for) : 'Moved to Sites', tone: 'green' },
    archived: { label: 'Archived', sub: 'Outreach closed', tone: 'gray' },
  };
  return map[lead.pipeline_status];
}

function latestTouchPresentation(lead: Lead): SignalPresentation {
  const action = lead.pipeline_last_action;
  const meta = parseMeta(lead.pipeline_last_action_meta);
  const age = relativeAge(lead.pipeline_last_action_created_at ?? lead.pipeline_last_action_at);
  const descriptions: Record<string, { label: string; tone: SignalTone }> = {
    brief_generated: { label: 'Brief generated', tone: 'gray' },
    email_captured: { label: 'Email captured', tone: 'gray' },
    email_sent: { label: 'Email · Intro sent', tone: 'blue' },
    email_followed_up: { label: 'Email · Follow-up', tone: 'blue' },
    email_final_touch: { label: 'Email · Final touch', tone: 'yellow' },
    intro_sent: { label: 'Text · Intro sent', tone: 'blue' },
    followed_up: { label: 'Text · Follow-up', tone: 'blue' },
    reply_received: { label: 'Text · Replied', tone: 'green' },
    click_tracked: { label: 'Site · Visited', tone: 'green' },
    visit_confirmed: { label: 'Site · Visit confirmed', tone: 'green' },
    calendar_sent: { label: 'Calendar sent', tone: 'blue' },
    calendar_clicked: { label: 'Calendar opened', tone: 'green' },
    scheduling_followup: { label: 'Scheduling follow-up', tone: 'blue' },
    called: { label: 'Call placed', tone: 'blue' },
    archived: { label: 'Archived', tone: 'gray' },
  };
  if (action === 'call_outcome') {
    const label = typeof meta.label === 'string' ? meta.label : typeof meta.outcome === 'string' ? humanize(meta.outcome) : lead.outcome ?? 'Call logged';
    return { label: `Call · ${label}`, sub: age, tone: callOutcomeTone(label) };
  }
  const found = action ? descriptions[action] : null;
  if (found) return { ...found, sub: age };
  if (lead.outcome) {
    const channel = legacyOutcomeChannel(lead.outcome);
    const when = channel === 'Call' ? lead.last_called_at : lead.pipeline_last_action_at;
    return { label: `${channel} · ${lead.outcome}`, sub: relativeAge(when), tone: callOutcomeTone(lead.outcome) };
  }
  return { label: 'No outreach yet', sub: 'No activity recorded', tone: 'gray' };
}

function nextActionPresentation(lead: Lead): SignalPresentation {
  if (lead.status === 'client') return { label: 'Manage client', sub: 'Open Clients & Sites', tone: 'green' };
  if (lead.status === 'qualified' || lead.pipeline_status === 'booked') return { label: 'Prepare demo', sub: lead.demo_scheduled_for ? shortDate(lead.demo_scheduled_for) : 'Demo booked', tone: 'green' };
  if (lead.status === 'not_interested') return { label: 'Archive', sub: 'If outreach is complete', tone: 'gray' };
  if (lead.status === 'dead' || lead.pipeline_status === 'archived') return { label: 'No action', sub: 'Closed', tone: 'gray' };
  if (lead.phone_route === 'review') return { label: 'Review route', sub: 'Confirm text or call', tone: 'yellow' };
  if (lead.followup) return { label: 'Callback', sub: shortDate(lead.followup), tone: 'yellow' };
  if (lead.pipeline_status === 'engaged') {
    if (lead.engagement_grade === 'hot') return { label: 'Call now', sub: 'High engagement', tone: 'red' };
    if (lead.engagement_grade === 'walkthrough') return { label: 'Offer walkthrough', sub: 'Ready now', tone: 'green' };
    return { label: 'Send follow-up', sub: 'Engaged lead', tone: 'blue' };
  }
  if (lead.phone_route === 'text' || lead.phone_route === 'unknown') {
    if (lead.pipeline_status === 'awaiting_build') return { label: 'Build site', sub: 'Then send intro', tone: 'blue' };
    if (lead.pipeline_status === 'ready_to_send') return { label: 'Send intro', sub: 'Ready now', tone: 'green' };
    const step = lead.pipeline_no_reply_step ?? 0;
    if (step === 0) return { label: 'Send reminder', sub: touchAgeLabel(lead), tone: 'yellow' };
    if (step === 1) return { label: 'Send final text', sub: touchAgeLabel(lead), tone: 'yellow' };
    return { label: 'Call · last chance', sub: 'Text sequence complete', tone: 'red' };
  }
  if (lead.outcome?.toLowerCase().includes('voicemail') || lead.outcome?.toLowerCase().includes('no answer')) {
    return { label: 'Call again', sub: relativeAge(lead.last_called_at), tone: 'yellow' };
  }
  return { label: 'Start call', sub: 'Ready now', tone: 'blue' };
}

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
  catch { return {}; }
}

function engagementLabel(grade: string): string {
  if (grade === 'hot') return 'Call immediately';
  if (grade === 'walkthrough') return 'Offer walkthrough';
  if (grade === 'follow_up') return 'Follow up';
  return 'Nurture';
}

function callOutcomeTone(label: string): SignalTone {
  const value = label.toLowerCase();
  if (value.includes('booked') || value.includes('interested')) return 'green';
  if (value.includes('not interested')) return 'red';
  if (value.includes('callback') || value.includes('voicemail') || value.includes('no answer')) return 'yellow';
  return 'blue';
}

function legacyOutcomeChannel(outcome: string): 'Call' | 'Text' | 'Email' {
  const value = outcome.toLowerCase();
  if (value.includes('email')) return 'Email';
  if (value.includes('text') || value.includes('sms') || value.includes('replied')) return 'Text';
  return 'Call';
}

function relativeAge(raw: string | null | undefined): string {
  if (!raw) return 'Recently';
  const date = new Date(raw.replace(' ', 'T') + (raw.includes('Z') || /[+-]\d\d:\d\d$/.test(raw) ? '' : 'Z'));
  if (Number.isNaN(date.getTime())) return 'Recently';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 60) return minutes < 2 ? 'Just now' : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
}

function shortDate(raw: string): string {
  const date = new Date(raw.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function touchAgeLabel(lead: Lead): string {
  const age = relativeAge(lead.pipeline_last_action_created_at ?? lead.pipeline_last_action_at);
  return age === 'Recently' ? 'Waiting for response' : `Last touch ${age}`;
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

// Re-export so the parent can show the score color helper if needed
export { scoreColor };
