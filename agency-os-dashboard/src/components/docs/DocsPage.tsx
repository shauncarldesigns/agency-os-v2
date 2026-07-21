import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightCircle,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  FileText,
  Globe2,
  PhoneCall,
  Rocket,
  Search,
} from 'lucide-react';

type DocSection = {
  title: string;
  body?: string;
  items?: string[];
  callout?: string;
};

type DocPage = {
  id: string;
  title: string;
  eyebrow: string;
  summary: string;
  icon: typeof BookOpen;
  sections: DocSection[];
};

const DOCS: DocPage[] = [
  {
    id: 'after-launch',
    title: 'After Launch',
    eyebrow: 'Live client checklist',
    summary: 'The handoff from launched site to retained client.',
    icon: Rocket,
    sections: [
      {
        title: 'Launch verification',
        items: [
          'Confirm the custom domain resolves at the live site.',
          'Verify SSL on both apex and www.',
          'Check homepage, service pages, contact page, phone links, forms, and mobile layout.',
          'Record the launch date and move the project to live after the client is signed.',
          'Confirm the client is included in MRR only when status is building or live.',
        ],
      },
      {
        title: 'Client communication',
        items: [
          'Send the launch message with the live URL and what changed.',
          'Ask the client to test the main contact path from their phone.',
          'Schedule the first follow-up or monthly review before the launch thread goes cold.',
        ],
      },
      {
        title: 'First follow-up',
        body: 'Use the first check-in to catch small fixes, reinforce the value of the launch, and set expectations for ongoing page work or reporting.',
        callout: 'A quiet client after launch is not automatically a healthy client. Put a next action on the calendar.',
      },
    ],
  },
  {
    id: 'client-forward',
    title: 'Move A Client Forward',
    eyebrow: 'Lifecycle steps',
    summary: 'What each project status means and what should happen next.',
    icon: ArrowRightCircle,
    sections: [
      {
        title: 'Status meanings',
        items: [
          'prospect: demo booked or qualified, but not signed. Excluded from MRR.',
          'building: signed client with a site in production. Counts toward MRR.',
          'live: launched client. Counts toward MRR.',
          'paused: temporarily inactive client. Counts toward MRR.',
          'dead: churned client. Excluded from MRR.',
        ],
      },
      {
        title: 'Prospect to building',
        items: [
          'Confirm the client accepted the offer and payment terms.',
          'Make sure authoritative services and service areas are correct on the project.',
          'Generate or refresh the master brief before serious build work starts.',
          'Move status to building once the deal is real, not merely interested.',
        ],
      },
      {
        title: 'Building to live',
        items: [
          'Complete launch QA and DNS verification.',
          'Confirm the client has approved the core site.',
          'Move status to live only when the site is public and usable.',
        ],
      },
    ],
  },
  {
    id: 'dns',
    title: 'DNS Setup',
    eyebrow: 'Cloudflare + landingsite',
    summary: 'The exact domain rules that keep launch from getting sideways.',
    icon: Globe2,
    sections: [
      {
        title: 'Records to create',
        items: [
          'A @ -> 75.2.29.147',
          'A @ -> 166.117.246.71',
          'CNAME www -> proxy-ssl.getlandingsite.com',
          'Cloudflare proxy must stay off for every record.',
        ],
      },
      {
        title: 'Using the app',
        items: [
          'Use Add domain & DNS the first time a project needs a zone.',
          'Use Manage DNS once the project has a Cloudflare zone.',
          'If records are missing, use retry to recreate them.',
          'Pending zones poll hourly in the Worker and the sidebar card self-polls while open.',
        ],
      },
      {
        title: 'Known limits',
        body: 'Cloudflare zones must be created for apex domains. Subdomains such as client.agncy.dev need records under the existing apex zone and are not handled by the current setup flow.',
        callout: 'The database name is agency-os-v2. Avoid the old agency-os-v2-db typo when applying migrations.',
      },
    ],
  },
  {
    id: 'brief-studio',
    title: 'Brief Studio Workflow',
    eyebrow: 'From qualified lead to build plan',
    summary: 'How to turn project data into landingsite-ready direction.',
    icon: FileText,
    sections: [
      {
        title: 'Before generating',
        items: [
          'Enrich the lead and review mined services, service areas, strengths, and quotes.',
          'Edit project.services and project.service_areas in the operator form; those fields are authoritative.',
          'Treat mined services and areas as signal only.',
        ],
      },
      {
        title: 'Master brief',
        items: [
          'Generate the master brief once the project inputs are accurate.',
          'Regenerate when project data changes and the stale pill appears.',
          'Keep specific proof, reviews, service list, service areas, and positioning intact.',
        ],
      },
      {
        title: 'Page matrix',
        items: [
          'Foundation pages include Homepage, About, Services, Service Areas, Contact, and FAQ.',
          'Service Areas only appears when there are at least two service areas.',
          'Service-area grid pages render as services x cities when there are at least two cities.',
          'Use brief additions to add missing services or areas back into the matrix.',
        ],
      },
    ],
  },
  {
    id: 'calling',
    title: 'Weekly Calling',
    eyebrow: 'Sales operating rhythm',
    summary: 'How calling sessions, demos, callbacks, and outcomes should be interpreted.',
    icon: PhoneCall,
    sections: [
      {
        title: 'Weekly rhythm',
        items: [
          'Monday is prep day: generate the week and review the prospecting block.',
          'Tuesday, Wednesday, and Thursday are calling days.',
          'Friday is review day: inspect week metrics and recover callbacks.',
          'Saturday and Sunday are quiet placeholders.',
        ],
      },
      {
        title: 'Outcome meanings',
        items: [
          'voicemail: logged call, lead remains followable.',
          'not_interested: cold-call rejection; removes lead from the active calling pool.',
          'callback: creates a callback row with day-precision date.',
          'booked: creates a demo, flips lead to qualified, and creates a prospect project.',
          'skipped: silent skip; no call_log entry and no last_called_at update.',
        ],
      },
      {
        title: 'Playbook usage',
        body: 'The cockpit runs the no-oriented calling approach, logs objection chip taps into call_log.objection_hits, and keeps generated rebuttals in playbook_generations.',
      },
    ],
  },
  {
    id: 'monthly-review',
    title: 'Monthly Review',
    eyebrow: 'Client health',
    summary: 'A practical cadence for keeping live accounts warm and useful.',
    icon: CalendarCheck,
    sections: [
      {
        title: 'Review inputs',
        items: [
          'Check PageSpeed for live Tier 3 sites.',
          'Review reporting snapshots and search movement when available.',
          'Look for weak pages, missing service coverage, and service-area expansion opportunities.',
          'Compare client status against MRR rules before reporting revenue.',
        ],
      },
      {
        title: 'Next actions',
        items: [
          'Decide whether the client needs fixes, new pages, reporting, an upsell, or a relationship touch.',
          'Record the next concrete action rather than leaving the client as generally healthy.',
          'If the client is at risk, decide whether they are paused, dead, or just need recovery.',
        ],
      },
      {
        title: 'Operational reminders',
        body: 'Backend deploys through CI after merge to main. Dashboard deploys manually with npm run deploy from agency-os-dashboard and uses the production branch flag.',
      },
    ],
  },
];

