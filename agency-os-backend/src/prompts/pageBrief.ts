/**
 * Per-page brief prompt.
 *
 * The master brief is the source of truth for the project. landingsite.ai can't
 * digest a 2,000-word master brief on its own — it needs a focused, ~250–800
 * word brief per page. This prompt feeds the master brief in as context and
 * asks Claude to write one tight, paste-ready brief for a single page.
 *
 * DESIGN NOTE — angle-led, not template-filled.
 * Earlier versions of this prompt enforced a fixed 6-section markdown structure
 * for every page of every business. The result: briefs that looked uniform even
 * when the underlying businesses had nothing in common. The current prompt
 * instead tells Claude to first pick an "angle" — the lens drawn from this
 * specific business's review themes, owner traits, and differentiators — and
 * to shape the brief around that angle. Some sections are still required
 * (URL/SEO is mechanical and has to stay precise); others are a menu Claude
 * picks from based on what serves the page.
 */

export type PageType =
  | 'homepage'
  | 'about'
  | 'services_overview'
  | 'contact'
  | 'faq'
  | 'service'
  | 'service_area'
  | 'custom';

export interface PageSpec {
  type: PageType;
  service?: string;       // required for 'service' and 'service_area'
  city?: string;          // required for 'service_area'
  customTitle?: string;   // required for 'custom'
}

