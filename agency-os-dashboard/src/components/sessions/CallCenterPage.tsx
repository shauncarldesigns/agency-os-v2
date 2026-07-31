import { useEffect, useMemo, useState } from 'react';
import { Building2, Headphones, Play, Search } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Lead, ShowToast } from '../../lib/types';
import { ExecutionView } from '../dashboard/ExecutionView';
import { Spinner } from '../shared/Spinner';

interface Props {
  session: { sessionId: number; leadId?: number } | null;
  showToast: ShowToast;
  onOpenSession: (sessionId: number, leadId?: number) => void;
  onCloseSession: () => void;
  onPauseAndBuild: (projectId: number) => void;
}

export function CallCenterPage({
  session,
  showToast,
  onOpenSession,
  onCloseSession,
  onPauseAndBuild,
}: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(session?.leadId ?? null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.leads.list()
      .then((res) => {
        if (!cancelled) setLeads(res.leads);
      })
      .catch((err) => {
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        showToast(`Could not load companies: ${msg}`, 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [showToast]);

  useEffect(() => {
    if (session?.leadId) setSelectedLeadId(session.leadId);
  }, [session?.leadId]);

  const companies = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return leads
      .filter((lead) =>
        lead.deleted_at === null
        && lead.status !== 'dead'
        && lead.status !== 'not_interested'
        && lead.phone_route !== 'text'
        && lead.phone_route !== 'review'
      )
      .filter((lead) => {
        if (!needle) return true;
        return [lead.company, lead.city, lead.state, lead.phone]
          .some((value) => value?.toLowerCase().includes(needle));
      })
      .sort((a, b) => a.company.localeCompare(b.company));
  }, [leads, query]);

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;

  async function openSelectedCompany() {
    if (selectedLeadId === null) return;
    setOpening(true);
    try {
      const res = await api.sessions.hotAdd([selectedLeadId]);
      onOpenSession(res.session_id, selectedLeadId);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not open company in Call Center: ${msg}`, 'error');
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-6 sm:px-6 lg:px-8">
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              <label htmlFor="call-center-company" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Selected company
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(180px,0.65fr)_minmax(260px,1.35fr)]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search companies"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <select
                id="call-center-company"
                value={selectedLeadId ?? ''}
                onChange={(event) => setSelectedLeadId(event.target.value ? Number(event.target.value) : null)}
                disabled={loading}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
              >
                <option value="">{loading ? 'Loading companies…' : 'Choose a company'}</option>
                {companies.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.company}{lead.city ? ` — ${lead.city}${lead.state ? `, ${lead.state}` : ''}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void openSelectedCompany()}
            disabled={selectedLeadId === null || opening}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {opening ? <Spinner /> : <Play className="h-4 w-4" />}
            {session && session.leadId === selectedLeadId ? 'Reload company' : 'Open company'}
          </button>
        </div>
        {selectedLead && (
          <p className="mt-2 text-xs text-slate-500">
            {selectedLead.company}
            {selectedLead.phone ? ` · ${selectedLead.phone}` : ' · No phone number'}
            {selectedLead.industry ? ` · ${selectedLead.industry}` : ''}
          </p>
        )}
      </section>

      {session ? (
        <ExecutionView
          key={`${session.sessionId}-${session.leadId ?? 'queue'}`}
          sessionId={session.sessionId}
          initialLeadId={session.leadId}
          showToast={showToast}
          onClose={onCloseSession}
          onPauseAndBuild={onPauseAndBuild}
        />
      ) : (
        <section className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/70 px-6 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50">
            <Headphones className="h-7 w-7 text-blue-600" />
          </div>
          <h2 className="text-base font-bold text-slate-900">Choose a company to start calling</h2>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Select a company above, or open one from the Call Outreach board. The full execution playbook will stay on this page.
          </p>
        </section>
      )}
    </div>
  );
}
