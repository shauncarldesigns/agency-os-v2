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
    id: 'offer-overview',
    title: 'Offer Overview',
    eyebrow: 'What we actually sell',
    summary: 'The client-facing promise broken into foundation setup and monthly fulfillment.',
    icon: BookOpen,
    sections: [
      {
        title: 'The two-part offer',
        items: [
          'Foundation month: build the website, GBP, listings, review system, and initial content base at the same time.',
          'Every month after: keep GBP active, request and manage reviews, build local pages, maintain listings, and report progress.',
          'The outcome to communicate is local visibility plus proof: more places finding the business, more reasons to trust it, and clearer evidence of activity.',
        ],
      },
      {
        title: 'Foundation promise',
        items: [
          'Complete 8-10 page website that is fast, mobile, and built to convert visitors into calls.',
          'Google Business Profile claimed, verified, fully optimized, and connected to the website.',
          'Local listings, review generation, and initial GBP/social content set up before the client is considered launched.',
        ],
      },
      {
        title: 'Monthly promise',
        items: [
          'Regular GBP posts, offers, images, videos, and social publishing so the client does not look inactive.',
          'Review requests, follow-ups, replies, bad-review flagging, and QR code review flow.',
          'Three new local pages per month, directory/listing maintenance, town-by-town tuning, and reporting.',
        ],
      },
      {
        title: 'How to use this doc',
        body: 'Use this page as the top-level service definition. The Foundation Month and Monthly Fulfillment pages turn the promise into operator checklists.',
      },
    ],
  },
  {
    id: 'foundation-month',
    title: 'Foundation Month',
    eyebrow: 'First month setup',
    summary: 'Everything that should be built together before the client moves into ongoing monthly work.',
    icon: Rocket,
    sections: [
      {
        title: 'Website and GBP foundation',
        items: [
          'Build the complete 8-10 page website with mobile-first layout, clear calls, service coverage, and local trust signals.',
          'Claim, verify, and fully optimize the Google Business Profile.',
          'Set the business description, services list, service descriptions, attributes, and social links.',
          'Confirm GBP details match the website and directory data before launch.',
        ],
      },
      {
        title: 'Local presence setup',
        items: [
          'Set up local listing management across 62 directories so the business appears where it needs to be.',
          'Enable auto-sync and duplicate detection so name, address, phone, and website stay consistent.',
          'Complete visibility groundwork for Google Maps, Google AI, ChatGPT, Gemini, and Perplexity.',
        ],
      },
      {
        title: 'Review system setup',
        items: [
          'Build and configure the automated review request system.',
          'Generate the QR code for easy customer reviews.',
          'Confirm the review request path is simple enough for the client to use immediately.',
        ],
      },
      {
        title: 'Initial content push',
        items: [
          'Publish the first batch of GBP posts, images, and videos to kickstart activity.',
          'Run the first round of image optimization, including geotagging and metadata for local signals.',
          'Confirm local search groundwork is complete before the client is moved into monthly fulfillment.',
        ],
      },
      {
        title: 'Done means',
        body: 'The client has a live site, optimized GBP, synced local presence, working review system, initial content activity, and baseline reporting inputs ready for ongoing work.',
        callout: 'Do not treat the site launch alone as the foundation being complete. The offer includes GBP, listings, reviews, and initial content setup.',
      },
    ],
  },
  {
    id: 'monthly-fulfillment',
    title: 'Monthly Fulfillment',
    eyebrow: 'Every month',
    summary: 'The recurring work that keeps the client visible, active, and reportable.',
    icon: CalendarCheck,
    sections: [
      {
        title: 'GBP content and activity',
        items: [
          'Publish regular GBP posts, offers, images, and videos to keep the profile active and ranking.',
          'Create and publish videos to GBP and YouTube when included in the client workflow.',
          'Optimize images with geotagging and metadata for stronger local signals.',
          'Publish social posts to Facebook, Instagram, LinkedIn, and YouTube as applicable.',
        ],
      },
      {
        title: 'Reputation and reviews',
        items: [
          'Run automated review requests and follow-ups.',
          'Reply to reviews or flag bad reviews when appropriate.',
          'Keep the QR code review flow available and easy for the client to share.',
          'Display posts and reviews on the website to build trust.',
        ],
      },
      {
        title: 'Local SEO and visibility',
        items: [
          'Build three new local pages every month targeting specific towns and services.',
          'Maintain local listing management across 62 directories, including auto-sync and duplicate detection.',
          'Tune content and profile signals for "near me" and town-by-town local search.',
          'Update the sitemap and search visibility checks after new pages are published.',
        ],
      },
      {
        title: 'Reporting and support',
        items: [
          'Send weekly progress updates and GBP change alerts so the client knows work is happening.',
          'Send monthly ranking reports with before-and-after heatmaps and up to 10 tracked keywords.',
          'Send proactive reminders to keep the profile stocked with fresh photos and content.',
          'Use reports to connect activity to visibility, calls, form fills, reviews, and page growth where tracking is installed.',
        ],
      },
    ],
  },
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
          'Run a clean audit and speed test before announcing the site as live.',
          'Verify title tags, meta descriptions, and schema are present on priority pages.',
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
      {
        title: 'Move into fulfillment',
        items: [
          'Confirm the Foundation Month checklist is complete, not just the website launch.',
          'Schedule the first Monthly Fulfillment cycle: GBP content, review requests, local pages, listing checks, and reporting.',
          'Tell the client what recurring work starts next so the handoff from launch to monthly value is obvious.',
        ],
      },
    ],
  },
  {
    id: 'tracking-tech',
    title: 'Tracking & Tech Setup',
    eyebrow: 'Post-sale measurement',
    summary: 'The instrumentation needed to prove value after launch.',
    icon: CalendarCheck,
    sections: [
      {
        title: 'Core tracking',
        items: [
          'Install Google Tag Manager so future tags can be added without rebuilding the site.',
          'Add the Google Analytics tag to monitor traffic and engagement.',
          'Add conversion tracking for form submissions, phone taps, primary CTA clicks, and important button clicks.',
          'Add lead-capture hooks on buttons and forms so monthly reporting can show actual inquiries.',
          'Add call tracking through CallRail, Google tracking numbers, or the chosen call attribution tool.',
          'Confirm tracking covers the monthly reporting promise: calls, forms, CTA clicks, rankings, reviews, and GBP activity where possible.',
        ],
      },
      {
        title: 'Search and platform setup',
        items: [
          'Verify whether reporting can query Search Console from the stored URL or whether each client URL must be explicitly added.',
          'Add the site to Google Search Console once the domain is live.',
          'Use Cloudflare DNS verification or Tag Manager verification when available.',
          'Submit or refresh the sitemap in Google after launch and after meaningful page batches.',
        ],
      },
      {
        title: 'Site metadata',
        items: [
          'Confirm each priority page has a specific title tag and meta description.',
          'Generate a schema file or schema-ready block for the business, services, service areas, and FAQs.',
          'Keep schema consistent with the visible page content and business details.',
        ],
      },
      {
        title: 'Decision still needed',
        body: 'Choose the default stack for reporting and call attribution: GA4 + GTM + Search Console are baseline, while call tracking needs a standard provider and per-client setup process.',
        callout: 'Do not promise monthly lead numbers until calls, forms, and CTA events are actually tracked.',
      },
    ],
  },
  {
    id: 'pre-sale-build',
    title: 'Pre-Sale Site QA',
    eyebrow: 'Before the client sees it',
    summary: 'Checks for demo or speculative sites before they are shown to a prospect.',
    icon: FileText,
    sections: [
      {
        title: 'Demo-site cleanup',
        items: [
          'Remove links that send the prospect to unrelated external pages.',
          'Make sure every visible CTA points somewhere intentional.',
          'Check that business name, city, phone, service list, and service areas match the prospect.',
          'Remove placeholder sections, generic copy, and any landingsite defaults that weaken the reveal.',
        ],
      },
      {
        title: 'Proof and imagery',
        items: [
          'Use real review language from enrichment when available.',
          'Prefer client-owned or job-relevant photos over generic visuals.',
          'If using Paige or another tool later, verify whether it can pull images from built pages or needs an upload workflow.',
        ],
      },
      {
        title: 'Technical sanity pass',
        items: [
          'Run the site on mobile before sending it.',
          'Confirm forms and phone links do not break the pitch.',
          'Check basic speed and layout before the prospect opens it.',
        ],
      },
    ],
  },
  {
    id: 'onboarding',
    title: 'New Client Onboarding',
    eyebrow: 'Signed client setup',
    summary: 'The repeatable setup path once a prospect becomes a client.',
    icon: ArrowRightCircle,
    sections: [
      {
        title: 'Baseline audit',
        items: [
          'Capture where the client starts: current rankings, GBP state, website quality, PageSpeed, and obvious technical issues.',
          'Save the baseline before changes so future reports can show rank and traffic progress.',
          'Document the client domain, hosting state, DNS access, analytics state, and GBP ownership state.',
        ],
      },
      {
        title: 'Access and ownership',
        items: [
          'Request or claim Google Business Profile manager access using the agency ID.',
          'Coordinate the GBP access process with Sandy and Craig where needed.',
          'Get DNS access unless the site can be hosted through landingsite nameservers.',
          'Confirm what setting up a Paige account entails before making it part of the standard workflow.',
        ],
      },
      {
        title: 'Client asset request',
        items: [
          'Ask the client to upload lots of real images: team, trucks, completed jobs, equipment, shop, before/after, and local work.',
          'Collect service details, service areas, preferred jobs, disliked jobs, certifications, warranties, and financing info.',
          'Collect any existing tracking, Search Console, Analytics, GBP, Meta, Yelp, Bing, or directory logins.',
        ],
      },
      {
        title: 'Per-client setup',
        body: 'Each client needs a standard setup packet: domain/DNS, GTM, Analytics, Search Console, call tracking, GBP access, sitemap submission, schema, reporting source, and content plan.',
      },
      {
        title: 'Offer alignment',
        body: 'Frame onboarding around the Foundation Month promise: website, GBP, listings, reviews, and initial content all need inputs before launch is truly complete.',
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
          'If landingsite nameservers are usable, prefer that path; otherwise get DNS access early.',
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
    id: 'seo-growth',
    title: 'SEO Growth Plan',
    eyebrow: 'Monthly content + authority',
    summary: 'How to make ongoing SEO pages useful instead of templated filler.',
    icon: Rocket,
    sections: [
      {
        title: 'Location pages that can rank',
        items: [
          'Do not publish the same page with only the city swapped.',
          'Add local landmarks, neighborhoods, geography, and city-specific references.',
          'Use location-specific FAQs around housing stock, weather concerns, permit requirements, or common local jobs.',
          'Include proof from that city when available: testimonials, photos, job examples, or nearby service notes.',
          'Mention service variations that matter in that specific location.',
        ],
      },
      {
        title: 'Beyond service-area pages',
        items: [
          'Add seasonal pages such as furnace tune-up before winter in Green Bay.',
          'Add FAQ and how-to pages for long-tail searches.',
          'Add competitor comparison pages when appropriate and truthful.',
          'Add neighborhood-specific pages for larger markets.',
          'Add blog-style posts that can also be amplified through GBP or Paige.',
        ],
      },
      {
        title: 'Authority and local signals',
        items: [
          'Register or clean up Apple, Yelp, Bing, Nextdoor, and trade-specific directory listings.',
          'Post services as products on Google Business Profile where it fits the business.',
          'Start or connect social channels that can link back to the site.',
          'Add a map pack or location map section where it helps users and local relevance.',
        ],
      },
      {
        title: 'Quality control',
        items: [
          'Validate generated SEO pages before publishing.',
          'Check that prompts produce genuinely local pages with service area, specific keywords, and schema-ready details.',
          'Update the sitemap after new pages are added.',
          'Treat 3-5 location pages per month as a quality target, not a template quota.',
          'Use the public monthly offer as the minimum cadence: three useful local pages per month targeting specific towns and services.',
        ],
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
          'Review GA4, conversion events, call tracking, and CTA activity once installed.',
          'Compare new leads or calls against the pre-launch baseline.',
          'Look for weak pages, missing service coverage, and service-area expansion opportunities.',
          'Compare client status against MRR rules before reporting revenue.',
        ],
      },
      {
        title: 'Monthly fulfillment review',
        items: [
          'Confirm GBP content, offers, images, or videos were published.',
          'Confirm review requests, follow-ups, replies, and any bad-review flags were handled.',
          'Confirm the three local pages for the month were built or scheduled.',
          'Confirm local listings stayed synced and duplicate issues were addressed.',
          'Confirm the client received progress updates, GBP change alerts, and the monthly ranking report.',
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
