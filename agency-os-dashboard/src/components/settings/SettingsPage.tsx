import { useEffect, useState } from 'react';
import {
  Building2, PhoneCall, SlidersHorizontal, PlugZap, Database, CheckCircle2,
  AlertCircle, RefreshCw, Download, Save, ShieldCheck,
  SearchCheck, ScrollText, ChevronDown, TrendingUp,
} from 'lucide-react';
import { api } from '../../lib/api';
import type { AgencySettings, ApplicationEvent, SettingsHealth, ShowToast } from '../../lib/types';

type Section = 'general' | 'outreach' | 'discovery' | 'research' | 'defaults' | 'integrations' | 'system' | 'activity';

const sections: Array<{ id: Section; label: string; icon: typeof Building2 }> = [
  { id: 'general', label: 'General', icon: Building2 },
  { id: 'outreach', label: 'Calling & outreach', icon: PhoneCall },
  { id: 'discovery', label: 'Lead discovery', icon: SearchCheck },
  { id: 'research', label: 'Market research', icon: TrendingUp },
  { id: 'defaults', label: 'Agency defaults', icon: SlidersHorizontal },
  { id: 'integrations', label: 'Integrations', icon: PlugZap },
  { id: 'system', label: 'System & data', icon: Database },
  { id: 'activity', label: 'Activity & errors', icon: ScrollText },
];

const timezones = ['America/Chicago', 'America/New_York', 'America/Denver', 'America/Los_Angeles'];