export interface BuiltPageBriefPrompt {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = `You are writing a single-page brief that will be pasted directly into landingsite.ai to build one specific page of the client's site. The master brief (provided in the user message) is the source of truth for the project — voice, services, areas, differentiators, testimonials. Your job is to extract what's relevant to THIS page and produce a focused, paste-ready brief that reads like it was written for this specific business — not a templated form-fill.

═══ HOW TO APPROACH THIS ═══

Step 1 — Pick the angle (internal, do not output).
Before you write anything, read the master brief and pick the SINGLE strongest angle this page should be told through. The angle is the lens drawn from THIS business's actual review themes, owner traits, customer language, or differentiator — not generic positioning. Examples of real angles:
  - "Family-run since [year], every job touched by the owner"
  - "Same-day response when other shops ghost you"
  - "Straight pricing in an industry known for upsells"
  - "Specialists, not generalists — we do one thing"
  - "Old-school craft, modern materials"
The angle never appears as a literal section. It shapes which sections you include, which quote you lead with, what the hero headline says, and which differentiator gets prime placement. Two pages with the same angle should rhyme; two pages with different angles should read like different companies wrote them.

Step 2 — Pick sections (use the menu, don't fill a mold).
The required mechanical sections:
  - \`# Page Brief: {Page Title}\` (always)
  - \`## URL & SEO\` (always) — URL slug, meta title, meta description (150–160 chars), H1
  - \`## Page Structure\` (always) — sectioned outline of the page with headline copy and the key paragraphs the builder should write. Be specific to this business; don't write generic instructions.

The optional sections (include whichever serve this page; skip the rest; reorder if it helps the angle):
  - \`## Customer Voice\` — verbatim testimonial(s) from the master brief that belong on THIS page. Skip if none applies.
  - \`## Differentiators on this page\` — the 1–3 master-brief differentiators that should land hardest here.
  - \`## Internal Links\` — exact URL slugs this page should link to.
  - \`## Build Notes\` — short imperatives for the builder (CTAs, schema markup, photo direction, phone-display behavior).

You may add one additional section if the business clearly needs it (e.g. \`## Financing\`, \`## License & Insurance\`, \`## After-Hours Coverage\`) and the master brief supports it. Do not invent a section that isn't grounded in the data.

═══ LENGTH BUDGET ═══
- Homepage: 600–800 words
- About / Services Overview: 400–600 words
- Service page: 400–600 words
- Service-area page: 300–500 words
- Contact / FAQ: 250–400 words
- Custom: 300–500 words

═══ MECHANICAL RULES (these stay rigid because the builder relies on them) ═══
- For \`service-area\` pages: the H1 must include both the service and the city; the URL slug follows the master brief's \`/service-areas/<service>-<city>-<state>\` pattern; the meta title follows \`{Service} in {City}, {State} | {Business Name}\`.
- For \`service\` pages: link to every service-area child (use the master brief's enumeration); display the phone number from the master brief above the fold.
- Meta descriptions: 150–160 characters.
- Pull only from the master brief. Do not invent new claims, certifications, owner names, hex colors, or facts.
- If the master brief has \`[TBD: <field>]\` tokens for fields you need, propagate them verbatim — do NOT fill them in.

═══ VOICE ═══
- Target a 6th–8th grade reading level, but let the angle dictate tone — a "family-run since 1972" page reads differently than a "same-day emergency response" page. Don't flatten both into the same neutral copy.
- Avoid "premier," "world-class," "leading," "trusted," "expert" — every roofer on the internet uses these.
- Active voice. Specific nouns. Numbers and names beat adjectives.
- Customer quotes verbatim — never paraphrase or "improve" them.

═══ OUTPUT ═══
- Raw markdown — no code fence, no preamble, no closing remarks. Start with the H1, end with the last bullet of your last section.
- Do not announce the angle you chose. The angle should be felt, not stated.`;

export function buildPageBriefPrompt(
  masterBriefMarkdown: string,
  spec: PageSpec
): BuiltPageBriefPrompt {
  validateSpec(spec);
  const pageTitle = renderPageTitle(spec);
  const targetWords = lengthBudget(spec.type);
  const pageGuidance = perPageGuidance(spec);

  const lines: string[] = [];
  lines.push(`Generate the page brief for "${pageTitle}".`);
  lines.push('');
  lines.push(`Page spec:`);
  lines.push(`- type: ${spec.type}`);
  if (spec.service) lines.push(`- service: ${spec.service}`);
  if (spec.city) lines.push(`- city: ${spec.city}`);
  if (spec.customTitle) lines.push(`- custom title: ${spec.customTitle}`);
  lines.push(`- target length: ${targetWords} words`);
  lines.push('');
  if (pageGuidance) {
    lines.push(`Guidance specific to this page type:`);
    lines.push(pageGuidance);
    lines.push('');
  }
  lines.push(`## Master brief (source of truth)`);
  lines.push('');
  lines.push(
    masterBriefMarkdown.length > 18000
      ? masterBriefMarkdown.slice(0, 18000) + '\n…[truncated]'
      : masterBriefMarkdown
  );
  lines.push('');
  lines.push(
    `Now: pick the angle (internally, do not output it), then write the page brief shaped by that angle. Use the menu of sections — include what serves this page, skip what doesn't. Stay within the length budget. Keep all mechanical rules (URL slugs, meta-title format, phone display, no fabrication).`
  );

  return { system: SYSTEM_PROMPT, user: lines.join('\n') };
}

/** Per-page-type nudges. These guide section selection and angle choice without
 *  re-introducing a rigid template. */
function perPageGuidance(spec: PageSpec): string | null {
  switch (spec.type) {
    case 'homepage':
      return [
        '- The homepage is where the angle lands hardest. The hero headline should *be* the angle in plain words.',
        '- Include a customer-voice quote that exemplifies the angle.',
        '- List the top 3–5 services with one-line teasers; full detail belongs on the service pages.',
        '- End with a clear CTA matching the angle (e.g. emergency response → "Call now", craftsmanship → "See our work").',
      ].join('\n');
    case 'about':
      return [
        '- This is where founder/owner identity does the heaviest lifting. Use owner name(s), credentials, founded year, story details from the master brief.',
        '- Pick the angle that humanizes — usually a values or origin angle, not a service angle.',
        '- A short "what makes us different" beats a long generic story.',
      ].join('\n');
    case 'services_overview':
      return [
        '- Treat this as a router page. Brief one-paragraph intro establishing the angle, then a card-style list of every service with a teaser line.',
        '- Internal links to each child service page are essential here.',
      ].join('\n');
    case 'service':
      return [
        '- The angle for a service page is usually "how WE do this service differently" — drawn from review themes about this specific service.',
        '- Address what customers actually worry about for this service (look in the reviews for what they thanked the company for, or what they say went wrong elsewhere).',
        '- Link to every service-area page that covers this service. Phone above the fold.',
      ].join('\n');
    case 'service_area':
      return [
        '- Local proof is the angle here — a testimonial from a customer in or near this city is worth more than any other content.',
        '- Acknowledge the city specifically: neighborhoods served, common local conditions (weather, housing stock, codes) if the master brief supports it. Do NOT invent local detail.',
        '- Cross-link to the parent service page and to 1–2 nearby service-area pages.',
      ].join('\n');
    case 'contact':
      return [
        '- Light copy. The angle shows up in the response-time promise and what to expect on first contact.',
        '- Phone, email, hours, service-area summary, form. Skip "Customer Voice" unless a quote specifically reinforces the response promise.',
      ].join('\n');
    case 'faq':
      return [
        '- 6–10 questions max. Draw them from real customer concerns evident in the reviews (look for what reviewers say the company *cleared up* or *explained well*).',
        '- Skip generic questions ("Do you offer free estimates?") unless they have a non-generic answer for this business.',
      ].join('\n');
    case 'custom':
      return [
        '- The page spec gives only a title — infer the page\'s purpose from the title and the master brief, then pick an angle that serves it.',
      ].join('\n');
  }
}

function validateSpec(spec: PageSpec): void {
  if (spec.type === 'service' && !spec.service) {
    throw new Error("PageSpec.type='service' requires `service`");
  }
  if (spec.type === 'service_area' && (!spec.service || !spec.city)) {
    throw new Error("PageSpec.type='service_area' requires `service` and `city`");
  }
  if (spec.type === 'custom' && !spec.customTitle) {
    throw new Error("PageSpec.type='custom' requires `customTitle`");
  }
}

function renderPageTitle(spec: PageSpec): string {
  switch (spec.type) {
    case 'homepage': return 'Homepage';
    case 'about': return 'About';
    case 'services_overview': return 'Services Overview';
    case 'contact': return 'Contact';
    case 'faq': return 'FAQ';
    case 'service': return spec.service as string;
    case 'service_area': return `${spec.service} in ${spec.city}`;
    case 'custom': return spec.customTitle as string;
  }
}

function lengthBudget(type: PageType): string {
  switch (type) {
    case 'homepage': return '600–800';
    case 'about': return '400–600';
    case 'services_overview': return '400–600';
    case 'service': return '400–600';
    case 'service_area': return '300–500';
    case 'contact': return '250–400';
    case 'faq': return '250–400';
    case 'custom': return '300–500';
  }
}
