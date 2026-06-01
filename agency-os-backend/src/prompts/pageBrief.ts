/**
 * Per-page brief prompt.
 *
 * The master brief is the source of truth for the project. landingsite.ai
 * can't digest a 2,000-word master brief on its own — it needs a focused,
 * paste-ready brief per page. This prompt feeds the master brief in as
 * context and asks Claude to write one tight brief for a single page.
 *
 * DESIGN NOTE — the brief is a job description, not a wireframe.
 * Earlier versions of this prompt asked for "a sectioned outline of the page
 * with headline copy and the key paragraphs the builder should write." The
 * result: every site landed with the same skeleton — hero, trust strip, three
 * service cards, three differentiator blocks, closing CTA — because the brief
 * manufactured that skeleton every time. The builder was transcribing, not
 * designing.
 *
 * The current prompt stops dictating layout. It tells the builder what the
 * page is FOR, WHO lands on it, what SUBSTANCE must appear, and what to
 * EMPHASIZE — then gets out of the way. landingsite.ai decides sections,
 * order, headlines, photo treatment, CTA placement. Mechanical SEO bits
 * (URL slugs, meta titles, internal-link architecture) stay rigid because
 * the builder relies on them.
 *
 * If two service-area briefs for different businesses produce visibly
 * different sites — different section orders, different headlines, different
 * shapes — the prompt is working. If they produce the same skeleton with
 * different proper nouns, the prompt has regressed.
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

const SYSTEM_PROMPT = `You are writing a single-page brief that will be pasted directly into landingsite.ai to build one specific page of the client's site. The master brief (provided in the user message) is the source of truth for the project — voice, audience, services, areas, differentiators, testimonials, conversion goal.

Your job is NOT to design the page. landingsite.ai handles section choice, section order, headline writing, subhead writing, CTA placement, photo selection, form composition, and visual treatment. Your job is to give it everything it needs to make those decisions well — and then stop.

═══ WHAT YOU ARE WRITING ═══

This brief tells the builder:
- What this page is for and who lands on it
- The substance that has to appear — facts, claims, services, customer voice
- What to emphasize — the angle drawn from this specific business
- The hard constraints it cannot violate — SEO architecture, internal links, schema, phone reachability

This brief does NOT tell the builder:
- What sections to create or in what order
- What the headlines or subheadlines should say (you may state the H1 keyword *constraint* for SEO, but never write the H1 text itself)
- Where to place the CTA, the form, the phone, the photo
- How many cards, columns, blocks, or trust strips to use
- What color to make buttons or links
- Detailed photo art-direction (one sentence of *subject* guidance is fine; full art direction is not)

If your brief reads like a wireframe — "Section 1: Hero with H1 'X', subhead 'Y', primary CTA button…" — you have failed. Two briefs for two different businesses must produce visibly different sites, not the same skeleton with different proper nouns.

═══ STEP 1 — PICK THE ANGLE (INTERNAL, DO NOT OUTPUT) ═══

Before writing, read the master brief and pick the SINGLE strongest angle for THIS page. The angle is the lens drawn from THIS business's actual review themes, owner traits, customer language, audience profile, or differentiator — not generic positioning. Examples:
  - "Family-run since [year], every job touched by the owner"
  - "Same-day response when other shops ghost you"
  - "Straight pricing in an industry known for upsells"
  - "Specialists, not generalists — we do one thing"
  - "Old-school craft, modern materials"

The angle never appears as a section header or stated claim. It shapes which substance gets prime placement, which quote leads, what gets emphasized. Don't announce it.

═══ STEP 2 — WRITE THE BRIEF ═══

Required sections, in this order:

\`# Page Brief: {Page Title}\` — always.

\`## URL & SEO\` — always. Include:
  - URL slug
  - Meta title (must follow the master brief format for service-area pages)
  - Meta description (150–160 characters)
  - H1 constraint — state what the H1 *must contain* for SEO (e.g. "must include the service name and the city"). Do NOT write the H1 text itself. The builder writes the H1.

\`## Page Purpose\` — one tight paragraph. What this page exists to do, who lands on it (in their state of mind, drawn from the master brief's Target Audience), and the single conversion action they should be moved toward (from the master brief's Primary action). This is where the audience and the conversion goal land. Do not describe the page's structure here.

\`## What Must Appear\` — an unordered list of the substance this page has to carry: facts, claims, services, hard data (phone, hours, service area), specific differentiators, proofs. Each item is a *what*, not a *where*. The builder decides arrangement. Examples of good items vs bad items:
  - GOOD: "The company specializes in flat-roof and membrane systems, not shingles."
  - BAD: "Section 3: a paragraph explaining that the company specializes in flat-roof and membrane systems."
  - GOOD: "Phone (920) 743-9233 is the local Green Bay line, answered direct."
  - BAD: "Display the phone number in the header in #4da3ff."

\`## What to Emphasize\` — 1–3 items in priority order. These are the things that must land hardest on this page — drawn from the angle. The builder may have to leave material out for space; this tells it what can never be buried.

\`## Constraints\` — the hard rules the builder must not violate. One terse bullet each. Cover (as relevant): internal links by exact slug, phone reachability requirements, schema markup type, anything that must NOT appear (e.g. political imagery, stock shingle-house photos when the business does flat roofs), photo subject guidance (one short sentence — what's in the frame, not how it's lit or composed).

Optional section, include only if the page genuinely needs it:

\`## Customer Voice\` — verbatim quotes from the master brief to use on this page, with attribution. Skip if none apply. Do NOT direct where on the page the quote goes; just provide it.

You may add one additional, clearly-named section if the business genuinely needs it (e.g. \`## Financing\`, \`## License & Insurance\`, \`## After-Hours Coverage\`) and the master brief supports it. Do not invent a section that isn't grounded in the data.

═══ LENGTH BUDGET ═══
- Homepage: 400–600 words
- About / Services Overview: 300–500 words
- Service page: 300–500 words
- Service-area page: 250–400 words
- Contact / FAQ: 200–350 words
- Custom: 250–450 words

These are shorter than older versions of this prompt because briefs no longer wireframe layouts. If yours is running long, you're probably drifting into section-by-section dictation.

═══ MECHANICAL RULES (rigid — the builder relies on them) ═══
- Service-area pages: meta title follows \`{Service} in {City}, {State} | {Business Name}\`. URL slug follows the master brief's \`/service-areas/<service>-<city>-<state>\` pattern. The H1 *constraint* must require both the service name and the city.
- Service pages: list every child service-area page slug in Constraints under internal links. The phone-reachability requirement is a constraint — phrase it as "phone must be reachable above the fold," not as a hero-layout instruction.
- Meta descriptions: 150–160 characters.
- Pull only from the master brief. Do not invent claims, certifications, owner names, hex colors, founded years, or local facts.
- If the master brief carries \`[TBD: <field>]\` tokens for fields you'd need, propagate them verbatim — do NOT fill them in.

═══ VOICE OF THIS BRIEF ═══
- The brief is written for the builder, not the end customer. Write like a creative director handing a job to a smart colleague: direct, confident, specific. No marketing copy.
- The master brief's Brand Voice tells you what voice the BUILT page should adopt. Surface that in Page Purpose if useful, but do NOT write the page's marketing copy in your brief.
- Customer quotes verbatim — never paraphrase or "improve" them.

═══ OUTPUT ═══
- Raw markdown. No code fence. No preamble. No closing remarks. Start with the H1, end with the last bullet of your last section.
- Do not announce the angle.
- Omit optional sections you don't have substance for. Do not pad.`;

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
    `Now: pick the angle internally. Then write the brief as the page's job description — what this page exists to do, who lands on it, what substance must appear, and what to emphasize. Do NOT outline sections, write headlines, or dictate layout. landingsite.ai makes those choices. Keep all mechanical rules (URL slugs, meta-title format, internal links, no fabrication).`
  );

  return { system: SYSTEM_PROMPT, user: lines.join('\n') };
}

/** Per-page-type nudges. These shape angle choice and substance emphasis
 *  WITHOUT re-introducing layout dictation. None of these tell the builder
 *  what sections to make. */
