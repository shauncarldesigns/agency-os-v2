import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, Clock3, Download, ExternalLink, LockKeyhole, Mail, MessageSquare, PhoneIncoming, Play, RefreshCw, RotateCcw, Send, Settings2, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Lead, RetellResourceInventory, RetellSetupPackage, VoiceAgentSpec, VoiceBusinessProfile, VoiceCall, VoiceCallMetadata, VoiceClassification, VoiceIntake, VoiceLead, VoiceOverview, VoiceProfileConfiguration, VoiceQaResult, VoiceReadinessResult, VoiceSimulatorResult, VoiceSimulatorTurn } from '../../lib/types';
import { AuthenticatedAudioPlayer } from '../shared/AuthenticatedAudioPlayer';

type ShowToast = (message: string, type?: 'success' | 'error') => void;

export function ReceptionistInterestPage({ showToast }: { showToast: ShowToast }) {
  const [activeTab, setActiveTab] = useState<'leads' | 'profiles' | 'activity'>('leads');
  const [interestedLeads, setInterestedLeads] = useState<Lead[]>([]);
  const [archivedLeads, setArchivedLeads] = useState<Lead[]>([]);
  const [importLeadId, setImportLeadId] = useState('');
  const [overview, setOverview] = useState<VoiceOverview | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<VoiceBusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsResult, archivedResult, voiceResult] = await Promise.all([api.leads.list({ status: 'not_interested' }), api.leads.list({ pipeline_status: 'archived' }), api.voice.overview()]);
      setInterestedLeads(leadsResult.leads.filter((lead) => lead.receptionist_interested === 1 && lead.deleted_at === null));
      setArchivedLeads(archivedResult.leads.filter((lead) => lead.deleted_at === null && Boolean(lead.extracted_services || lead.extracted_service_areas || lead.gbp_hours)));
      setOverview(voiceResult);
      setSelectedProfile((current) => current ? voiceResult.profiles.find((profile) => profile.id === current.id) ?? null : voiceResult.profiles[0] ?? null);
    } catch (error) {
      showToast(`Could not load receptionist workspace: ${(error as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  const createTestProfile = async () => {
    setWorking(true);
    try {
      const { profile } = await api.voice.createTestProfile();
      setSelectedProfile(profile);
      await load();
      showToast('Internal receptionist test profile is ready', 'success');
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Could not create test profile', 'error');
    } finally { setWorking(false); }
  };

  const prepareLead = async (lead: Lead) => {
    setWorking(true);
    try {
      const { profile } = await api.voice.createProfileFromLead(lead.id);
      setSelectedProfile(profile);
      await load();
      setActiveTab('profiles');
      showToast(`${lead.company} voice demo prepared`, 'success');
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : 'Could not prepare voice demo', 'error');
    } finally { setWorking(false); }
  };

  const openProfile = (profile: VoiceBusinessProfile, target: 'editor' | 'calls' = 'editor') => {
    setSelectedProfile(profile);
    setActiveTab(target === 'calls' ? 'activity' : 'profiles');
    window.setTimeout(() => document.getElementById(target === 'editor' ? 'profile-editor' : 'profile-calls')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  if (loading && !overview) return <div className="main py-16 text-center text-sm text-slate-400">Loading receptionist workspace…</div>;

  return <div className="main"><div className="mx-auto max-w-6xl space-y-5">
    <section className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-xl bg-blue-600 p-2.5 text-white"><PhoneIncoming className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold text-slate-900">Automated Receptionist</h2><p className="text-sm text-slate-500">Prepare, test, and eventually send personalized receptionist demos.</p></div>
        <button type="button" onClick={() => void load()} className="rounded-lg border border-blue-200 bg-white p-2 text-blue-700 hover:bg-blue-50" title="Refresh"><RefreshCw className="h-4 w-4" /></button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <StatusCard label="Integration" value={overview?.health.mode === 'live' ? 'Live' : 'Mock mode'} good={overview?.health.readyForLiveCalls === true} />
        <StatusCard label="Calls" value={String(overview?.totals.calls_answered ?? 0)} />
        <StatusCard label="Opportunities" value={String(overview?.totals.opportunities ?? 0)} />
        <StatusCard label="Sales screened" value={String(overview?.totals.screened ?? 0)} />
      </div>
    </section>

    <nav aria-label="Receptionist workspace" className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
      <WorkspaceTab active={activeTab === 'leads'} label="Interested Leads" count={interestedLeads.length} onClick={() => setActiveTab('leads')} />
      <WorkspaceTab active={activeTab === 'profiles'} label="Demo Profiles" count={overview?.profiles.length ?? 0} onClick={() => setActiveTab('profiles')} />
      <WorkspaceTab active={activeTab === 'activity'} label="Test & Activity" count={overview?.calls.length ?? 0} onClick={() => setActiveTab('activity')} />
    </nav>

    {activeTab === 'profiles' && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">Demo workflow</p><h3 className="mt-1 font-semibold text-slate-900">Prepare → Test → Create invitation → Send demo → Review calls</h3><p className="mt-1 text-xs leading-5 text-slate-500">Profiles are managed here. Retell remains the shared voice engine underneath them.</p></div><span className="rounded-full bg-amber-50 px-3 py-1.5 text-[10px] font-semibold text-amber-700">Invitations are the next build slice</span></div>
    </section>}

    {activeTab === 'profiles' && <section>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 p-4"><div><h3 className="text-sm font-semibold text-blue-950">Import an existing mined lead</h3><p className="mt-1 text-xs leading-5 text-blue-700">Create a test profile from archived Agency OS research without restoring or changing the source lead.</p></div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><select value={importLeadId} onChange={(event) => setImportLeadId(event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-3 text-xs text-slate-700"><option value="">Choose an archived lead…</option>{archivedLeads.map((lead) => <option key={lead.id} value={lead.id}>{lead.company} · {[lead.city, lead.state].filter(Boolean).join(', ') || lead.industry || 'Location unknown'}{overview?.profiles.some((profile) => profile.lead_id === lead.id) ? ' · already imported' : ''}</option>)}</select><button type="button" disabled={working || !importLeadId} onClick={() => { const lead = archivedLeads.find((item) => item.id === Number(importLeadId)); if (lead) void prepareLead(lead); }} className="h-10 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Prepare from mined data</button></div></div>
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Demo profiles</h3><p className="mt-1 text-xs leading-5 text-slate-500">Business configuration is separate from the reusable Retell receptionist.</p></div>{!overview?.profiles.some((profile) => profile.profile_kind === 'test') && <button type="button" onClick={() => void createTestProfile()} disabled={working} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Create test profile</button>}</div>
        <div className="mt-4 space-y-2">
          {overview?.profiles.length ? overview.profiles.map((profile) => {
            const agentReady = Boolean(profile.retell_agent_id || overview.health.defaultAgentConfigured);
            const calls = overview.calls.filter((call) => call.voice_business_profile_id === profile.id).length;
            return <div key={profile.id} className={`rounded-xl border p-3 ${selectedProfile?.id === profile.id ? 'border-blue-300 bg-blue-50/70' : 'border-slate-200'}`}><div className="flex items-start gap-3"><button type="button" onClick={() => openProfile(profile)} className="mt-0.5 rounded-lg bg-white p-2 text-blue-600 shadow-sm"><Bot className="h-4 w-4" /></button><button type="button" onClick={() => openProfile(profile)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold text-slate-900">{profile.business_name}</span><span className="mt-0.5 block text-[11px] text-slate-500">{profile.profile_kind === 'prospect' ? 'Prospect demo' : profile.profile_kind === 'customer' ? 'Customer profile' : 'Internal fallback'} · {calls} call{calls === 1 ? '' : 's'}</span></button><button type="button" onClick={() => openProfile(profile)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-600">Edit</button></div><div className="mt-3 flex flex-wrap gap-1.5"><ProfileStateBadge label={`Profile: ${profile.status}`} tone={profile.status === 'ready' || profile.status === 'live' ? 'green' : 'slate'} /><ProfileStateBadge label={agentReady ? 'Retell: shared agent ready' : 'Retell: not connected'} tone={agentReady ? 'blue' : 'amber'} /><ProfileStateBadge label="Invitation: not created" tone="slate" /></div><div className="mt-3 grid grid-cols-3 gap-2"><button type="button" onClick={() => openProfile(profile)} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-[10px] font-semibold text-slate-600">Edit & test</button><button type="button" disabled title="Access-code invitations have not been built yet" className="cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-[10px] font-semibold text-slate-400">Send demo</button><button type="button" onClick={() => openProfile(profile, 'calls')} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-[10px] font-semibold text-slate-600">View calls</button></div></div>;
          }) : <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">Create the internal profile to begin.</p>}
        </div>
      </div>
    </section>}

    {activeTab === 'leads' && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold text-slate-900">Businesses interested in a demo</h3><p className="mt-1 text-xs leading-5 text-slate-500">This is the sales queue. Interest stays visible here whether or not a demo profile has been prepared.</p></div>
        <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">{interestedLeads.length} interested</span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {interestedLeads.length ? interestedLeads.map((lead) => { const profile = overview?.profiles.find((item) => item.lead_id === lead.id); return <div key={lead.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{lead.company}</p><p className="mt-0.5 text-xs text-slate-500">{[lead.industry, lead.city, lead.state].filter(Boolean).join(' · ') || 'Business details need review'}</p></div><ProfileStateBadge label={profile ? `Demo: ${profile.status}` : 'Demo: not prepared'} tone={profile ? 'blue' : 'amber'} /></div><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => profile ? openProfile(profile) : void prepareLead(lead)} disabled={working} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{profile ? 'Open demo profile' : 'Prepare demo'}</button>{profile ? <button type="button" onClick={() => openProfile(profile, 'calls')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">View activity</button> : <button type="button" disabled className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-300">No activity yet</button>}</div></div>; }) : <p className="col-span-full rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">Interested website declines will appear here.</p>}
      </div>
    </section>}

    {activeTab === 'profiles' && selectedProfile && <section id="profile-editor" className="scroll-mt-5"><ProfileDemoPanel profile={selectedProfile} overview={overview} working={working} setWorking={setWorking} onChanged={load} showToast={showToast} /></section>}

    {activeTab === 'profiles' && selectedProfile && <AgentSimulator profile={selectedProfile} onCompleted={load} showToast={showToast} />}

    {activeTab === 'activity' && <><section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><label className="text-xs font-semibold text-slate-700">Activity for<select value={selectedProfile?.id ?? ''} onChange={(event) => setSelectedProfile(overview?.profiles.find((profile) => profile.id === Number(event.target.value)) ?? null)} className="ml-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700"><option value="">All demo profiles</option>{overview?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.business_name}</option>)}</select></label></section>

    <section id="profile-calls" className="scroll-mt-5 space-y-5"><div><p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">Calls and outcomes</p><h3 className="mt-1 text-base font-semibold text-slate-900">{selectedProfile ? selectedProfile.business_name : 'All profiles'} · captured opportunities</h3></div><VoiceLeadsPipeline leads={(overview?.voiceLeads ?? []).filter((lead) => !selectedProfile || lead.voice_business_profile_id === selectedProfile.id)} onChanged={load} showToast={showToast} /></section>

    <details className="rounded-2xl border border-slate-200 bg-white shadow-sm"><summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4"><span className="rounded-lg bg-slate-100 p-2 text-slate-600"><Settings2 className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">Operations and Retell infrastructure</span><span className="block text-xs text-slate-500">Connection, routing tests, webhooks, retention, QA history, and recovery tools</span></span><span className="text-xs font-semibold text-slate-400">Advanced</span></summary><div className="space-y-5 border-t border-slate-100 p-5"><SetupChecklist health={overview?.health} expanded /><RetellAuthenticationCard health={overview?.health} /><DesktopTestChecklist /><OperationalHistory overview={overview} onChanged={load} showToast={showToast} /><WebhookRecoveryTools overview={overview} onChanged={load} showToast={showToast} /><RetentionCard overview={overview} onChanged={load} showToast={showToast} /></div></details>

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-semibold text-slate-900">Recent calls{selectedProfile ? ` · ${selectedProfile.business_name}` : ''}</h3></div>
      {(overview?.calls ?? []).some((call) => !selectedProfile || call.voice_business_profile_id === selectedProfile.id) ? <div className="divide-y divide-slate-100">{(overview?.calls ?? []).filter((call) => !selectedProfile || call.voice_business_profile_id === selectedProfile.id).map((call) => <CallReviewRow key={call.id} call={call} onChanged={load} showToast={showToast} />)}</div> : <p className="py-10 text-center text-sm text-slate-400">No calls for this profile yet. Run a text simulation to verify the receptionist behavior.</p>}
    </section></>}
  </div></div>;
}

function WorkspaceTab({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs font-semibold transition sm:text-sm ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}><span className="truncate">{label}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{count}</span></button>;
}

function RetellAuthenticationCard({ health }: { health?: VoiceOverview['health'] }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [resources, setResources] = useState<RetellResourceInventory | null>(null);
  if (!health?.apiKeyConfigured || (health.defaultAgentConfigured && health.sharedNumberConfigured)) return null;
  const check = async () => {
    setChecking(true);
    try { const [response, inventory] = await Promise.all([api.voice.testRetellAuthentication(), api.voice.retellResources()]); setResources(inventory.resources); setResult({ ok: response.authentication.ok, message: `Retell accepted the API key. Found ${inventory.resources.agents.length} voice agent${inventory.resources.agents.length === 1 ? '' : 's'} and ${inventory.resources.phoneNumbers.length} phone number${inventory.resources.phoneNumbers.length === 1 ? '' : 's'}.` }); }
    catch (error) { setResult({ ok: false, message: (error as Error).message }); } finally { setChecking(false); }
  };
  return <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><h3 className="font-semibold text-blue-950">Retell API authentication</h3><p className="mt-1 text-xs text-blue-700">The key is configured. Validate it and inspect available Retell resources without changing the account.</p></div><button type="button" onClick={() => void check()} disabled={checking} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{checking ? 'Contacting Retell…' : 'Inspect Retell account'}</button></div>{result && <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${result.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{result.message}</p>}{resources && <div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-xl bg-white/70 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-blue-500">Voice agents</p>{resources.agents.length ? resources.agents.map((agent) => <div key={agent.id} className="mt-2"><p className="text-xs font-semibold text-slate-700">{agent.name}</p><p className="break-all text-[10px] text-slate-500">{agent.id} · v{agent.version ?? '?'} · {agent.published ? 'published' : 'draft'}</p></div>) : <p className="mt-2 text-xs text-slate-500">No voice agents found.</p>}</div><div className="rounded-xl bg-white/70 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-blue-500">Phone numbers</p>{resources.phoneNumbers.length ? resources.phoneNumbers.map((phone) => <div key={phone.number} className="mt-2"><p className="text-xs font-semibold text-slate-700">{phone.nickname || phone.pretty || phone.number}</p><p className="text-[10px] text-slate-500">{phone.pretty || phone.number} · {phone.type || 'type unknown'} · {phone.inboundAgentIds.length ? 'inbound agent assigned' : 'no inbound agent'}</p></div>) : <p className="mt-2 text-xs text-slate-500">No Retell phone numbers found.</p>}</div></div>}</section>;
}

function WebhookRecoveryTools({ overview, onChanged, showToast }: { overview: VoiceOverview | null; onChanged: () => Promise<void>; showToast: ShowToast }) {
  const [working, setWorking] = useState<number | 'fixture' | null>(null);
  if (overview?.health.mode !== 'mock' && !overview?.webhookFailures?.length) return null;
  const createFixture = async () => {
    setWorking('fixture');
    try { await api.voice.createMockWebhookFailure(); await onChanged(); showToast('Recoverable webhook fixture created', 'success'); }
    catch (error) { showToast((error as Error).message, 'error'); } finally { setWorking(null); }
  };
  const retry = async (id: number) => {
    setWorking(id);
    try { await api.voice.retryWebhookEvent(id); await onChanged(); showToast('Webhook event recovered', 'success'); }
    catch (error) { showToast((error as Error).message, 'error'); } finally { setWorking(null); }
  };
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><h3 className="font-semibold text-slate-900">Webhook recovery</h3><p className="mt-1 text-xs text-slate-500">Replay a stored failed event without asking Retell to resend the call.</p></div>{overview?.health.mode === 'mock' && <button type="button" onClick={() => void createFixture()} disabled={working !== null} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-50">{working === 'fixture' ? 'Creating…' : 'Create retry fixture'}</button>}</div>{overview?.webhookFailures?.length ? <div className="mt-4 divide-y divide-slate-100">{overview.webhookFailures.map((failure) => <div key={failure.id} className="flex items-center gap-3 py-2 first:pt-0"><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-700">{failure.event_type} · {failure.provider_call_id || 'No call ID'}</p><p className="mt-0.5 truncate text-[10px] text-rose-600">{failure.error_message || 'Unknown processing error'} · attempt {failure.processing_attempts}</p></div><button type="button" onClick={() => void retry(failure.id)} disabled={working !== null || failure.processing_attempts >= 5} className="rounded-lg border border-rose-200 px-3 py-1.5 text-[10px] font-semibold text-rose-700 disabled:opacity-40">{failure.processing_attempts >= 5 ? 'Inspect' : working === failure.id ? 'Retrying…' : 'Retry event'}</button></div>)}</div> : <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">No failed Retell events are waiting.</p>}</section>;
}

function RetentionCard({ overview, onChanged, showToast }: { overview: VoiceOverview | null; onChanged: () => Promise<void>; showToast: ShowToast }) {
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try { const result = await api.voice.runRetention(); await onChanged(); showToast(`${result.purged} expired call record${result.purged === 1 ? '' : 's'} cleaned`, 'success'); }
    catch (error) { showToast((error as Error).message, 'error'); } finally { setRunning(false); }
  };
  const retention = overview?.retention;
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><h3 className="font-semibold text-slate-900">Voice-data retention</h3><p className="mt-1 text-xs text-slate-500">The daily job removes transcripts, recording links, and raw metadata after each profile’s retention period.</p></div><button type="button" onClick={() => void run()} disabled={running} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">{running ? 'Checking…' : 'Run cleanup now'}</button></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><StatusCard label="Sensitive call records" value={String(retention?.retainedCalls ?? 0)} /><StatusCard label="Expired, awaiting cleanup" value={String(retention?.expiredPendingPurge ?? 0)} good={(retention?.expiredPendingPurge ?? 0) === 0} /><StatusCard label="Next expiration" value={retention?.nextExpirationAt ? new Date(`${retention.nextExpirationAt.replace(' ', 'T')}Z`).toLocaleDateString() : 'None scheduled'} /></div></section>;
}

function OperationalHistory({ overview, onChanged, showToast }: { overview: VoiceOverview | null; onChanged: () => Promise<void>; showToast: ShowToast }) {
  const [qaCases, setQaCases] = useState<Array<{ id: number; label: string; passed: number; reply: string; issues_json: string }> | null>(null);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const inspectRun = async (id: number) => { setWorkingId(id); try { const result = await api.voice.qaRun(id); setQaCases(result.cases); } catch (error) { showToast((error as Error).message, 'error'); } finally { setWorkingId(null); } };
  const retry = async (id: number) => { setWorkingId(id); try { await api.voice.retryNotification(id); await onChanged(); showToast('Notification retry completed', 'success'); } catch (error) { showToast((error as Error).message, 'error'); } finally { setWorkingId(null); } };
  const retryWebhook = async (id: number) => { setWorkingId(-id); try { await api.voice.retryWebhookEvent(id); await onChanged(); showToast('Webhook event recovered', 'success'); } catch (error) { showToast((error as Error).message, 'error'); } finally { setWorkingId(null); } };
  return <section className="space-y-5"><div className="grid gap-5 lg:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-semibold text-slate-900">QA run history</h3><p className="mt-1 text-xs text-slate-500">Saved by prompt version so behavior changes can be compared.</p><div className="mt-4 divide-y divide-slate-100">{overview?.qaRuns?.length ? overview.qaRuns.slice(0, 8).map((run) => <button type="button" onClick={() => void inspectRun(run.id)} key={run.id} className="flex w-full items-center gap-3 py-2 text-left first:pt-0"><div className={`h-2.5 w-2.5 rounded-full ${run.passed_count === run.total_count ? 'bg-emerald-500' : 'bg-rose-500'}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-700">{run.business_name}</p><p className="text-[10px] text-slate-400">{run.requested_engine}{run.model ? ` · ${run.model}` : ''} · {run.prompt_version}</p></div><span className="text-xs font-bold text-slate-700">{workingId === run.id ? '…' : `${run.passed_count}/${run.total_count}`}</span></button>) : <p className="py-5 text-center text-xs text-slate-400">Run the QA suite to create the first saved result.</p>}</div></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-semibold text-slate-900">Notification delivery</h3><p className="mt-1 text-xs text-slate-500">Mock mode records alerts without sending email.</p><div className="mt-4 divide-y divide-slate-100">{overview?.notifications?.length ? overview.notifications.slice(0, 8).map((notification) => <div key={notification.id} className="flex items-center gap-3 py-2 first:pt-0"><span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${notification.delivery_status === 'sent' ? 'bg-emerald-100 text-emerald-700' : notification.delivery_status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>{notification.delivery_status}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-700">{notification.business_name || 'Receptionist call'} · {notification.notification_type.replaceAll('_', ' ')}</p><p className="truncate text-[10px] text-slate-400">{notification.recipient}</p></div>{['failed','simulated'].includes(notification.delivery_status) && <button type="button" onClick={() => void retry(notification.id)} disabled={workingId === notification.id} className="text-[10px] font-semibold text-blue-600">Retry</button>}</div>) : <p className="py-5 text-center text-xs text-slate-400">New Voice Leads will create an alert record here.</p>}</div></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-semibold text-slate-900">Webhook health</h3><p className="mt-1 text-xs text-slate-500">Retell lifecycle event processing and failures.</p><dl className="mt-4 space-y-3 text-xs"><div><dt className="text-slate-400">Events processed</dt><dd className="mt-0.5 font-semibold text-slate-700">{overview?.webhookHealth?.total_events ?? 0}</dd></div><div><dt className="text-slate-400">Failed events</dt><dd className={`mt-0.5 font-semibold ${(overview?.webhookHealth?.failed_count ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{overview?.webhookHealth?.failed_count ?? 0}</dd></div><div><dt className="text-slate-400">Last successful webhook</dt><dd className="mt-0.5 font-semibold text-slate-700">{overview?.webhookHealth?.last_success_at ? new Date(`${overview.webhookHealth.last_success_at.replace(' ', 'T')}Z`).toLocaleString() : 'Waiting for Retell'}</dd></div></dl>{overview?.webhookFailures?.map((failure) => <div key={failure.id} className="mt-2 flex items-center gap-2 rounded-lg bg-rose-50 p-2 text-[10px] text-rose-700"><span className="min-w-0 flex-1 truncate">{failure.event_type}: {failure.error_message || 'Unknown processing error'}</span><button type="button" onClick={() => void retryWebhook(failure.id)} disabled={workingId === -failure.id || failure.processing_attempts >= 5} className="font-semibold text-rose-800 disabled:opacity-40">{failure.processing_attempts >= 5 ? 'Inspect' : workingId === -failure.id ? 'Retrying…' : 'Retry'}</button></div>)}</div></div>{qaCases && <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h3 className="font-semibold text-slate-900">QA case details</h3><button type="button" onClick={() => setQaCases(null)} className="text-xs font-semibold text-slate-500">Close</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{qaCases.map((testCase) => <div key={testCase.id} className={`rounded-xl border p-3 ${testCase.passed ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}><p className="text-xs font-semibold text-slate-700">{testCase.label}</p><p className="mt-1 text-[11px] leading-4 text-slate-600">{testCase.reply}</p>{testCase.issues_json !== '[]' && <p className="mt-2 text-[10px] font-semibold text-rose-700">{testCase.issues_json}</p>}</div>)}</div></div>}</section>;
}

function VoiceLeadsPipeline({ leads, onChanged, showToast }: { leads: VoiceLead[]; onChanged: () => Promise<void>; showToast: ShowToast }) {
  const open = leads.filter((lead) => !['won','lost','spam'].includes(lead.status));
  const wonRevenue = leads.reduce((sum, lead) => sum + (lead.confirmed_revenue ?? 0), 0);
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4"><div className="min-w-0 flex-1"><h3 className="font-semibold text-slate-900">Voice Leads</h3><p className="mt-0.5 text-xs text-slate-500">Customer opportunities captured for the business—separate from Agency OS sales prospects.</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{open.length} open</span><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">${wonRevenue.toLocaleString()} won</span></div>
    {leads.length ? <div className="divide-y divide-slate-100">{leads.map((lead) => <VoiceLeadRow key={lead.id} lead={lead} onChanged={onChanged} showToast={showToast} />)}</div> : <p className="py-10 text-center text-sm text-slate-400">New customer and emergency simulations will create business-owned leads here.</p>}
  </section>;
}

function VoiceLeadRow({ lead, onChanged, showToast }: { lead: VoiceLead; onChanged: () => Promise<void>; showToast: ShowToast }) {
  const [status, setStatus] = useState(lead.status);
  const [estimated, setEstimated] = useState(lead.estimated_value?.toString() ?? '');
  const [revenue, setRevenue] = useState(lead.confirmed_revenue?.toString() ?? '');
  const [notes, setNotes] = useState(lead.intake_notes ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await api.voice.updateLead(lead.id, { status, estimatedValue: estimated ? Number(estimated) : null, confirmedRevenue: revenue ? Number(revenue) : null, intakeNotes: notes }); await onChanged(); showToast('Voice lead updated', 'success'); }
    catch (error) { showToast((error as Error).message, 'error'); } finally { setSaving(false); }
  };
  return <details className="px-5 py-3"><summary className="grid cursor-pointer list-none gap-2 sm:grid-cols-[170px_150px_1fr_110px] sm:items-center"><div><p className="text-sm font-semibold text-slate-800">{lead.caller_name || 'Unnamed caller'}</p><p className="text-[11px] text-slate-400">{lead.caller_phone || 'No callback number'}</p></div><p className="text-xs font-semibold text-blue-700">{lead.business_name}</p><p className="truncate text-xs text-slate-600">{lead.service_requested || lead.intake_notes || 'Service not captured'}</p><span className={`rounded-full px-2 py-1 text-center text-[10px] font-semibold uppercase ${lead.urgency === 'emergency' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{lead.urgency === 'unknown' ? lead.status : lead.urgency}</span></summary><div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-semibold text-slate-600">Status<select value={status} onChange={(event) => setStatus(event.target.value as VoiceLead['status'])} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-normal"><option value="new">New</option><option value="contacted">Contacted</option><option value="appointment">Appointment</option><option value="booked">Booked</option><option value="won">Won</option><option value="lost">Lost</option><option value="spam">Spam</option></select></label><label className="text-xs font-semibold text-slate-600">Estimated value<input type="number" min="0" value={estimated} onChange={(event) => setEstimated(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 font-normal" /></label><label className="text-xs font-semibold text-slate-600">Confirmed revenue<input type="number" min="0" value={revenue} onChange={(event) => setRevenue(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 font-normal" /></label><div className="flex items-end"><button type="button" onClick={() => void save()} disabled={saving} className="h-9 w-full rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save lead'}</button></div><label className="text-xs font-semibold text-slate-600 sm:col-span-2 lg:col-span-4">Intake notes<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2 font-normal" /></label><div className="text-[11px] text-slate-500 sm:col-span-2 lg:col-span-4">{[lead.caller_email, lead.city || lead.postal_code, lead.preferred_timing].filter(Boolean).join(' · ') || 'No additional contact details captured'}</div></div></details>;
}

function parseCallMetadata(value?: string | null): VoiceCallMetadata {
  if (!value) return {};
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' ? parsed as VoiceCallMetadata : {}; } catch { return {}; }
}

function CallReviewRow({ call, onChanged, showToast }: { call: VoiceCall; onChanged: () => Promise<void>; showToast: ShowToast }) {
  const metadata = parseCallMetadata(call.raw_metadata_json);
  const [classification, setClassification] = useState<VoiceClassification>((call.classification as VoiceClassification) || 'unknown');
  const [outcome, setOutcome] = useState(call.final_outcome ?? 'message_taken');
  const [summary, setSummary] = useState(call.summary ?? '');
  const [reviewStatus, setReviewStatus] = useState<'unreviewed' | 'passed' | 'needs_work'>(metadata.review?.status ?? 'unreviewed');
  const [notes, setNotes] = useState(metadata.review?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const save = async (status = reviewStatus) => {
    setSaving(true);
    try { await api.voice.reviewCall(call.id, { classification, finalOutcome: outcome, summary, reviewStatus: status, reviewNotes: notes }); setReviewStatus(status); await onChanged(); showToast(status === 'passed' ? 'Scenario marked passed' : status === 'needs_work' ? 'Scenario marked needs work' : 'Call review saved', 'success'); }
    catch (error) { showToast((error as Error).message, 'error'); } finally { setSaving(false); }
  };
  return <details className="group px-5 py-3"><summary className="grid cursor-pointer list-none gap-2 sm:grid-cols-[180px_130px_1fr_110px] sm:items-center"><div><p className="text-sm font-semibold text-slate-800">{call.business_name ?? 'Generic demo'}</p><p className="text-[11px] text-slate-400">{new Date(`${call.created_at.replace(' ', 'T')}Z`).toLocaleString()}</p></div><span className="text-xs font-semibold capitalize text-blue-700">{classification.replaceAll('_', ' ')}</span><p className="text-xs leading-5 text-slate-600">{summary || 'Waiting for analysis'}</p><span className={`rounded-full px-2 py-1 text-center text-[10px] font-semibold uppercase ${reviewStatus === 'passed' ? 'bg-emerald-100 text-emerald-700' : reviewStatus === 'needs_work' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{reviewStatus.replace('_', ' ')}</span></summary>
    <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[minmax(0,1fr)_300px]"><div>{call.recording_url && <div className="mb-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Call recording</p><AuthenticatedAudioPlayer url={call.recording_url} compact lazy /></div>}<p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Transcript</p><pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5 text-slate-600">{call.transcript || 'No transcript available.'}</pre>{metadata.intake && Object.keys(metadata.intake).length > 0 && <div className="mt-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Captured intake</p><div className="mt-2 flex flex-wrap gap-2">{Object.entries(metadata.intake).map(([key, value]) => <span key={key} className="rounded-lg bg-blue-50 px-2 py-1 text-[11px] text-blue-800"><strong className="capitalize">{key.replace(/([A-Z])/g, ' $1')}:</strong> {String(value)}</span>)}</div></div>}</div>
      <div className="space-y-3"><label className="block text-xs font-semibold text-slate-600">Classification<select value={classification} onChange={(event) => setClassification(event.target.value as VoiceClassification)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-normal"><option value="new_customer">New customer</option><option value="existing_customer">Existing customer</option><option value="emergency">Emergency</option><option value="personal_vip">Personal / VIP</option><option value="vendor">Vendor</option><option value="applicant">Applicant</option><option value="cold_sales">Cold sales</option><option value="spam">Spam</option><option value="unknown">Unknown</option></select></label><label className="block text-xs font-semibold text-slate-600">Outcome<input value={outcome} onChange={(event) => setOutcome(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-normal" /></label><label className="block text-xs font-semibold text-slate-600">Summary<textarea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" /></label><label className="block text-xs font-semibold text-slate-600">QA notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What worked or needs changing?" className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs font-normal" /></label><div className="grid grid-cols-2 gap-2"><button type="button" disabled={saving} onClick={() => void save('needs_work')} className="rounded-lg border border-rose-200 bg-white px-2 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50">Needs work</button><button type="button" disabled={saving} onClick={() => void save('passed')} className="rounded-lg bg-emerald-600 px-2 py-2 text-xs font-semibold text-white disabled:opacity-50">Pass</button></div></div></div>
  </details>;
}

function AgentSimulator({ profile, onCompleted, showToast }: { profile: VoiceBusinessProfile; onCompleted: () => Promise<void>; showToast: ShowToast }) {
  const [spec, setSpec] = useState<VoiceAgentSpec | null>(null);
  const [history, setHistory] = useState<VoiceSimulatorTurn[]>([]);
  const [message, setMessage] = useState('');
  const [classification, setClassification] = useState<VoiceClassification>('unknown');
  const [confidence, setConfidence] = useState<VoiceSimulatorResult['confidence']>('low');
  const [intake, setIntake] = useState<VoiceIntake>({});
  const [outcome, setOutcome] = useState<VoiceSimulatorResult['outcome']>('continue_intake');
  const [complete, setComplete] = useState(false);
  const [engine, setEngine] = useState<'openai' | 'rules' | null>(null);
  const [qaResults, setQaResults] = useState<VoiceQaResult[] | null>(null);
  const [qaWorking, setQaWorking] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [working, setWorking] = useState(false);
  const opening = profile.greeting || `Thanks for calling ${profile.business_name}. How can I help you today?`;

  useEffect(() => { void api.voice.agentSpec().then(setSpec).catch(() => setSpec(null)); }, []);
  useEffect(() => {
    setHistory([{ role: 'receptionist', text: opening }]);
    setClassification('unknown'); setConfidence('low'); setIntake({}); setOutcome('continue_intake'); setComplete(false); setEngine(null); setMessage('');
  }, [profile.id, opening]);

  const reset = (callerOpening?: string) => {
    const next: VoiceSimulatorTurn[] = [{ role: 'receptionist', text: opening }];
    setHistory(next); setClassification('unknown'); setConfidence('low'); setIntake({}); setOutcome('continue_intake'); setComplete(false); setEngine(null); setMessage(callerOpening ?? '');
  };
  const send = async () => {
    const callerText = message.trim();
    if (!callerText || working || complete) return;
    setWorking(true);
    try {
      const { result } = await api.voice.simulatorRespond({ profileId: profile.id, history, message: callerText, classification, intake, useAi });
      setHistory((current) => [...current, { role: 'caller', text: callerText }, { role: 'receptionist', text: result.reply }]);
      setClassification(result.classification); setConfidence(result.confidence); setIntake(result.intake); setOutcome(result.outcome); setComplete(result.complete); setEngine(result.engine ?? 'rules'); setMessage('');
    } catch (error) { showToast((error as Error).message, 'error'); } finally { setWorking(false); }
  };
  const saveCall = async () => {
    if (history.length < 3 || working) return;
    setWorking(true);
    try {
      await api.voice.completeSimulation({ profileId: profile.id, history, classification, confidence, intake, outcome });
      await onCompleted(); showToast('Simulation saved to Recent demo calls', 'success'); reset();
    } catch (error) { showToast((error as Error).message, 'error'); } finally { setWorking(false); }
  };
  const runQa = async () => {
    setQaWorking(true);
    try { const result = await api.voice.runQaSuite(profile.id, useAi); setQaResults(result.results); showToast(`QA suite: ${result.passed}/${result.total} passed`, result.passed === result.total ? 'success' : 'error'); }
    catch (error) { showToast((error as Error).message, 'error'); } finally { setQaWorking(false); }
  };

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4"><div className="rounded-lg bg-violet-100 p-2 text-violet-700"><MessageSquare className="h-4 w-4" /></div><div className="min-w-0 flex-1"><h3 className="font-semibold text-slate-900">Receptionist behavior simulator</h3><p className="text-xs text-slate-500">Call {profile.business_name} in text before connecting Retell.</p></div><button type="button" onClick={() => void runQa()} disabled={qaWorking} className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 text-xs font-semibold text-violet-700 disabled:opacity-50">{qaWorking ? 'Running checks…' : 'Run 6-case QA suite'}</button><button type="button" onClick={() => reset()} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600"><RotateCcw className="h-3.5 w-3.5" /> Reset</button></div>
    <label className="flex items-start gap-2 border-b border-slate-100 bg-violet-50/50 px-5 py-3 text-xs text-violet-900"><input type="checkbox" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} className="mt-0.5" /><span><strong>Use OpenAI preview</strong> — sends this business profile and the test conversation to OpenAI. Leave off for private, rules-only testing. Do not type real customer personal information into a test.</span></label>
    {qaResults && <div className="grid gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3 sm:grid-cols-2 lg:grid-cols-3">{qaResults.map((result) => <div key={result.id} title={result.reply} className={`rounded-lg border bg-white px-3 py-2 ${result.passed ? 'border-emerald-200' : 'border-rose-200'}`}><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-700">{result.label}</span><span className={`text-[10px] font-bold uppercase ${result.passed ? 'text-emerald-600' : 'text-rose-600'}`}>{result.passed ? 'Pass' : 'Fail'}</span></div><p className="mt-1 text-[10px] text-slate-400">{result.engine} · expected {result.expected.replaceAll('_', ' ')} · got {result.actual.replaceAll('_', ' ')}</p><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{result.reply}</p>{result.issues.length > 0 && <p className="mt-1 text-[10px] font-semibold text-rose-600">{result.issues.join(' · ')}</p>}</div>)}</div>}
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="p-5"><div className="mb-3 flex flex-wrap gap-2">{spec?.scenarios.map((scenario) => <button key={scenario.id} type="button" onClick={() => reset(scenario.opening)} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-violet-200 hover:bg-violet-50">{scenario.label}</button>)}</div>
        <div className="h-72 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-4">{history.map((turn, index) => <div key={`${index}-${turn.role}`} className={`flex ${turn.role === 'caller' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-5 ${turn.role === 'caller' ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}><p className="mb-0.5 text-[9px] font-bold uppercase opacity-60">{turn.role}</p>{turn.text}</div></div>)}</div>
        <div className="mt-3 flex gap-2"><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void send(); }} disabled={working || complete} placeholder={complete ? 'Call complete—save or reset' : 'Type what the caller says…'} className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50" /><button type="button" onClick={() => void send()} disabled={!message.trim() || working || complete} className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-50"><Send className="h-3.5 w-3.5" /> Send</button></div>
      </div>
      <aside className="border-t border-slate-100 bg-slate-50/60 p-5 lg:border-l lg:border-t-0"><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Live evaluation</p>{engine && <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${engine === 'openai' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'}`}>{engine === 'openai' ? 'AI preview' : 'Rules fallback'}</span>}</div><div className="mt-3 flex items-center gap-2"><span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold capitalize text-blue-700">{classification.replaceAll('_', ' ')}</span><span className="text-[11px] text-slate-400">{confidence} confidence</span></div><dl className="mt-4 space-y-2 text-xs">{Object.entries(intake).length ? Object.entries(intake).map(([key, value]) => <div key={key}><dt className="font-semibold capitalize text-slate-500">{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="mt-0.5 text-slate-800">{String(value)}</dd></div>) : <p className="text-slate-400">Intake details appear as the conversation progresses.</p>}</dl><div className="mt-5 rounded-lg border border-slate-200 bg-white p-3 text-xs"><p className="font-semibold text-slate-700">Outcome: <span className="capitalize text-blue-700">{outcome.replaceAll('_', ' ')}</span></p><p className="mt-1 text-slate-500">Transfers are intentionally disabled.</p></div><button type="button" onClick={() => void saveCall()} disabled={history.length < 3 || working} className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50">Save simulation as a call</button></aside>
    </div>
  </section>;
}

function parseProfileConfiguration(value: string): VoiceProfileConfiguration {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as VoiceProfileConfiguration : {}; } catch { return {}; }
}

function ProfileDemoPanel({ profile, overview, working, setWorking, onChanged, showToast }: { profile: VoiceBusinessProfile; overview: VoiceOverview | null; working: boolean; setWorking: (value: boolean) => void; onChanged: () => Promise<void>; showToast: ShowToast }) {
  const [businessName, setBusinessName] = useState(profile.business_name);
  const [greeting, setGreeting] = useState(profile.greeting);
  const [services, setServices] = useState(profile.services_text);
  const [serviceArea, setServiceArea] = useState(profile.service_area_text);
  const [hours, setHours] = useState(profile.hours_text);
  const [configuration, setConfiguration] = useState<VoiceProfileConfiguration>(() => parseProfileConfiguration(profile.configuration_json));
  const [callerPhone, setCallerPhone] = useState('');
  const [retellPackage, setRetellPackage] = useState<RetellSetupPackage | null>(null);
  useEffect(() => { setBusinessName(profile.business_name); setGreeting(profile.greeting); setServices(profile.services_text); setServiceArea(profile.service_area_text); setHours(profile.hours_text); setConfiguration(parseProfileConfiguration(profile.configuration_json)); setRetellPackage(null); }, [profile]);

  const save = async () => {
    await api.voice.updateProfile(profile.id, { business_name: businessName, greeting, services_text: services, service_area_text: serviceArea, hours_text: hours, configuration });
    await onChanged();
  };
  const saveOnly = async () => {
    setWorking(true);
    try { await save(); showToast('Voice profile saved', 'success'); } catch (error) { showToast((error as Error).message, 'error'); } finally { setWorking(false); }
  };
  const activate = async () => {
    if (!callerPhone.trim()) { showToast('Enter the phone number you will call from', 'error'); return; }
    setWorking(true);
    try { await save(); await api.voice.activateDemo(profile.id, callerPhone, 30); await onChanged(); showToast(`${businessName} is active on the shared demo for 30 minutes`, 'success'); } catch (error) { showToast((error as Error).message, 'error'); } finally { setWorking(false); }
  };
  const mockCall = async (classification: 'new_customer' | 'cold_sales') => {
    setWorking(true);
    try { await api.voice.createMockCall(profile.id, classification); await onChanged(); showToast('Mock call received and stored', 'success'); } catch (error) { showToast((error as Error).message, 'error'); } finally { setWorking(false); }
  };
  const mockTransferFailure = async () => {
    setWorking(true);
    try { await api.voice.createMockTransferFailure(profile.id); await onChanged(); showToast('Mock failed-transfer alert recorded', 'success'); } catch (error) { showToast((error as Error).message, 'error'); } finally { setWorking(false); }
  };
  const loadRetellPackage = async () => {
    setWorking(true);
    try {
      await save();
      const { setupPackage } = await api.voice.retellSetupPackage(profile.id);
      setRetellPackage(setupPackage);
      showToast('Retell setup preflight refreshed', 'success');
    } catch (error) { showToast((error as Error).message, 'error'); } finally { setWorking(false); }
  };
  const downloadRetellPackage = () => {
    if (!retellPackage) return;
    try {
      const setupPackage = retellPackage;
      const blob = new Blob([JSON.stringify(setupPackage, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `retell-setup-${profile.business_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || profile.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast('Retell setup package downloaded', 'success');
    } catch (error) { showToast((error as Error).message, 'error'); }
  };

  const agentId = profile.retell_agent_id || overview?.health.defaultAgentId || null;
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-5 py-4"><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">Business profile editor</p><h3 className="mt-1 text-base font-semibold text-slate-900">{profile.business_name}</h3><div className="mt-2 flex flex-wrap gap-1.5"><ProfileStateBadge label={`Profile: ${profile.status}`} tone="slate" /><ProfileStateBadge label={agentId ? 'Retell: shared agent ready' : 'Retell: not connected'} tone={agentId ? 'blue' : 'amber'} /><ProfileStateBadge label="Invitation: unavailable" tone="slate" /></div></div>{agentId && <a href={`https://dashboard.retellai.com/agents/${agentId}?test_panel=open&test_mode=llm`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Open in Retell <ExternalLink className="h-3.5 w-3.5" /></a>}</div>
    <div className="grid gap-5 p-5 lg:grid-cols-2">
      <section className="space-y-3"><div><h4 className="text-sm font-semibold text-slate-800">Business identity</h4><p className="mt-0.5 text-[11px] text-slate-500">What callers hear and what the receptionist is allowed to represent.</p></div><ProfileField label="Business name" value={businessName} onChange={setBusinessName} /><ProfileField label="Greeting" value={greeting} onChange={setGreeting} multiline /><ProfileField label="Services offered" value={services} onChange={setServices} multiline /><ProfileField label="Service area" value={serviceArea} onChange={setServiceArea} /><ProfileField label="Business hours" value={hours} onChange={setHours} /></section>
      <section className="space-y-3"><div><h4 className="text-sm font-semibold text-slate-800">Call handling</h4><p className="mt-0.5 text-[11px] text-slate-500">The information to collect and the boundaries the receptionist must follow.</p></div><ProfileField label="Services not offered" value={configuration.servicesNotOffered ?? ''} onChange={(value) => setConfiguration((current) => ({ ...current, servicesNotOffered: value }))} multiline /><ProfileField label="What counts as an emergency" value={configuration.emergencyDefinition ?? ''} onChange={(value) => setConfiguration((current) => ({ ...current, emergencyDefinition: value }))} multiline /><ProfileField label="After-hours instructions" value={configuration.afterHoursInstructions ?? ''} onChange={(value) => setConfiguration((current) => ({ ...current, afterHoursInstructions: value }))} multiline /></section>
    </div>
    <details className="border-t border-slate-100 px-5 py-4"><summary className="cursor-pointer text-xs font-semibold text-slate-700">Intake fields and response guardrails</summary><div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="space-y-3"><ProfileField label="Approved answers" value={configuration.approvedAnswers ?? ''} onChange={(value) => setConfiguration((current) => ({ ...current, approvedAnswers: value }))} multiline /><ProfileField label="Promises the receptionist must not make" value={configuration.prohibitedPromises ?? ''} onChange={(value) => setConfiguration((current) => ({ ...current, prohibitedPromises: value }))} multiline /></div><div><fieldset><legend className="text-xs font-semibold text-slate-700">Required intake</legend><div className="mt-2 grid grid-cols-2 gap-2">{['callerName','callbackNumber','callerEmail','requestedService','location','urgency','preferredTiming'].map((field) => <label key={field} className="flex items-center gap-2 text-[11px] text-slate-600"><input type="checkbox" checked={(configuration.requiredIntakeFields ?? ['callerName','callbackNumber','requestedService','location','urgency','preferredTiming']).includes(field)} onChange={(event) => setConfiguration((current) => { const fields = current.requiredIntakeFields ?? ['callerName','callbackNumber','requestedService','location','urgency','preferredTiming']; return { ...current, requiredIntakeFields: event.target.checked ? [...new Set([...fields, field])] : fields.filter((item) => item !== field) }; })} />{field.replace(/([A-Z])/g, ' $1')}</label>)}</div></fieldset><label className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600"><input type="checkbox" checked={configuration.solicitationMessages === true} onChange={(event) => setConfiguration((current) => ({ ...current, solicitationMessages: event.target.checked }))} /><span>Take a brief message from sales solicitations. Leave this off to screen and end those calls.</span></label></div></div></details>
    <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-4"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void saveOnly()} disabled={working} className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Save business profile</button><button type="button" onClick={() => void loadRetellPackage()} disabled={working} className="rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-xs font-semibold text-blue-700 disabled:opacity-50">Review Retell mapping</button><button type="button" disabled title="Requires expiring access-code invitations" className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-400"><LockKeyhole className="h-3.5 w-3.5" /> Send demo</button></div><p className="mt-2 text-[11px] text-slate-500">Sending remains unavailable until expiring access-code invitations prevent profiles from crossing between prospects.</p></div>
    {retellPackage && <div className={`mx-5 mb-5 rounded-xl border p-3 ${retellPackage.preflight.ready ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}><div className="flex items-start gap-2"><CheckCircle2 className={`mt-0.5 h-4 w-4 ${retellPackage.preflight.ready ? 'text-emerald-600' : 'text-rose-600'}`} /><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-800">{retellPackage.preflight.ready ? 'Profile maps cleanly to Retell' : 'Profile has mapping blockers'}</p><p className="mt-1 text-[11px] text-slate-600">{retellPackage.retellAgent.dynamicVariables.length} variables · {retellPackage.postCallAnalysis.length} analysis fields · {retellPackage.promptVersion}</p></div><button type="button" onClick={downloadRetellPackage} className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700"><Download className="h-3.5 w-3.5" />JSON</button></div>{retellPackage.preflight.blockers.length > 0 && <p className="mt-2 text-[11px] text-rose-700">Fix: {retellPackage.preflight.blockers.join(', ')}</p>}{retellPackage.preflight.warnings.length > 0 && <p className="mt-2 text-[11px] text-amber-700">Review: {retellPackage.preflight.warnings.join(', ')}</p>}</div>}
    <details className="border-t border-slate-100 px-5 py-4"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Advanced local routing and fixtures</summary><div className="mt-4 grid gap-3 lg:grid-cols-2"><div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">Temporary caller-ID activation</p><p className="mt-1 text-[11px] leading-4 text-amber-700">For controlled testing only. Do not use this to email asynchronous demos.</p><input aria-label="Test caller ID" value={callerPhone} onChange={(event) => setCallerPhone(event.target.value)} placeholder="(920) 555-0123" className="mt-2 h-10 w-full rounded-lg border border-amber-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-amber-100" /><button type="button" onClick={() => void activate()} disabled={working} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50"><Play className="h-3.5 w-3.5" /> Activate for 30 minutes</button>{overview?.activeDemo?.voice_business_profile_id === profile.id && <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><Clock3 className="h-3.5 w-3.5" /> Active until {new Date(`${overview.activeDemo.expires_at.replace(' ', 'T')}Z`).toLocaleTimeString()}</p>}</div>{overview?.health.mode === 'mock' && <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-semibold text-slate-800">Local event fixtures</p><p className="mt-1 text-[11px] text-slate-500">Create synthetic records without making a Retell call.</p><div className="mt-3 grid grid-cols-3 gap-2"><button type="button" onClick={() => void mockCall('new_customer')} disabled={working} className="rounded-lg bg-emerald-50 px-2 py-2 text-[11px] font-semibold text-emerald-700">Customer</button><button type="button" onClick={() => void mockCall('cold_sales')} disabled={working} className="rounded-lg bg-amber-50 px-2 py-2 text-[11px] font-semibold text-amber-700">Sales</button><button type="button" onClick={() => void mockTransferFailure()} disabled={working} className="rounded-lg bg-rose-50 px-2 py-2 text-[11px] font-semibold text-rose-700">Failure</button></div></div>}</div></details>
  </div>;
}

function ProfileStateBadge({ label, tone }: { label: string; tone: 'green' | 'blue' | 'amber' | 'slate' }) {
  const colors = { green: 'bg-emerald-50 text-emerald-700', blue: 'bg-blue-50 text-blue-700', amber: 'bg-amber-50 text-amber-700', slate: 'bg-slate-100 text-slate-600' };
  return <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${colors[tone]}`}>{label}</span>;
}

function ProfileField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) { const classes = 'mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100'; return <label className="block text-xs font-semibold text-slate-700">{label}{multiline ? <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} className={classes} /> : <input value={value} onChange={(event) => onChange(event.target.value)} className={`h-10 ${classes}`} />}</label>; }
function StatusCard({ label, value, good = false }: { label: string; value: string; good?: boolean }) { return <div className="rounded-xl bg-white/80 px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-1 text-sm font-bold ${good ? 'text-emerald-700' : 'text-slate-800'}`}>{value}</p></div>; }
function DesktopTestChecklist() {
  const groups = [
    ['Call pivot', 'Decline the website, pivot to receptionist, capture an email, and confirm the lead moves off Email Outreach without being archived.'],
    ['Business profile', 'Prepare a profile, edit its company facts and call rules, save, then verify the identity appears in the simulator.'],
    ['Behavior', 'Run customer, emergency, sales, and uncertain scenarios; then run the six-case QA suite and inspect its saved details.'],
    ['Records', 'Save a call, review it, edit the linked Voice Lead status/value/notes, and retry its simulated notification.'],
    ['Retell mapping', 'Review the dynamic-variable mapping, inspect the shared agent, and download the secret-free setup package.'],
    ['Advanced routing', 'Use 30-minute caller-ID activation only for controlled testing; emailed demos remain blocked until access-code invitations exist.'],
  ];
  return <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="cursor-pointer font-semibold text-slate-900">Desktop test checklist <span className="ml-2 text-xs font-normal text-slate-400">6 groups</span></summary><p className="mt-2 text-xs text-slate-500">Use synthetic contact details in local and AI previews. The complete expected-results checklist is saved in the project spec.</p><div className="mt-4 grid gap-2 md:grid-cols-2">{groups.map(([title, description], index) => <div key={title} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-700">{index + 1}. {title}</p><p className="mt-1 text-[11px] leading-4 text-slate-500">{description}</p></div>)}</div></details>;
}
function SetupChecklist({ health, expanded = false }: { health?: VoiceOverview['health']; expanded?: boolean }) {
  const [checking, setChecking] = useState(false);
  const [connectionResult, setConnectionResult] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<VoiceReadinessResult | null>(null);
  const items = [['Retell API key', health?.apiKeyConfigured], ['Receptionist agent ID', health?.defaultAgentConfigured], ['Shared demo number', health?.sharedNumberConfigured], ['Signed webhook verification', true], ['Transfers disabled', true], ['30-day retention', true], ['Alerts: info@shauncarldesigns.com', true]] as const;
  const testConnection = async () => {
    setChecking(true); setConnectionResult(null);
    try { const { connection } = await api.voice.testConnection(); setConnectionResult(connection.agent.ok && connection.phone.ok ? `Connected · agent v${connection.agent.version ?? '?'} · ${connection.phone.type ?? 'phone'}` : 'Retell responded, but the configured agent or number did not match.'); }
    catch (error) { setConnectionResult((error as Error).message); } finally { setChecking(false); }
  };
  const testFallback = async () => { setChecking(true); try { const result = await api.voice.testFallback(); setConnectionResult(`Fallback verified: ${result.businessName}`); } catch (error) { setConnectionResult((error as Error).message); } finally { setChecking(false); } };
  const resetDemos = async () => { setChecking(true); try { const result = await api.voice.resetDemoSessions(); setConnectionResult(`${result.canceled} active demo session${result.canceled === 1 ? '' : 's'} reset.`); } catch (error) { setConnectionResult((error as Error).message); } finally { setChecking(false); } };
  const testReadiness = async () => { setChecking(true); try { setReadiness(await api.voice.testReadiness()); } catch (error) { setConnectionResult((error as Error).message); } finally { setChecking(false); } };
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center gap-2"><ShieldCheck className="h-4 w-4 text-blue-600" /><div className="min-w-0 flex-1"><h3 className="font-semibold text-slate-900">Retell integration readiness</h3>{expanded && <p className="mt-0.5 text-xs text-slate-500">The draft receptionist and API connection are ready. A shared number is only required for real phone calls.</p>}</div>{expanded && <><button type="button" onClick={() => void testReadiness()} disabled={checking} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:opacity-40">System preflight</button><button type="button" onClick={() => void testFallback()} disabled={checking} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-40">Test fallback</button><button type="button" onClick={() => void resetDemos()} disabled={checking} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-40">Reset demos</button><button type="button" onClick={() => void testConnection()} disabled={checking || !health?.apiKeyConfigured || !health.defaultAgentConfigured || !health.sharedNumberConfigured} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-40">{checking ? 'Checking…' : 'Test Retell connection'}</button></>}</div><div className={`mt-4 grid gap-2 ${expanded ? 'sm:grid-cols-2 lg:grid-cols-4' : ''}`}>{items.map(([label, ready]) => <div key={label} className="flex items-center gap-2 text-xs"><CheckCircle2 className={`h-4 w-4 ${ready ? 'text-emerald-500' : 'text-slate-300'}`} /><span className={ready ? 'text-slate-700' : 'text-slate-400'}>{label}</span></div>)}</div>{expanded && health && <div className="mt-4 grid gap-2 lg:grid-cols-2"><label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Inbound-call webhook<input readOnly value={health.inboundWebhookUrl} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-normal normal-case text-slate-600" /></label><label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Call-events webhook<input readOnly value={health.eventsWebhookUrl} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-normal normal-case text-slate-600" /></label></div>}{readiness && <div className={`mt-3 rounded-xl border p-3 ${readiness.ready ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}><p className="text-xs font-semibold text-slate-800">System preflight: {readiness.ready ? 'passed' : 'needs attention'}</p><div className="mt-2 grid gap-1 sm:grid-cols-2">{readiness.checks.map((check) => <div key={check.key} className="flex items-center gap-2 text-[10px]"><CheckCircle2 className={`h-3.5 w-3.5 ${check.status === 'pass' ? 'text-emerald-600' : 'text-rose-600'}`} /><span className="text-slate-600">{check.label} · {check.detail}</span></div>)}</div></div>}{connectionResult && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{connectionResult}</p>}<p className="mt-4 text-xs leading-5 text-slate-500"><Mail className="mr-1 inline h-3.5 w-3.5" />The Retell API key remains server-side. Publishing, phone-number purchase, transfers, and live mode stay intentionally disabled.{health?.previewModel ? ` AI preview: ${health.previewModel}.` : ''}</p></div>;
}
