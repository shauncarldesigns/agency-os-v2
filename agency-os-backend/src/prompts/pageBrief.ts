/**
 * Per-page brief prompt.
 *
 * The master brief is the source of truth for the project. landingsite.ai can't
 * digest a 2,000-word master brief on its own — it needs a focused, ~250–800
 * word brief per page. This prompt feeds the master brief in as context and
 * asks Claude to write one tight, paste-ready brief for a single page.
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

const SYSTEM_PROMPT = `You are writing a single-page brief that will be pasted directly into landingsite.ai to build one specific page of the client's site. The master brief (provided in the user message) is the source of truth for the project — voice, services, areas, differentiators, testimonials. Your job is to extract what's relevant to THIS page and produce a focused, paste-ready brief.

LENGTH BUDGET
- Homepage: 600–800 words
- About / Services Overview: 400–600 words
- Service page: 400–600 words
- Service-area page: 300–500 words
- Contact / FAQ: 250–400 words
- Custom: 300–500 words

OUTPUT STRUCTURE (markdown, in this order)
1. \`# Page Brief: {Page Title}\`
2. \`## URL & SEO\` — URL slug, meta title, meta description (150–160 chars), H1
3. \`## Page Structure\` — sectioned outline of the page (Hero / Body sections / CTAs), with the headline copy and the key paragraphs the builder should produce. Be specific about what to write, not generic.
4. \`## Customer Voice\` — name the specific testimonial(s) from the master brief that should appear on this page, with the verbatim quote and attribution. Skip this section if no testimonial applies.
5. \`## Internal Links\` — exact pages this one should link to (use the URL slugs from the master brief's Site Structure).
6. \`## Build Notes\` — short imperatives for the builder (CTAs, schema markup, photo direction, phone-display behaviour, anything page-specific).

HARD RULES
- Pull only from the master brief. Do not invent new claims, certifications, owner names, hex colors, or facts.
- If the master brief has \`[TBD: <field>]\` tokens for fields you need, propagate them verbatim — do NOT fill them in, the operator will via the editor's inline fill.
- Brand voice and reading level (6th–8th grade) must match the master brief.
- For \`service-area\` pages: the H1 must include both the service and the city; the URL slug follows the master brief's \`/service-areas/<service>-<city>-<state>\` pattern; the meta title follows \`{Service} in {City}, {State} | {Business Name}\`.
- For \`service\` pages: link to every service-area child (use the master brief's enumeration); display the phone number from the master brief above the fold.
- Do not use "premier," "world-class," or "leading."
- Output raw markdown — no code fence, no preamble, no closing remarks. Start with the H1, end with the last Build Notes bullet.`;

export function buildPageBriefPrompt(
  masterBriefMarkdown: string,
  spec: PageSpec
): BuiltPageBriefPrompt {
  validateSpec(spec);
  const pageTitle = renderPageTitle(spec);
  const targetWords = lengthBudget(spec.type);

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
  lines.push(`## Master brief (source of truth)`);
  lines.push('');
  lines.push(
    masterBriefMarkdown.length > 18000
      ? masterBriefMarkdown.slice(0, 18000) + '\n…[truncated]'
      : masterBriefMarkdown
  );
  lines.push('');
  lines.push(
    `Now produce the page brief in the format defined in the system message. Stay within the length budget. If the page is a service or service-area page, use the URL slugs and meta-title format the master brief established.`
  );

  return { system: SYSTEM_PROMPT, user: lines.join('\n') };
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