export function SettingsPage({ showToast, onProfileChanged }: { showToast: ShowToast; onProfileChanged: (general: AgencySettings['general']) => void }) {
  const [active, setActive] = useState<Section>('general');
  const [settings, setSettings] = useState<AgencySettings | null>(null);
  const [health, setHealth] = useState<SettingsHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activity, setActivity] = useState<ApplicationEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (active !== 'activity') return;
    void loadActivity();
    const timer = window.setInterval(() => void loadActivity(true), 10_000);
    return () => window.clearInterval(timer);
  }, [active]);

  async function loadActivity(silent = false) {
    if (!silent) setActivityLoading(true);
    try {
      const result = await api.settings.activity();
      setActivity(result.events);
    } catch {
      if (!silent) showToast('Could not load application activity', 'error');
    } finally {
      if (!silent) setActivityLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([api.settings.get(), api.settings.health()]);
      setSettings(s.settings);
      setHealth(h);
      onProfileChanged(s.settings.general);
    } catch { showToast('Could not load settings', 'error'); }
    finally { setLoading(false); }
  }

  function patch<K extends 'general' | 'outreach' | 'discovery' | 'research' | 'defaults'>(group: K, values: Partial<AgencySettings[K]>) {
    setSettings((current) => current ? { ...current, [group]: { ...current[group], ...values } } : current);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const result = await api.settings.update({ general: settings.general, outreach: settings.outreach, discovery: settings.discovery, research: settings.research, defaults: settings.defaults });
      setSettings(result.settings);
      onProfileChanged(result.settings.general);
      showToast('Settings saved', 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Could not save settings', 'error'); }
    finally { setSaving(false); }
  }

  async function syncClarity() {
    setSyncing(true);
    try {
      const out = await api.settings.claritySync();
      if (out.error) showToast(out.error, 'error');
      else showToast(`Clarity sync complete — ${out.updated} leads updated`, 'success');
      setHealth(await api.settings.health());
    } catch { showToast('Clarity sync failed', 'error'); }
    finally { setSyncing(false); }
  }

  async function exportLeads() {
    try {
      const blob = await api.settings.exportLeads();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `agency-os-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast('Lead export downloaded', 'success');
    } catch { showToast('Could not export leads', 'error'); }
  }

  if (loading || !settings) return <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-400">Loading settings…</div>;

  return (
    <div className="page-container">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Workspace settings</h2>
          <p className="mt-1 text-sm text-slate-500">Manage Agency OS behavior, defaults, and connection health.</p>
        </div>
        {active !== 'integrations' && active !== 'system' && active !== 'activity' && (
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="h-fit rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {sections.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActive(id)} className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium ${active === id ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}>
              <Icon className={`h-4 w-4 ${active === id ? 'text-blue-600' : 'text-slate-400'}`} />{label}
            </button>
          ))}
        </nav>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          {active === 'general' && <General settings={settings} patch={patch} />}
          {active === 'outreach' && <Outreach settings={settings} patch={patch} />}
          {active === 'discovery' && <Discovery settings={settings} patch={patch} />}
          {active === 'research' && <Research settings={settings} patch={patch} />}
          {active === 'defaults' && <Defaults settings={settings} patch={patch} />}
          {active === 'integrations' && <Integrations health={health} syncing={syncing} onRefresh={load} onSync={syncClarity} />}
          {active === 'system' && <System health={health} onExport={exportLeads} onRefresh={load} />}
          {active === 'activity' && <ActivityLog events={activity} loading={activityLoading} onRefresh={() => void loadActivity()} />}
        </section>
      </div>
    </div>
  );
}

type Patch = <K extends 'general' | 'outreach' | 'discovery' | 'research' | 'defaults'>(group: K, values: Partial<AgencySettings[K]>) => void;

function General({ settings: s, patch }: { settings: AgencySettings; patch: Patch }) {
  return <div>
    <Heading title="General" sub="The identity and regional preferences used throughout your workspace." />
    <Grid>
      <Field label="Agency name"><Input value={s.general.agencyName} onChange={v => patch('general', { agencyName: v })} /></Field>
      <Field label="Default service area"><Input value={s.general.defaultServiceArea} placeholder="e.g. Greater Chicago" onChange={v => patch('general', { defaultServiceArea: v })} /></Field>
      <Field label="Operator name"><Input value={s.general.operatorName} onChange={v => patch('general', { operatorName: v })} /></Field>
      <Field label="Operator email"><Input type="email" value={s.general.operatorEmail} onChange={v => patch('general', { operatorEmail: v })} /></Field>
      <Field label="Profile initials"><Input value={s.general.initials} maxLength={3} onChange={v => patch('general', { initials: v.toUpperCase() })} /></Field>
      <Field label="Time zone"><Select value={s.general.timezone} options={timezones} onChange={v => patch('general', { timezone: v })} /></Field>
      <Field label="Currency"><Select value={s.general.currency} options={['USD', 'CAD', 'GBP', 'EUR']} onChange={v => patch('general', { currency: v })} /></Field>
      <Field label="Date format"><Select value={s.general.dateFormat} options={['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']} onChange={v => patch('general', { dateFormat: v })} /></Field>
      <Field label="Appearance"><Select value={s.general.appearance} options={['system', 'light']} onChange={v => patch('general', { appearance: v as 'system' | 'light' })} /></Field>
    </Grid>
  </div>;
}

function Outreach({ settings: s, patch }: { settings: AgencySettings; patch: Patch }) {
  return <div>
    <Heading title="Calling & outreach" sub="Defaults applied when Agency OS composes new calling weeks and prioritizes engagement." />
    <Grid>
      <Field label="Leads per session"><NumberInput value={s.outreach.sessionSize} min={1} max={100} onChange={v => patch('outreach', { sessionSize: v })} /></Field>
      <Field label="Minimum opportunity score"><NumberInput value={s.outreach.scoreFloor} min={0} max={100} onChange={v => patch('outreach', { scoreFloor: v })} /></Field>
      <Field label="Recall cooldown (days)"><NumberInput value={s.outreach.recallCooldownDays} min={0} max={90} onChange={v => patch('outreach', { recallCooldownDays: v })} /></Field>
    </Grid>
    <Divider />
    <h4 className="mb-3 text-sm font-semibold text-slate-800">Calling schedule</h4>
    <ChoiceGroup label="Days" options={['monday', 'tuesday', 'wednesday', 'thursday', 'friday']} value={s.outreach.callingDays} onChange={v => patch('outreach', { callingDays: v })} />
    <div className="mt-4"><ChoiceGroup label="Blocks" options={['morning', 'evening']} value={s.outreach.callingBlocks} onChange={v => patch('outreach', { callingBlocks: v })} /></div>
    <Divider />
    <h4 className="mb-3 text-sm font-semibold text-slate-800">Engagement thresholds</h4>
    <Grid cols={3}>
      <Field label="Hot"><NumberInput value={s.outreach.hotThreshold} min={0} max={100} onChange={v => patch('outreach', { hotThreshold: v })} /></Field>
      <Field label="Ready to discuss"><NumberInput value={s.outreach.walkthroughThreshold} min={0} max={100} onChange={v => patch('outreach', { walkthroughThreshold: v })} /></Field>
      <Field label="Follow up"><NumberInput value={s.outreach.followUpThreshold} min={0} max={100} onChange={v => patch('outreach', { followUpThreshold: v })} /></Field>
    </Grid>
    <Divider />
    <TagEditor label="Industry rotation" value={s.outreach.industryRotation} onChange={v => patch('outreach', { industryRotation: v })} />
    <div className="mt-5"><TagEditor label="Default geographic filters" value={s.outreach.geographicFilters} placeholder="Add a city or state" onChange={v => patch('outreach', { geographicFilters: v })} /></div>
  </div>;
}

const homeServiceIndustries = [
  'Plumbing', 'HVAC', 'Electrical', 'Roofing', 'General Contracting',
  'Landscaping', 'Painting', 'Flooring', 'Concrete and Masonry', 'Siding',
  'Gutters', 'Garage Doors', 'Fencing', 'Remodeling',
  'Kitchen and Bathroom Remodeling', 'Water Damage Restoration',
  'Pest Control', 'Tree Services', 'Septic Services', 'Drain and Sewer Services',
];

function Discovery({ settings: s, patch }: { settings: AgencySettings; patch: Patch }) {
  const d = s.discovery;
  return <div>
    <Heading title="Lead discovery" sub="Control the automated no-website home-services prospect inbox. Changes apply without a deployment." />
    <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div><h4 className="text-sm font-semibold text-slate-800">Automated discovery</h4><p className="mt-1 text-xs leading-5 text-slate-500">Runs only on the selected days and pauses automatically when the pending inbox is full. Click Save changes after switching this on.</p></div>
      <button type="button" role="switch" aria-checked={d.enabled} onClick={() => patch('discovery', { enabled: !d.enabled })} className={`relative h-6 w-11 shrink-0 rounded-full transition ${d.enabled ? 'bg-blue-600' : 'bg-slate-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${d.enabled ? 'left-6' : 'left-1'}`} /></button>
    </div>
    <Divider />
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Current targeting</p><p className="mt-1 text-sm font-semibold text-blue-950">Home services · no website · manual approval required</p><p className="mt-1 text-xs leading-5 text-blue-700">Website targeting is intentionally locked to no-website businesses for this first version. Candidates are rechecked before approval. Google Places must show as connected under Integrations for searches to run.</p></div>
    <Divider />
    <h4 className="mb-3 text-sm font-semibold text-slate-800">Schedule and capacity</h4>
    <ChoiceGroup label="Run days" options={['monday', 'tuesday', 'wednesday', 'thursday', 'friday']} value={d.runDays} onChange={v => patch('discovery', { runDays: v })} />
    <Grid>
      <Field label="Local run hour"><Select value={String(d.localRunHour)} options={Array.from({ length: 12 }, (_, i) => String(i + 6))} onChange={v => patch('discovery', { localRunHour: Number(v) })} /></Field>
      <Field label="Candidates per run"><NumberInput value={d.maxCandidatesPerRun} min={1} max={60} onChange={v => patch('discovery', { maxCandidatesPerRun: v })} /></Field>
      <Field label="Pending inbox maximum"><NumberInput value={d.inboxLimit} min={10} max={500} onChange={v => patch('discovery', { inboxLimit: v })} /></Field>
      <Field label="Minimum opportunity score"><NumberInput value={d.scoreFloor} min={0} max={100} onChange={v => patch('discovery', { scoreFloor: v })} /></Field>
      <Field label="Rejected suppression (days)"><NumberInput value={d.suppressionDays} min={1} max={365} onChange={v => patch('discovery', { suppressionDays: v })} /></Field>
      <Field label="Unreviewed expiration (days)"><NumberInput value={d.expirationDays} min={1} max={180} onChange={v => patch('discovery', { expirationDays: v })} /></Field>
    </Grid>
    <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3"><input type="checkbox" checked={d.phoneRequired} onChange={e => patch('discovery', { phoneRequired: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-blue-600" /><span><span className="block text-sm font-medium text-slate-700">Require a phone number</span><span className="block text-xs text-slate-500">Recommended so every approved lead is immediately actionable.</span></span></label>
    <Divider />
    <TagEditor label="Search locations" value={d.locations} placeholder="Add city, state" onChange={v => patch('discovery', { locations: v })} />
    <div className="mt-6"><ChoiceGroup label="Allowed home-service industries" options={homeServiceIndustries} value={d.industries} onChange={v => patch('discovery', { industries: v })} /></div>
  </div>;
}

function Research({ settings: s, patch }: { settings: AgencySettings; patch: Patch }) {
  const r = s.research;
  return <div>
    <Heading title="Market research" sub="Keyword volume and map pack capture per industry × location market. Runs are manual plus a monthly refresh on the 1st." />
    <Grid cols={3}>
      <Field label="Map pack keywords per market"><NumberInput value={r.mapPackKeywordCount} min={1} max={10} onChange={v => patch('research', { mapPackKeywordCount: v })} /></Field>
      <Field label="Results per map pack"><NumberInput value={r.mapPackResultLimit} min={3} max={20} onChange={v => patch('research', { mapPackResultLimit: v })} /></Field>
      <Field label="Batch cap (markets per run)"><NumberInput value={r.batchCap} min={1} max={15} onChange={v => patch('research', { batchCap: v })} /></Field>
    </Grid>
    <p className="mt-2 text-xs leading-5 text-slate-400">The batch cap keeps a full run inside the Worker's request budget — 15 markets is the safe ceiling. Map pack scrapes only run on the top near-me terms; scraping every keyword is wasted spend.</p>
    <Divider />
    <Field label="Keyword volume provider">
      <Select value={r.provider} options={['google_ads', 'dataforseo']} onChange={v => patch('research', { provider: v as 'google_ads' | 'dataforseo' })} />
    </Field>
    <p className="mt-2 text-xs leading-5 text-slate-400">Google Ads needs the four GOOGLE_ADS_* Worker secrets and a developer token approved for Basic Access — check the Integrations tab for status.</p>
    <Divider />
    <TagEditor label="Keyword seed templates" value={r.seedTemplates} placeholder="e.g. {service} installation {city}" onChange={v => patch('research', { seedTemplates: v })} />
    <p className="mt-2 text-xs leading-5 text-slate-400">{'{service}'} and {'{city}'} expand per market. Templates supply the phrasing only — every volume number comes from the provider API.</p>
    <Divider />
    <h4 className="mb-1 text-sm font-semibold text-slate-800">Industry search terms</h4>
    <p className="mb-3 text-xs leading-5 text-slate-500">The everyday term customers actually search for each industry ("Plumbing" → "plumber").</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {Object.entries(r.industryTerms).map(([industry, term]) => (
        <label key={industry} className="block">
          <span className="mb-1 block text-[11px] font-semibold text-slate-500">{industry}</span>
          <Input value={term} onChange={v => patch('research', { industryTerms: { ...r.industryTerms, [industry]: v } })} />
        </label>
      ))}
    </div>
  </div>;
}

function Defaults({ settings: s, patch }: { settings: AgencySettings; patch: Patch }) {
  return <div>
    <Heading title="Agency defaults" sub="Reusable pricing, delivery, and writing conventions for new client work." />
    <Grid cols={3}>
      <Field label="Tier 1 monthly"><NumberInput value={s.defaults.tier1Mrr} min={0} onChange={v => patch('defaults', { tier1Mrr: v })} /></Field>
      <Field label="Tier 2 monthly"><NumberInput value={s.defaults.tier2Mrr} min={0} onChange={v => patch('defaults', { tier2Mrr: v })} /></Field>
      <Field label="Tier 3 monthly"><NumberInput value={s.defaults.tier3Mrr} min={0} onChange={v => patch('defaults', { tier3Mrr: v })} /></Field>
    </Grid>
    <Divider />
    <Grid>
      <Field label="Report sender name"><Input value={s.defaults.reportSenderName} onChange={v => patch('defaults', { reportSenderName: v })} /></Field>
      <Field label="Report sender email"><Input type="email" value={s.defaults.reportSenderEmail} onChange={v => patch('defaults', { reportSenderEmail: v })} /></Field>
    </Grid>
    <Divider />
    <TagEditor label="Standard services" value={s.defaults.services} placeholder="Add a service" onChange={v => patch('defaults', { services: v })} />
    <div className="mt-5"><TagEditor label="Standard service areas" value={s.defaults.serviceAreas} placeholder="Add a service area" onChange={v => patch('defaults', { serviceAreas: v })} /></div>
    <div className="mt-5"><Field label="Company voice"><Textarea value={s.defaults.companyVoice} onChange={v => patch('defaults', { companyVoice: v })} /></Field></div>
    <div className="mt-5"><TagEditor label="Banned marketing phrases" value={s.defaults.bannedPhrases} placeholder="Add a phrase" onChange={v => patch('defaults', { bannedPhrases: v })} /></div>
  </div>;
}

function Integrations({ health, syncing, onRefresh, onSync }: { health: SettingsHealth | null; syncing: boolean; onRefresh: () => void; onSync: () => void }) {
  return <div>
    <div className="flex items-start justify-between gap-3"><Heading title="Integrations" sub="Connection status only. Credentials remain protected in Cloudflare Worker secrets." /><button onClick={onRefresh} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><RefreshCw className="h-4 w-4" /></button></div>
    <div className="grid gap-3 sm:grid-cols-2">
      {health?.integrations.map(item => <div key={item.id} className="rounded-xl border border-slate-200 p-4">
        <div className="flex items-start gap-3">
          {item.configured ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> : <AlertCircle className={`mt-0.5 h-5 w-5 shrink-0 ${item.optional ? 'text-amber-500' : 'text-rose-500'}`} />}
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="text-sm font-semibold text-slate-800">{item.name}</h4>{item.optional && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">Optional</span>}</div><p className="mt-1 text-xs text-slate-500">{item.detail}</p><p className={`mt-2 text-xs font-semibold ${item.configured ? 'text-emerald-600' : item.optional ? 'text-amber-600' : 'text-rose-600'}`}>{item.configured ? 'Configured' : 'Not configured'}</p>{item.lastSuccessAt && <p className="mt-1 text-[11px] text-slate-400">Last data: {new Date(item.lastSuccessAt).toLocaleString()}</p>}</div>
        </div>
        {item.id === 'clarity' && item.configured && <button onClick={onSync} disabled={syncing} className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">{syncing ? 'Syncing…' : 'Run sync now'}</button>}
      </div>)}
    </div>
    <div className="mt-5 flex gap-3 rounded-xl bg-blue-50 p-4 text-sm text-blue-800"><ShieldCheck className="h-5 w-5 shrink-0" /><p>To add or rotate credentials, use Cloudflare Worker secrets. Agency OS intentionally never returns secret values to this page.</p></div>
  </div>;
}

function System({ health, onExport, onRefresh }: { health: SettingsHealth | null; onExport: () => void; onRefresh: () => void }) {
  const counts = health?.system.counts;
  return <div>
    <div className="flex items-start justify-between gap-3"><Heading title="System & data" sub="Operational status, workspace totals, exports, and build diagnostics." /><button onClick={onRefresh} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><RefreshCw className="h-4 w-4" /></button></div>
    <div className="grid gap-3 sm:grid-cols-3">{[['Leads', counts?.leads ?? 0], ['Projects', counts?.projects ?? 0], ['Calling sessions', counts?.sessions ?? 0]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value}</p></div>)}</div>
    <Divider />
    <div className="space-y-3">
      <StatusRow label="API" value="Online" good />
      <StatusRow label="D1 database" value={health?.system.database ?? 'Checking…'} good={health?.system.database === 'connected'} />
      <StatusRow label="Environment" value={health?.system.environment ?? '—'} />
      <StatusRow label="Health checked" value={health ? new Date(health.checkedAt).toLocaleString() : '—'} />
      <StatusRow label="Last email automation activity" value={health?.system.lastAutomationAt ? new Date(health.system.lastAutomationAt).toLocaleString() : 'No activity yet'} />
    </div>
    <Divider />
    <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"><div><h4 className="text-sm font-semibold text-slate-800">Export lead data</h4><p className="mt-1 text-xs text-slate-500">Download a CSV backup of every lead and enrichment field.</p></div><button onClick={onExport} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4" />Export CSV</button></div>
  </div>;
}

function ActivityLog({ events, loading, onRefresh }: { events: ApplicationEvent[]; loading: boolean; onRefresh: () => void }) {
  const [filter, setFilter] = useState<'all' | 'error'>('all');
  const [query, setQuery] = useState('');
  const visible = events.filter(event => {
    if (filter === 'error' && event.level !== 'error' && event.event_type !== 'request_failed') return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [event.source, event.event_type, event.message, event.path]
      .some(value => value?.toLowerCase().includes(needle));
  });

  return <div>
    <div className="flex items-start justify-between gap-3">
      <Heading title="Activity & errors" sub="Recent application actions and failures. Refreshes automatically every 10 seconds while this page is open." />
      <button onClick={onRefresh} disabled={loading} title="Refresh activity" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
    </div>
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="inline-flex w-fit rounded-lg bg-slate-100 p-1">
        <button onClick={() => setFilter('all')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${filter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>All activity</button>
        <button onClick={() => setFilter('error')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${filter === 'error' ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-500'}`}>Errors only</button>
      </div>
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter by source, action, or path" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 sm:max-w-xs" />
    </div>
    <div className="overflow-hidden rounded-xl border border-slate-200">
      {visible.length === 0 ? <div className="px-5 py-12 text-center text-sm text-slate-400">{loading ? 'Loading activity…' : filter === 'error' ? 'No errors in the recent log.' : 'No application activity recorded yet.'}</div> :
        <div className="divide-y divide-slate-100">{visible.map(event => {
          const tone = event.level === 'error' ? 'bg-rose-500' : event.level === 'warn' ? 'bg-amber-500' : 'bg-emerald-500';
          const dateValue = event.created_at.includes('T') ? event.created_at : `${event.created_at.replace(' ', 'T')}Z`;
          return <details key={event.id} className="group bg-white open:bg-slate-50">
            <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone}`} />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-sm font-semibold text-slate-800">{event.message}</span><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{event.source}</span></div><div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-400"><span>{new Date(dateValue).toLocaleString()}</span>{event.status_code != null && <span>HTTP {event.status_code}</span>}{event.duration_ms != null && <span>{event.duration_ms} ms</span>}</div></div>
              <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-slate-100 px-9 py-3 text-xs text-slate-600"><dl className="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]"><dt className="font-semibold text-slate-400">Event</dt><dd>{event.event_type}</dd>{event.method && <><dt className="font-semibold text-slate-400">Request</dt><dd className="break-all">{event.method} {event.path}</dd></>}{event.details_json && <><dt className="font-semibold text-slate-400">Details</dt><dd><pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{event.details_json}</pre></dd></>}</dl></div>
          </details>;
        })}</div>}
    </div>
    <p className="mt-3 text-xs text-slate-400">The feed stores request metadata and operational details only. Request bodies, API keys, credentials, and client form values are excluded.</p>
  </div>;
}

function Heading({ title, sub }: { title: string; sub: string }) { return <div className="mb-6"><h3 className="text-lg font-bold text-slate-900">{title}</h3><p className="mt-1 text-sm text-slate-500">{sub}</p></div>; }
function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) { return <div className={`grid gap-5 ${cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{children}</div>; }
function Divider() { return <div className="my-6 border-t border-slate-100" />; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>; }
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
function Input({ value, onChange, ...props }: { value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) { return <input {...props} value={value} onChange={e => onChange(e.target.value)} className={inputClass} />; }
function NumberInput({ value, onChange, ...props }: { value: number; onChange: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) { return <input {...props} type="number" value={value} onChange={e => onChange(Number(e.target.value))} className={inputClass} />; }
function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) { return <select value={value} onChange={e => onChange(e.target.value)} className={inputClass}>{options.map(o => <option key={o}>{o}</option>)}</select>; }
function Textarea({ value, onChange }: { value: string; onChange: (v: string) => void }) { return <textarea value={value} rows={3} onChange={e => onChange(e.target.value)} className={inputClass} />; }
function TagEditor({ label, value, onChange, placeholder = 'Type and press Enter' }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  function add() { const v = draft.trim(); if (v && !value.includes(v)) onChange([...value, v]); setDraft(''); }
  return <div><span className="mb-2 block text-xs font-semibold text-slate-600">{label}</span><div className="flex flex-wrap gap-2">{value.map((v, i) => <span key={`${v}-${i}`} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700">{v}<button type="button" onClick={() => onChange(value.filter((_, x) => x !== i))} className="ml-1 text-slate-400 hover:text-rose-500">×</button></span>)}</div><input value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} onBlur={add} className={`${inputClass} mt-2`} /></div>;
}
function StatusRow({ label, value, good }: { label: string; value: string; good?: boolean }) { return <div className="flex items-center justify-between border-b border-slate-100 pb-3 text-sm last:border-0"><span className="text-slate-500">{label}</span><span className={`font-semibold ${good ? 'text-emerald-600' : 'text-slate-700'}`}>{value}</span></div>; }
function ChoiceGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  return <div><span className="mb-2 block text-xs font-semibold text-slate-600">{label}</span><div className="flex flex-wrap gap-2">{options.map(option => { const checked = value.includes(option); return <button type="button" key={option} onClick={() => onChange(checked ? value.filter(v => v !== option) : [...value, option])} className={`rounded-lg border px-3 py-2 text-xs font-semibold capitalize ${checked ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{option}</button>; })}</div></div>;
}