function perPageGuidance(spec: PageSpec): string | null {
  switch (spec.type) {
    case 'homepage':
      return [
        '- The angle should be unmistakable to a visitor within seconds of arrival. It is the entry point to the brand.',
        '- Surface a customer-voice quote that exemplifies the angle, if one exists.',
        '- The top services should be reachable at a teaser/summary level; full detail belongs on the service pages. Leave the format (cards, list, paragraph, links) to the builder.',
        '- The conversion goal from the master brief is the primary action this page exists to drive — name it explicitly in Page Purpose. Where and how it appears on the page is the builder\'s call.',
      ].join('\n');
    case 'about':
      return [
        '- This page is where founder/owner identity does the heaviest lifting. Use owner name(s), credentials, founded year, story details — only those grounded in the master brief.',
        '- Pick the angle that humanizes: usually a values, origin, or craft angle rather than a service angle.',
        '- A concrete "what makes us different" beats a long generic story. Specifics over adjectives.',
      ].join('\n');
    case 'services_overview':
      return [
        '- This page\'s job is to route visitors to the right service page. Ensure every service is represented with enough teaser substance for a visitor to know which one applies to them.',
        '- The angle establishes why this business is the one to call for any of these services — surface it in Page Purpose, not as a section.',
        '- Internal links to each child service page belong in Constraints.',
      ].join('\n');
    case 'service':
      return [
        '- The angle for a service page is usually "how WE do this service differently" — drawn from review themes about this specific service.',
        '- Address what customers actually worry about for this service — look in the reviews for what they thanked the company for, or what they say went wrong elsewhere.',
        '- Every service-area child page slug belongs in Constraints under internal links. Phone reachability above the fold is a Constraint, not a layout instruction.',
      ].join('\n');
    case 'service_area':
      return [
        '- Local proof is the angle here. A testimonial from a customer in or near this city is worth more than any other substance on the page — surface it in Customer Voice if available.',
        '- Acknowledge the city specifically: neighborhoods served, common local conditions (weather, housing stock, codes) IF the master brief supports it. Do NOT invent local detail.',
        '- Internal links: cross-link to the parent service page and to 1–2 nearby service-area pages. These belong in Constraints.',
      ].join('\n');
    case 'contact':
      return [
        '- Light page. The angle shows up in the response-time promise and what to expect on first contact.',
        '- Phone, email, hours, service-area summary, and a way to reach out in writing must all be available. Omit Customer Voice unless a quote specifically reinforces the response-time or first-contact promise.',
      ].join('\n');
    case 'faq':
      return [
        '- 6–10 questions max. Draw them from real customer concerns evident in the reviews — what reviewers say the company *cleared up* or *explained well*.',
        '- Skip generic questions ("Do you offer free estimates?") unless the business has a non-generic answer for them.',
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
    case 'homepage': return '400–600';
    case 'about': return '300–500';
    case 'services_overview': return '300–500';
    case 'service': return '300–500';
    case 'service_area': return '250–400';
    case 'contact': return '200–350';
    case 'faq': return '200–350';
    case 'custom': return '250–450';
  }
}
