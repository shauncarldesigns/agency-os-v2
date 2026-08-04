import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, FlaskConical, Loader2, Trash2, X } from 'lucide-react';
import type { DiscoveryAnswers, Project, ProjectDiscovery, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';

type Field = {
  key: string;
  label: string;
  prompt?: string;
  purpose?: string;
  type?: 'text' | 'textarea' | 'yesno' | 'choice' | 'multi';
  options?: string[];
  placeholder?: string;
  internal?: boolean;
};
type Section = { title: string; eyebrow: string; fields: Field[] };

const SECTIONS: Section[] = [
  { eyebrow: '01 · Verify', title: 'Business information', fields: [
    { key: 'business_name', label: 'Business name' }, { key: 'owner_name', label: 'Owner name' },
    { key: 'founded_year', label: 'Founded year' }, { key: 'phone', label: 'Phone number' },
    { key: 'email', label: 'Email address' }, { key: 'business_address', label: 'Business address' },
    { key: 'service_radius', label: 'Service radius', placeholder: 'Example: 40 miles from Green Bay' },
    { key: 'business_hours', label: 'Business hours', type: 'textarea' },
    { key: 'emergency_service', label: 'Emergency service?', type: 'yesno' },
    { key: 'licensed_status', label: 'Licensed', prompt: 'Is the business licensed?', type: 'choice', options: ['Yes', 'No', 'Unsure'] },
    { key: 'license_details', label: 'License details', placeholder: 'License type or number, plus states or jurisdictions covered', type: 'textarea' },
    {
      key: 'bonded_status',
      label: 'Bonded',
      prompt: 'Is the business bonded?',
      purpose: 'A surety bond protects the customer if the contractor fails to meet certain obligations. It is separate from liability insurance. Choose Unsure if the client does not know.',
      type: 'choice',
      options: ['Yes', 'No', 'Unsure'],
    },
    { key: 'insured_status', label: 'Insured', prompt: 'Is the business insured?', type: 'choice', options: ['Yes', 'No', 'Unsure'] },
    {
      key: 'owner_credentials',
      label: 'Owner credentials',
      purpose: 'Experience, training, licenses, or trade qualifications worth featuring—for example: master plumber, 25 years in HVAC, union apprenticeship, or factory-trained technician. Leave blank if none.',
      type: 'textarea',
    },
    { key: 'tagline', label: 'Tagline (optional)' },
  ]},
  { eyebrow: '02 · Story', title: 'Company story', fields: [
    { key: 'company_story', label: 'How it started', prompt: 'How did you get started?', purpose: 'Feeds the About page and homepage story.', type: 'textarea' },
  ]},
  { eyebrow: '03 · Growth', title: 'Services & SEO', fields: [
    { key: 'priority_services', label: 'Priority jobs', prompt: 'What jobs are you trying to get more of?', purpose: 'Controls homepage service order, service pages, and SEO priority.', type: 'textarea' },
    { key: 'missing_services', label: 'Missing services', prompt: 'Looking at the services I found, am I missing anything?', type: 'textarea' },
    { key: 'current_service_cities', label: 'Current service area', prompt: 'What cities do you currently serve?', placeholder: 'Comma-separated cities', type: 'textarea' },
    { key: 'target_cities', label: 'SEO target cities', prompt: 'What cities would you like to get more business from?', placeholder: 'Comma-separated cities', type: 'textarea' },
    { key: 'customer_type', label: 'Residential / commercial', prompt: 'Do you work residential, commercial, or both?', type: 'choice', options: ['Residential', 'Commercial', 'Both'] },
    { key: 'unwanted_work', label: 'Work to de-emphasize', prompt: 'Are there any jobs or services you’re trying to move away from?', purpose: 'The brief will explicitly de-emphasize this work.', type: 'textarea' },
  ]},
  { eyebrow: '04 · Proof', title: 'Trust & credibility', fields: [
    { key: 'certifications', label: 'Certifications', prompt: 'Are you certified with any manufacturers or organizations you’d like featured?', placeholder: 'Carrier, Trane, Kohler, Rheem, BBB, Chamber…', type: 'textarea' },
    { key: 'warranties', label: 'Warranties', prompt: 'Do you offer any workmanship or manufacturer warranties?', type: 'textarea' },
    { key: 'financing', label: 'Financing', prompt: 'Do you offer financing?', type: 'textarea' },
  ]},
  { eyebrow: '05 · Look', title: 'Photos & branding', fields: [
    { key: 'photos_available', label: 'Work photos', prompt: 'Do you have photos of your work? Even photos from your phone are perfect.', type: 'yesno' },
    { key: 'photos_delivery_status', label: 'Work photo delivery', prompt: 'Have the work photos been delivered to me?', type: 'choice', options: ['Delivered', 'Still waiting'] },
    { key: 'logo_available', label: 'Logo', prompt: 'Do you have a logo?', type: 'yesno' },
    { key: 'logo_delivery_status', label: 'Logo delivery', prompt: 'Has the logo been delivered to me?', type: 'choice', options: ['Delivered', 'Still waiting'] },
    {
      key: 'social_media',
      label: 'Social media pages',
      prompt: 'Do you have any social media pages?',
      type: 'multi',
      options: ['Facebook', 'Instagram', 'LinkedIn', 'YouTube', 'TikTok', 'X', 'Nextdoor', 'Pinterest', 'Yelp', 'Other'],
    },
    {
      key: 'social_media_urls',
      label: 'Social profile links',
      placeholder: 'Paste the profile URLs for the selected platforms',
      type: 'textarea',
    },
    { key: 'website_inspiration', label: 'Website inspiration', prompt: 'Are there contractor websites you really like or dislike?', type: 'textarea' },
  ]},
  { eyebrow: '06 · Experience', title: 'Customer experience', fields: [
    { key: 'common_question', label: 'Common question', prompt: 'What’s the question you answer ten times a week?', purpose: 'Feeds FAQ and homepage copy.', type: 'textarea' },
    { key: 'hidden_selling_point', label: 'Hidden selling point', prompt: 'Is there anything customers are usually surprised to learn about your business?', type: 'textarea' },
  ]},
  { eyebrow: '07 · Convert', title: 'Lead generation', fields: [
    { key: 'free_estimates', label: 'Free estimates', prompt: 'Do you offer free estimates?', type: 'yesno' },
    { key: 'primary_cta', label: 'Primary website goal', prompt: 'When someone lands on your website, what’s the one thing you’d like them to do?', type: 'choice', options: ['Call', 'Request estimate', 'Book appointment', 'Contact form'] },
    { key: 'form_destination', label: 'Form destination', prompt: 'When someone fills out the contact form, where should those leads go?', placeholder: 'Email, CRM, or both' },
    { key: 'software_integrations', label: 'Software integrations', prompt: 'Do you use any software you’d like connected to the website?', placeholder: 'Jobber, Housecall Pro, ServiceTitan, Calendly…', type: 'textarea' },
  ]},
  { eyebrow: '08 · Technical', title: 'Domain', fields: [
    { key: 'owns_domain', label: 'Already own a domain?', type: 'yesno' },
    { key: 'domain_name', label: 'Domain name' }, { key: 'registrar', label: 'Registrar' },
    { key: 'domain_owner_email', label: 'Domain owner email' },
  ]},
  { eyebrow: '09 · Position', title: 'Competition', fields: [
    { key: 'competitors', label: 'Competitors', prompt: 'Who do you lose jobs to most often?', type: 'textarea' },
  ]},
  { eyebrow: '10 · Outcome', title: 'Success', fields: [
    { key: 'business_goal', label: '6–12 month success goal', prompt: 'If this website could do one thing really well over the next 6–12 months, what would make you say it was worth every penny?', type: 'textarea' },
  ]},
  { eyebrow: '11 · Notes', title: 'General notes', fields: [
    {
      key: 'general_notes',
      label: 'Meeting notes',
      prompt: 'Anything else worth capturing from the conversation?',
      placeholder: 'Loose details, follow-up items, client preferences, or context that did not fit elsewhere…',
      type: 'textarea',
    },
  ]},
];

function initialAnswers(project: Project): DiscoveryAnswers {
  return {
    business_name: project.business_name ?? '', owner_name: project.owner_name ?? '',
    founded_year: project.founded_year ? String(project.founded_year) : '',
    phone: project.phone ?? '', email: project.email ?? '',
    business_address: [project.city, project.state].filter(Boolean).join(', '),
    owner_credentials: project.owner_credentials ?? '', tagline: project.tagline ?? '',
    current_service_cities: parseList(project.service_areas).join(', '),
    priority_services: parseList(project.services).join(', '),
    domain_name: project.domain ?? '', registrar: project.registrar ?? '',
    domain_owner_email: project.domain_owner_email ?? '',
  };
}

export function DiscoveryPanel({ project, open, onClose, showToast, onChanged }: {
  project: Project; open: boolean; onClose: () => void; showToast: ShowToast;
  onChanged: (discovery: ProjectDiscovery | null) => void;
}) {
  const [section, setSection] = useState(0);
  const [answers, setAnswers] = useState<DiscoveryAnswers>(() => initialAnswers(project));
  const [record, setRecord] = useState<ProjectDiscovery | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const isProspect = project.status === 'prospect';

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.projects.discovery.get(project.id).then(({ discovery }) => {
      setRecord(discovery);
      if (discovery) {
        try { setAnswers({ ...initialAnswers(project), ...JSON.parse(discovery.answers_json) }); }
        catch { setAnswers(initialAnswers(project)); }
      } else setAnswers(initialAnswers(project));
      setDirty(false);
    }).catch((err) => showToast(err instanceof ApiError ? err.message : 'Could not load discovery', 'error'))
      .finally(() => setLoading(false));
  }, [open, project.id]);

  useEffect(() => {
    if (!open || !dirty) return;
    const timer = setTimeout(() => void save('draft', true), 800);
    return () => clearTimeout(timer);
  }, [answers, dirty, open]);

  const answered = useMemo(() => Object.values(answers).filter((v) => typeof v === 'boolean' || String(v).trim()).length, [answers]);
  const total = SECTIONS.reduce((sum, item) => sum + item.fields.length, 0);
  const foundServices = useMemo(() => parseList(project.services), [project.services]);

  async function save(status: 'draft' | 'complete', quiet = false) {
    setSaving(true);
    try {
      const { discovery } = await api.projects.discovery.save(project.id, { answers, status, testMode: isProspect });
      setRecord(discovery); setDirty(false); onChanged(discovery);
      if (!quiet) {
        showToast(
          status === 'complete'
            ? 'Discovery complete — Project Info and Brief Studio refreshed'
            : 'Discovery saved',
          'success',
        );
      }
      if (status === 'complete') onClose();
    } catch (err) {
      if (!quiet) showToast(err instanceof ApiError ? err.message : 'Could not save discovery', 'error');
    } finally { setSaving(false); }
  }

  async function clear() {
    if (!window.confirm(`Clear all discovery answers for ${project.business_name}?`)) return;
    await api.projects.discovery.clear(project.id);
    setRecord(null); setAnswers(initialAnswers(project)); setDirty(false); onChanged(null);
    showToast('Discovery cleared', 'success');
  }

  if (!open) return null;
  const current = SECTIONS[section];
  return (
    <div className="fixed inset-0 z-[90] flex bg-slate-950/45 backdrop-blur-sm">
      <div className="m-auto flex h-[min(900px,94vh)] w-[min(1180px,96vw)] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-slate-50 p-4 md:block">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Website planning</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{project.business_name}</div>
          {isProspect && <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700"><FlaskConical className="h-4 w-4" /> Test mode</div>}
          <div className="mt-4 space-y-1">{SECTIONS.map((item, index) => (
            <button key={item.title} onClick={() => setSection(index)} className={`w-full rounded-lg px-3 py-2 text-left text-xs ${index === section ? 'bg-slate-900 font-semibold text-white' : 'text-slate-600 hover:bg-slate-200'}`}>
              <span className="block text-[10px] uppercase opacity-60">{item.eyebrow}</span>{item.title}
            </button>
          ))}</div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div><div className="text-[11px] font-bold uppercase tracking-wider text-blue-600">{current.eyebrow}</div>
              <h2 className="text-xl font-bold text-slate-900">{current.title}</h2>
              <p className="text-xs text-slate-500">{answered} of {total} answers captured · {saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}</p></div>
            <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-5 md:px-8">
            {loading ? <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading discovery…</div> :
              <div className="mx-auto max-w-3xl space-y-5">
                {current.fields.filter((field) => {
                  if (field.key === 'photos_delivery_status') return answers.photos_available === true;
                  if (field.key === 'logo_delivery_status') return answers.logo_available === true;
                  if (field.key === 'license_details') return answers.licensed_status === 'Yes';
                  return true;
                }).map((field) => (
                  <div key={field.key}>
                    {field.key === 'missing_services' && (
                      <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-blue-600">
                          Services already found
                        </div>
                        {foundServices.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {foundServices.map((service) => (
                              <span
                                key={service}
                                className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                              >
                                {service}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-blue-700">
                            No services are saved on this project yet. Capture the full list below.
                          </p>
                        )}
                      </div>
                    )}
                    <DiscoveryField field={field} value={answers[field.key] ?? ''} onChange={(value) => {
                      setAnswers((prev) => ({ ...prev, [field.key]: value }));
                      setDirty(true);
                    }} />
                  </div>
                ))}
              </div>}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
            <div className="flex gap-2">
              <button disabled={section === 0} onClick={() => setSection((v) => v - 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>
              <button disabled={section === SECTIONS.length - 1} onClick={() => setSection((v) => v + 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="flex gap-2">
              {record && <button onClick={() => void clear()} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /> Clear</button>}
              <button onClick={() => void save('complete')} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white"><Check className="h-4 w-4" /> Mark discovery complete</button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

function DiscoveryField({ field, value, onChange }: { field: Field; value: string | boolean; onChange: (value: string | boolean) => void }) {
  return <label className={`block rounded-xl border p-4 ${field.internal ? 'border-violet-100 bg-violet-50/30' : 'border-slate-200 bg-white'}`}>
    <span className="block text-sm font-bold text-slate-900">{field.prompt ?? field.label}</span>
    {field.prompt && <span className="mt-0.5 block text-xs font-medium text-slate-400">{field.label}</span>}
    {field.purpose && <span className="mt-1 block text-xs text-blue-600">{field.purpose}</span>}
    {field.type === 'yesno' ? <span className="mt-3 flex gap-2">{['Yes', 'No'].map((option) => <button type="button" key={option} onClick={() => onChange(option === 'Yes')} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${value === (option === 'Yes') ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}>{option}</button>)}</span>
      : field.type === 'multi' ? <span className="mt-3 flex flex-wrap gap-2">{field.options?.map((option) => {
        const selected = String(value).split(',').map((item) => item.trim()).filter(Boolean);
        const active = selected.includes(option);
        return <button type="button" key={option} onClick={() => onChange(active ? selected.filter((item) => item !== option).join(', ') : [...selected, option].join(', '))} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${active ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300'}`}>{active && <Check size={13} />}{option}</button>;
      })}</span>
      : field.type === 'choice' ? <span className="mt-3 flex flex-wrap gap-2">{field.options?.map((option) => <button type="button" key={option} onClick={() => onChange(option)} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${value === option ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}>{option}</button>)}</span>
      : field.type === 'textarea' ? <textarea value={String(value)} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} rows={3} className="mt-3 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
      : <input value={String(value)} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />}
  </label>;
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try { const value = JSON.parse(raw); return Array.isArray(value) ? value : []; } catch { return []; }
}
