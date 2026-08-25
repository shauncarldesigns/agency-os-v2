import { useEffect, useState } from 'react';
import { Mail, Phone, PhoneIncoming } from 'lucide-react';
import { api } from '../../lib/api';
import type { Lead } from '../../lib/types';

export function ReceptionistInterestPage({ showToast }: { showToast: (message: string, type?: 'success' | 'error') => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.leads.list({ status: 'not_interested' })
      .then(({ leads: rows }) => setLeads(
        rows
          .filter((lead) => lead.receptionist_interested === 1 && lead.deleted_at === null)
          .sort((a, b) => (b.receptionist_interested_at ?? '').localeCompare(a.receptionist_interested_at ?? '')),
      ))
      .catch((error) => showToast(`Could not load receptionist interest: ${(error as Error).message}`, 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  return (
    <div className="main">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white"><PhoneIncoming className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Interested businesses</h2>
              <p className="text-sm text-slate-500">A simple demand list for validating the automated receptionist idea.</p>
            </div>
            <span className="ml-auto rounded-full bg-white px-3 py-1 text-sm font-bold text-blue-700 shadow-sm">{leads.length}</span>
          </div>
        </div>

        {loading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p> : leads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <PhoneIncoming className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 font-medium text-slate-600">No receptionist interest recorded yet</p>
            <p className="mt-1 text-sm text-slate-400">Interested website declines will appear here.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <div key={lead.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{lead.company}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[lead.contact, lead.industry, [lead.city, lead.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'No additional details'}
                    </p>
                    {lead.notes && <p className="mt-2 line-clamp-2 text-xs text-slate-500">{lead.notes}</p>}
                  </div>
                  <div className="text-xs text-slate-400">
                    {lead.receptionist_interested_at ? new Date(lead.receptionist_interested_at).toLocaleDateString() : 'Date unavailable'}
                  </div>
                  <div className="flex gap-2">
                    {lead.phone && <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><Phone className="h-3.5 w-3.5" />Call</a>}
                    {lead.email && <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><Mail className="h-3.5 w-3.5" />Email</a>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
