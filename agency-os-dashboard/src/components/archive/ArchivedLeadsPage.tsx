import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Ban, BarChart3, CheckCircle2, Eye, Globe2, Link2, PhoneOff, RefreshCw, RotateCcw, Search, Trash2, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Lead, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { LeadDetailModal } from '../shared/LeadDetailModal';
import { NOT_INTERESTED_REASONS } from '../shared/NotInterestedModal';

type ArchiveFilter = 'all' | 'cleanup_needed' | 'deleted' | 'no_site';

export function ArchivedLeadsPage({ showToast, onChanged }: { showToast: ShowToast; onChanged?: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ArchiveFilter>('all');
  const [openLeadId, setOpenLeadId] = useState<number | null>(null);
  const [reactivateLead, setReactivateLead] = useState<Lead | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { leads: rows } = await api.leads.list({ pipeline_status: 'archived' });
      setLeads(rows.filter((lead) =>
        lead.pipeline_status === 'archived'
        && lead.receptionist_interested !== 1
        && lead.status !== 'client'
        && lead.status !== 'qualified'
        && !lead.project_id
      ));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not load archived leads', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  const cleanupCount = leads.filter((lead) => lead.demo_site_status === 'cleanup_needed').length;
  const declineStats = useMemo(() => {
    const declined = leads.filter((lead) => lead.status === 'not_interested');
    const counts = new Map<string, number>();
    declined.forEach((lead) => {
      if (lead.not_interested_reason) counts.set(lead.not_interested_reason, (counts.get(lead.not_interested_reason) ?? 0) + 1);
    });
    const reasons = NOT_INTERESTED_REASONS
      .map((option) => ({ ...option, count: counts.get(option.value) ?? 0 }))
      .filter((option) => option.count > 0)
      .sort((a, b) => b.count - a.count);
    const classified = reasons.reduce((sum, reason) => sum + reason.count, 0);
    return { classified, reasons };
  }, [leads]);
  const filtered = useMemo(() => leads.filter((lead) => {
    const q = query.trim().toLowerCase();
    const matchesSearch = !q || [lead.company, lead.contact, lead.phone, lead.email, lead.city]
      .some((value) => (value ?? '').toLowerCase().includes(q));
    if (!matchesSearch) return false;
    if (filter === 'cleanup_needed') return lead.demo_site_status === 'cleanup_needed';
    if (filter === 'deleted') return lead.demo_site_status === 'deleted';
    if (filter === 'no_site') return lead.demo_site_status === 'none';
    return true;
  }), [leads, query, filter]);

  const completeCleanup = async (lead: Lead) => {
    if (!window.confirm(`Confirm that the demo site for "${lead.company}" has been deleted in LandingSite.`)) return;
    try {
      const { lead: updated } = await api.pipeline.updateDemoSiteStatus(lead.id, 'deleted');
      setLeads((current) => current.map((item) => item.id === updated.id ? updated : item));
      showToast(`${lead.company} site cleanup complete`, 'success');
      onChanged?.();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not complete cleanup', 'error');
    }
  };

  const reactivate = async (lead: Lead, workspace: ReactivationWorkspace, destination?: ReactivationDestination) => {
    try {
      await api.leads.reactivate(lead.id, { workspace, destination });
      setLeads((current) => current.filter((item) => item.id !== lead.id));
      setReactivateLead(null);
      showToast(`${lead.company} moved to ${workspaceLabel(workspace)}${destination ? ` · ${reactivationLabel(destination)}` : ''}`, 'success');
      onChanged?.();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not reactivate lead', 'error');
    }
  };

  return (
    <div className="main">
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Archived leads</h2>
            <p className="mt-1 text-sm text-slate-500">Closed prospects from every outreach channel, with site cleanup and reactivation in one place.</p>
          </div>
          <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${cleanupCount ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
            {cleanupCount ? `${cleanupCount} site${cleanupCount === 1 ? '' : 's'} need cleanup` : 'Site cleanup is clear'}
          </div>
        </div>
      </section>

      <ArchiveOverview leads={leads} />
      <ArchiveInsights stats={declineStats} />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, contact, phone, email, city…" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
        </div>
        <select value={filter} onChange={(event) => setFilter(event.target.value as ArchiveFilter)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm">
          <option value="all">All archived</option>
          <option value="cleanup_needed">Cleanup required</option>
          <option value="deleted">Site deleted</option>
          <option value="no_site">No demo site</option>
        </select>
        <button type="button" onClick={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
      </div>

      {loading ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-400">Loading archived leads…</div>
      : filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center"><Archive className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No archived leads match this view</p></div>
      : <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {filtered.map((lead) => {
          const siteUrl = lead.site_url_raw || lead.site_url;
          const cleanupNeeded = lead.demo_site_status === 'cleanup_needed';
          const route = archiveRoute(lead);
          const latestTouch = archiveLatestTouch(lead);
          const isNotInterested = lead.status === 'not_interested';
          return <article key={lead.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${cleanupNeeded ? 'border-amber-200' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-bold text-slate-900">{lead.company}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cleanupNeeded ? 'bg-amber-100 text-amber-700' : lead.demo_site_status === 'deleted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{cleanupNeeded ? 'Cleanup required' : lead.demo_site_status === 'deleted' ? 'Site deleted' : 'No demo site'}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{[lead.city, lead.state].filter(Boolean).join(', ') || 'Location unavailable'} · {lead.outcome || 'Archived'}</p>
              </div>
              <button type="button" onClick={() => setOpenLeadId(lead.id)} className="rounded-lg p-2 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="View lead and activity"><Eye className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-2 sm:grid-cols-4">
              <ArchiveSignal label="Route" value={route.label} sub={route.sub} tone={route.tone} />
              <ArchiveSignal label="Latest touch" value={latestTouch.label} sub={latestTouch.sub} tone={latestTouch.tone} />
              <ArchiveSignal label="Closeout" value={archiveCloseoutLabel(lead)} sub={archiveCloseoutDetail(lead)} tone={isNotInterested ? 'rose' : 'slate'} />
              <ArchiveSignal label="Archive reason" value={archiveReasonLabel(lead)} sub={archiveReasonDetail(lead)} tone={isNotInterested ? 'rose' : 'slate'} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {cleanupNeeded && siteUrl && <a href={siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"><Link2 className="h-3.5 w-3.5" /> Open demo</a>}
              {cleanupNeeded && <button type="button" onClick={() => void completeCleanup(lead)} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600"><Trash2 className="h-3.5 w-3.5" /> Mark site deleted</button>}
              {lead.demo_site_status === 'deleted' && <span className="inline-flex items-center gap-1.5 px-2 py-2 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Cleanup complete</span>}
              <button type="button" onClick={() => setReactivateLead(lead)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><RotateCcw className="h-3.5 w-3.5" /> Reactivate</button>
            </div>
          </article>;
        })}
      </div>}

      {openLeadId != null && <LeadDetailModal leadId={openLeadId} onClose={() => setOpenLeadId(null)} showToast={showToast} onLeadUpdated={() => void load()} pipelineContext />}
      {reactivateLead && <ReactivateLeadModal lead={reactivateLead} onClose={() => setReactivateLead(null)} onConfirm={(workspace, destination) => void reactivate(reactivateLead, workspace, destination)} />}
    </div>
  );
}

type DeclineStats = {
  classified: number;
  reasons: Array<{ value: string; label: string; count: number }>;
};

function ArchiveOverview({ leads }: { leads: Lead[] }) {
  const stats = [
    { label: 'Total archived', value: leads.length, detail: 'Closed opportunities', icon: Archive, tone: 'slate' as const },
    { label: 'Not interested', value: leads.filter((lead) => lead.status === 'not_interested').length, detail: 'Customer declined', icon: Ban, tone: 'rose' as const },
    { label: 'Unable to reach', value: leads.filter(isBadContactLead).length, detail: 'Contact or access issue', icon: PhoneOff, tone: 'violet' as const },
    { label: 'Cleanup required', value: leads.filter((lead) => lead.demo_site_status === 'cleanup_needed').length, detail: 'Demo sites to delete', icon: TriangleAlert, tone: 'amber' as const },
    { label: 'Sites deleted', value: leads.filter((lead) => lead.demo_site_status === 'deleted').length, detail: 'Cleanup completed', icon: CheckCircle2, tone: 'emerald' as const },
    { label: 'No demo site', value: leads.filter((lead) => lead.demo_site_status === 'none').length, detail: 'Nothing to clean', icon: Globe2, tone: 'blue' as const },
  ];
  return <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {stats.map((stat) => <ArchiveMetric key={stat.label} {...stat} />)}
    </div>
  </section>;
}

function ArchiveMetric({ label, value, detail, icon: Icon, tone }: { label: string; value: number; detail: string; icon: LucideIcon; tone: 'slate' | 'rose' | 'violet' | 'amber' | 'emerald' | 'blue' }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-600', rose: 'bg-rose-50 text-rose-600', violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600', emerald: 'bg-emerald-50 text-emerald-600', blue: 'bg-blue-50 text-blue-600',
  }[tone];
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors}`}><Icon className="h-4 w-4" /></div>
    <p className="mt-3 text-2xl font-bold leading-none text-slate-950">{value}</p>
    <p className="mt-2 text-xs font-semibold text-slate-700">{label}</p>
    <p className="mt-0.5 truncate text-[10px] text-slate-400">{detail}</p>
  </div>;
}

function ArchiveInsights({ stats }: { stats: DeclineStats }) {
  return <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2">
      <BarChart3 className="h-4 w-4 text-blue-600" />
      <div><h3 className="text-sm font-bold text-slate-900">Why customers decline</h3><p className="text-xs text-slate-500">Customer feedback from Not Interested closeouts only.</p></div>
    </div>
    {stats.reasons.length > 0 ? <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
      {stats.reasons.map((reason, index) => {
        const percentage = stats.classified ? Math.round((reason.count / stats.classified) * 100) : 0;
        const isMostCommon = index === 0;
        return <div key={reason.value} className={`relative min-w-0 rounded-xl border p-3 ${isMostCommon ? 'border-blue-200 bg-blue-50/70 shadow-sm' : 'border-slate-200 bg-slate-50/40'}`}>
          {isMostCommon && <span className="absolute right-2.5 top-2.5 rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-700">Most common</span>}
          <p className={`text-2xl font-bold leading-none ${isMostCommon ? 'text-blue-700' : 'text-slate-950'}`}>{percentage}%</p>
          <p className="mt-3 text-xs font-semibold text-slate-700">{reason.label}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">{reason.count} of {stats.classified} customer decline{stats.classified === 1 ? '' : 's'}</p>
        </div>;
      })}
    </div> : <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs text-slate-500">Archive a lead with a Not Interested reason to start building the breakdown.</div>}
  </section>;
}

function notInterestedReasonLabel(reason: string | null): string {
  if (!reason) return 'Reason not recorded';
  return NOT_INTERESTED_REASONS.find((option) => option.value === reason)?.label ?? reason.replaceAll('_', ' ');
}

function archiveCloseoutLabel(lead: Lead): string {
  if (lead.status === 'not_interested') return 'Not interested';
  const outcome = lead.outcome?.trim();
  if (!outcome) return 'Archived';
  if (isBadContactLead(lead)) return 'Unable to reach';
  return outcome;
}

function archiveReasonLabel(lead: Lead): string {
  if (lead.status === 'not_interested') return notInterestedReasonLabel(lead.not_interested_reason);
  if (isBadContactLead(lead)) return lead.outcome?.trim() || 'Reason not recorded';
  return lead.outcome?.trim() || 'Reason not recorded';
}

function archiveReasonDetail(lead: Lead): string {
  if (lead.status === 'not_interested') return 'Customer feedback';
  if (isBadContactLead(lead)) return 'Reachability issue';
  return 'Archive context';
}

function isBadContactLead(lead: Lead): boolean {
  const outcome = lead.outcome?.trim() ?? '';
  return ['Disconnected number', 'Wrong number', 'No usable contact information', 'Business appears closed', 'Call screening blocked', 'Bad contact', 'Unable to reach'].includes(outcome);
}

function archiveCloseoutDetail(lead: Lead): string {
  if (lead.status === 'not_interested') return 'Customer declined';
  if (isBadContactLead(lead)) return 'Contact or access issue';
  return 'Outreach closed';
}

type ArchiveTone = 'slate' | 'blue' | 'emerald' | 'rose';

function ArchiveSignal({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: ArchiveTone }) {
  const color = tone === 'blue' ? 'text-blue-600' : tone === 'emerald' ? 'text-emerald-600' : tone === 'rose' ? 'text-rose-600' : 'text-slate-600';
  return <div className="min-w-0 rounded-lg bg-white px-2.5 py-2">
    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    <p className={`mt-1 truncate text-xs font-bold ${color}`}>{value}</p>
    <p className="mt-0.5 truncate text-[10px] text-slate-400">{sub}</p>
  </div>;
}

function archiveRoute(lead: Lead): { label: string; sub: string; tone: ArchiveTone } {
  if (lead.phone_route === 'text') return { label: 'Text', sub: lead.phone_line_type || 'mobile', tone: 'emerald' };
  if (lead.phone_route === 'call') return { label: 'Call', sub: lead.phone_line_type || 'phone outreach', tone: 'blue' };
  if (lead.phone_route === 'review') return { label: 'Review', sub: 'route reviewed', tone: 'slate' };
  if (lead.email) return { label: 'Email', sub: 'email available', tone: 'blue' };
  return { label: 'Unknown', sub: 'no route recorded', tone: 'slate' };
}

function archiveLatestTouch(lead: Lead): { label: string; sub: string; tone: ArchiveTone } {
  const action = lead.pipeline_last_action;
  const isDecline = action === 'call_outcome' || (!action && lead.status === 'not_interested');
  const label = action === 'call_outcome' && lead.status === 'not_interested'
    ? 'Call · Not interested'
    : action ? archiveActionLabel(action) : isDecline ? 'Not interested' : 'Archived';
  const timestamp = lead.pipeline_last_action_created_at || lead.pipeline_last_action_at || lead.last_called_at || lead.updated_at;
  return { label, sub: relativeTime(timestamp), tone: isDecline ? 'emerald' : 'slate' };
}

function archiveActionLabel(action: string): string {
  const labels: Record<string, string> = {
    archived: 'Archived', call_outcome: 'Call completed', email_final_touch: 'Final email',
    email_followed_up: 'Email follow-up', followed_up: 'Text follow-up', reply_received: 'Reply received',
    demo_site_status_changed: 'Site cleanup', reactivated: 'Reactivated',
  };
  return labels[action] || action.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
}

function relativeTime(raw: string | null | undefined): string {
  if (!raw) return 'Date unavailable';
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const timestamp = new Date(normalized).getTime();
  if (Number.isNaN(timestamp)) return 'Date unavailable';
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

type ReactivationDestination = 'awaiting_build' | 'built_needs_review' | 'ready_to_send';
type ReactivationWorkspace = 'text' | 'email' | 'receptionist';

function reactivationLabel(destination: ReactivationDestination): string {
  return destination === 'awaiting_build' ? 'Awaiting Build' : destination === 'built_needs_review' ? 'Review Site' : 'Ready to Send';
}

function workspaceLabel(workspace: ReactivationWorkspace): string {
  return workspace === 'text' ? 'Text Outreach' : workspace === 'email' ? 'Email Outreach' : 'Receptionist Interest';
}

function ReactivateLeadModal({ lead, onClose, onConfirm }: { lead: Lead; onClose: () => void; onConfirm: (workspace: ReactivationWorkspace, destination?: ReactivationDestination) => void }) {
  const hasSite = lead.demo_site_status !== 'deleted' && Boolean(lead.site_url_raw || lead.site_url);
  const [workspace, setWorkspace] = useState<ReactivationWorkspace>(lead.phone_route === 'call' ? 'email' : 'text');
  const [destination, setDestination] = useState<ReactivationDestination>(hasSite ? (lead.site_review_status === 'approved' ? 'ready_to_send' : 'built_needs_review') : 'awaiting_build');
  const options: Array<{ value: ReactivationDestination; title: string; description: string; disabled?: boolean }> = [
    { value: 'awaiting_build', title: 'Awaiting Build', description: hasSite ? 'Start over and remove the saved demo URL from the active workflow.' : 'Return the lead to the website build queue.' },
    { value: 'built_needs_review', title: 'Review Site', description: 'Return the existing demo for review or fixes.', disabled: !hasSite },
    { value: 'ready_to_send', title: 'Ready to Send', description: 'Treat the existing demo as approved and ready for outreach.', disabled: !hasSite },
  ];
  return <div className="fixed inset-0 z-[270] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
      <h3 className="text-base font-semibold text-slate-900">Reactivate {lead.company}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">First choose which workspace owns the lead. Email and text automations remain stopped until deliberately restarted.</p>
      <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Return to</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(['text', 'email', 'receptionist'] as ReactivationWorkspace[]).map((option) => <button key={option} type="button" onClick={() => setWorkspace(option)} className={`rounded-xl border px-2 py-2.5 text-xs font-semibold transition ${workspace === option ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{option === 'text' ? 'Text' : option === 'email' ? 'Email' : 'Receptionist'}</button>)}
      </div>
      {workspace !== 'receptionist' && <>
      <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Pipeline stage</p>
      <div className="mt-4 space-y-2">
        {options.map((option) => <label key={option.value} className={`flex items-start gap-3 rounded-xl border p-3 ${option.disabled ? 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-50' : destination === option.value ? 'cursor-pointer border-blue-300 bg-blue-50' : 'cursor-pointer border-slate-200 hover:bg-slate-50'}`}>
          <input type="radio" name="reactivation-destination" value={option.value} checked={destination === option.value} disabled={option.disabled} onChange={() => setDestination(option.value)} className="mt-0.5 h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500" />
          <span><span className="block text-xs font-semibold text-slate-800">{option.title}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{option.description}</span></span>
        </label>)}
      </div>
      </>}
      {workspace === 'receptionist' && <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">The website opportunity stays closed. This business becomes active in Receptionist Interest, where any demo-site cleanup remains visible.</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
        <button type="button" onClick={() => onConfirm(workspace, workspace === 'receptionist' ? undefined : destination)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">Move to {workspaceLabel(workspace)}{workspace === 'receptionist' ? '' : ` · ${reactivationLabel(destination)}`}</button>
      </div>
    </div>
  </div>;
}