function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-sm leading-relaxed text-slate-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionBlock({ section }: { section: DocSection }) {
  return (
    <section className="border-t border-slate-200 py-5 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-sm font-semibold text-slate-900">{section.title}</h3>
      {section.body && <p className="text-sm leading-relaxed text-slate-600">{section.body}</p>}
      {section.items && <Checklist items={section.items} />}
      {section.callout && (
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{section.callout}</span>
        </div>
      )}
    </section>
  );
}

export function DocsPage() {
  const [activeId, setActiveId] = useState(DOCS[0].id);
  const [query, setQuery] = useState('');

  const filteredDocs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return DOCS;
    return DOCS.filter((doc) => {
      const haystack = [
        doc.title,
        doc.eyebrow,
        doc.summary,
        ...doc.sections.flatMap((section) => [
          section.title,
          section.body ?? '',
          section.callout ?? '',
          ...(section.items ?? []),
        ]),
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [query]);

  const activeDoc = filteredDocs.find((doc) => doc.id === activeId) ?? filteredDocs[0] ?? DOCS[0];
  const ActiveIcon = activeDoc.icon;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-blue-600">
            Agency Wiki
          </div>
          <h2 className="text-2xl font-bold text-slate-950">Operator Docs</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
            Launch, fulfillment, DNS, brief, calling, and retention steps for moving clients forward.
          </p>
        </div>
        <label className="relative block w-full md:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          />
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm shadow-slate-200/60">
          <div className="space-y-1">
            {filteredDocs.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">No docs match.</p>
            ) : (
              filteredDocs.map((doc) => {
                const Icon = doc.icon;
                const isActive = activeDoc.id === doc.id;
                return (
                  <button
                    key={doc.id}
                    onClick={() => setActiveId(doc.id)}
                    className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{doc.title}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-slate-400">{doc.eyebrow}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <article className="rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/60">
          <header className="border-b border-slate-200 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
                <ActiveIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {activeDoc.eyebrow}
                </div>
                <h2 className="mt-1 text-xl font-bold text-slate-950">{activeDoc.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">{activeDoc.summary}</p>
              </div>
            </div>
          </header>
          <div className="p-5">
            {activeDoc.sections.map((section) => (
              <SectionBlock key={section.title} section={section} />
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}
