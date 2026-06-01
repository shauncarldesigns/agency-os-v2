/**
 * Per-page brief prompt — letter form, content-first.
 *
 * EVOLUTION
 *
 * v1 (original): the brief was a wireframe. Numbered sections, literal H1
 *   text, CTA button copy, photo art-direction. Result: every site landed
 *   with the same skeleton because the brief manufactured it.
 *
 * v2 (PR #19): the brief became a job description — Page Purpose / What
 *   Must Appear / What to Emphasize / Constraints. Sites were structurally
 *   varied, but the copy inside the sections came out as platform-default
 *   adjective soup ("premier", "trusted", "passionate") because the
 *   builder was synthesizing it with nothing to lift.
 *
 * v3 (this): the brief is a creative-director memo. Two halves:
 *
 *   1) An SEO block at the top — structured, literal key/value fields the
 *      builder uses as the <title>, meta description, H1, slug, schema,
 *      internal links. No prose, no negotiation.
 *
 *   2) A prose letter below — matter-of-fact, agency-to-builder. The
 *      letter describes who the business is, who lands on the page, what
 *      the page must communicate, in what words, and what NOT to say.
 *      Strong headline and subhead suggestions are quoted inline ("the
 *      subhead should say 'Kyle answers the phone'"). Customer quotes are
 *      verbatim with attribution. Anti-fluff word list is included so the
 *      builder enforces it on anything it has to generate around the
 *      copy we've supplied.
 *
 * Critically: no section labels in the letter. Don't write "## Hero" or
 * "## Trust strip". The builder picks layout, sections, photos, CTA
 * placement, visual treatment. The brief gives it the WORDS.
 */

export type PageType =
  | 'homepage'
  | 'about'
  | 'services_overview'
  | 'service_areas_overview'
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

const BANNED_WORDS = [
  'premier', 'leading', 'trusted', 'world-class', 'top-rated', 'top-tier',
  'best-in-class', 'unmatched', 'unparalleled', 'industry-leading',
  'passionate', 'dedicated', 'committed', 'devoted',
  'your one-stop', 'your trusted partner', 'state-of-the-art',
  'cutting-edge', 'innovative solutions', 'tailored solutions',
];

const SYSTEM_PROMPT = `You are writing a brief that landingsite.ai (an AI page builder) reads to build one page of a small-business website. The master brief (provided in the user message) is the source of truth for the project — voice, audience, services, areas, differentiators, testimonials, conversion goal.

Your output has two parts:

═══ PART 1 — SEO BLOCK (structured, literal) ═══

A small set of labelled fields the builder uses as actual data — \`<title>\`, meta description, H1, URL slug, schema type, internal links. Format:

\`# Page Brief: {Page Title}\`

\`## SEO\`
- URL: \`{slug}\`
- Meta title: \`{literal text, max ~60 chars including brand}\`
- Meta description: \`{literal text, 150–160 characters}\`
- H1: \`{literal text}\`
- Primary keyword: \`{the keyword phrase}\`
- Schema: \`{LocalBusiness | Service | FAQPage | …}\`
- Internal links: \`{comma-separated slugs the page must link to}\`

These are LITERAL. The builder reads them as data, not suggestions. The meta description must hit 150–160 characters. The H1 must contain the SEO target (for service-area pages, both the service name and the city).

Then a horizontal rule (\`---\`) and the letter starts.

═══ PART 2 — THE LETTER (prose, no section labels) ═══

A creative-director memo from the agency to the builder. Roughly the length budget specified in the user message. No headers inside the letter — no \`##\` or \`###\`, no \`Hero:\` / \`Trust strip:\` / \`Services:\` labels. Continuous prose with paragraph breaks where natural. Voice is matter-of-fact and confident — you're a senior account person briefing a writer, not a marketing intern hyping a brand.

What the letter does:

- **Opens with the page's job in one or two sentences.** Who this page exists for, what they're trying to figure out, what they should do after reading it. Drawn from the master brief's Target Audience.

- **Names the angle directly.** The single strongest thing this business has — drawn from the master brief's review themes, owner identity, differentiators, or testimonials. Examples: "Kyle answers his own phone." "Same-day response when other shops ghost." "Specialists, not generalists." Pick ONE angle for this page and lead with it.

- **Supplies headline and subhead suggestions inline, as quoted phrases.** Not as labelled fields. Write something like: *"The headline should communicate the owner-operated angle directly — something like 'Owner-operated plumbing in Greenleaf, WI'. The subhead should make it human — 'Kyle answers the phone. Kyle shows up. No estimating fees, no upsells.' Those are the words to use."* The builder may lightly adjust phrasing but won't write its own headline from scratch — your suggestions land as the headline.

- **Surfaces specific facts.** Years in trade, owner name, license numbers, certifications, named differentiators. Pull these from the master brief verbatim. If the master brief has \`[TBD: founded year]\`, propagate the TBD — never fabricate.

- **Uses customer quotes verbatim with attribution.** When the master brief has a strong quote, embed it inline in the letter as a blockquote with attribution. Example:
  > "Same-day response when other shops ghosted me for three days." — Cearron Quella, Green Bay

  Don't summarise customer reviews. Use their words. Choose the ONE strongest quote for this page (two max).

- **Names the conversion action and where the phone (or form) must be reachable.** From the master brief's Primary action. Phone above the fold is a constraint, not a layout instruction — phrase it as "the number is X and must be reachable from anywhere on the page."

- **Says what NOT to say.** Include the anti-fluff list (below) as a paragraph in the letter so the builder enforces it on anything it generates around your copy.

What the letter does NOT do:

- **No section headers inside the letter body.** No \`## Hero\`, no \`### Services\`, no bulleted "what the page needs" lists, no "Section 1:". Just prose.
- **No layout instructions.** Don't tell the builder cards-vs-list, columns, sticky-headers, photo placement, button colors, sticky nav. Don't write "Display X in the header" or "Place CTA below the hero." Those are the builder's choices.
- **No invented facts.** Pull from the master brief only. \`[TBD: ...]\` tokens propagate verbatim.
- **No empty hedging.** "This is an important page" / "users will find value here" — cut it. Every sentence should carry a specific fact, a specific phrase, or a specific instruction.

═══ ANTI-FLUFF (mandatory, must appear in the letter) ═══

The brief must include a paragraph telling the builder not to use platform-default adjectives. These words signal generic AI marketing copy and must not appear anywhere in the page — not in headlines, body, alt text, button labels, or chrome the builder generates around your supplied copy:

${BANNED_WORDS.map((w) => `- ${w}`).join('\n')}

Also avoid "family-owned-and-operated" as a tagline (it's a fact, not a value proposition), and avoid framing the business as a "provider of" (e.g. "premier provider of plumbing services" — say what they actually do).

═══ MECHANICAL RULES (rigid — the builder relies on them) ═══

- Service-area pages: meta title follows \`{Service} in {City}, {State} | {Business Name}\`. URL slug follows the master brief's \`/service-areas/<service>-<city>-<state>\` pattern. H1 must contain both the service name and the city.
- Service pages: list every child service-area page slug in the SEO \`Internal links\` field. Phone reachability is a constraint stated in the letter, not a header.
- Meta descriptions: 150–160 characters. Count them.
- Pull only from the master brief. Do not invent claims, certifications, owner names, hex colors, founded years, or local facts.
- If the master brief carries \`[TBD: <field>]\` tokens for fields you'd need, propagate them verbatim — do NOT fill them in.
- The word "Merchynt" must not appear. The brief is white-labeled.

═══ OUTPUT ═══

- Raw markdown. No code fence. No preamble. No closing remarks. Start with \`# Page Brief:\` and end with the final sentence of the letter.
- The SEO block is structured fields. The letter is continuous prose. Never confuse the two.
- Do not announce the angle. Do not label "the angle is X" — let the letter's lead make it obvious.
- Stay within the length budget specified in the user message. If you're running long, you're probably padding.`;

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
  lines.push(`- target letter length: ${targetWords} words (SEO block is in addition; don't count it)`);
  lines.push('');
  if (pageGuidance) {
    lines.push(`Guidance specific to this page type — informs the angle, not the layout:`);
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
    `Now: pick the angle from this business's actual review themes / owner identity / differentiators, write the SEO block with literal fields, then write the letter as continuous prose with the headline and subhead suggestions quoted inline. Include the anti-fluff paragraph. No section headers inside the letter.`
  );

  return { system: SYSTEM_PROMPT, user: lines.join('\n') };
}

/**
 * Per-page-type angle nudges. These shape WHICH angle to lead with —
 * they do not reintroduce layout dictation. None of these tell the
 * builder what sections to make.
 */
function perPageGuidance(spec: PageSpec): string | null {
  switch (spec.type) {
    case 'homepage':
      return [
        '- This is the entry point to the brand. The angle has to land in the first three seconds — the headline and subhead suggestions you supply are the most important sentences in the letter. Pick the single strongest angle from the master brief (owner identity, response-time promise, specialism, honest pricing — whichever is most strongly supported by reviews) and lead with it.',
        '- Surface the top services by name (just the names + a 1-line each of what they do, pulled from the master brief). Don\'t go deep on any one service — that\'s the service page\'s job.',
        '- Use the strongest customer quote — the one that most directly proves the angle — verbatim, with attribution.',
        '- The conversion goal from the master brief is the primary action this page exists to drive. Name it explicitly. State the phone number once in the SEO block (if applicable) and once in the letter; leave placement to the builder.',
      ].join('\n');
    case 'about':
      return [
        '- This is where founder/owner identity does the heaviest lifting. Use the owner name, credentials, founded year, story details — only those grounded in the master brief.',
        '- Matter-of-fact tone — "Owner-operated since 2008. Kyle Halverson, Master Plumber, WI License #234567." Not "Our passionate team has been dedicated to…".',
        '- A concrete "what makes us different" beats a long generic story. Specifics over adjectives.',
        '- A customer quote that speaks to who-they-are (not what-they-do) lands well here, if available.',
      ].join('\n');
    case 'services_overview':
      return [
        '- This is the Services hub page. Its job is to route visitors to the right individual service page, and to communicate why this business is the one to call across the full range of services. Let the headline suggestion communicate that umbrella angle.',
        '- Every service from the master brief is represented by name with a 1–2 sentence teaser drawn from review themes about that specific service. Internal links to each child service page must be listed in the SEO block.',
        '- Don\'t go deep on any single service. That\'s the service page\'s job.',
        '- URL slug is `/services` (single tier, not `/services-overview`).',
      ].join('\n');
    case 'service_areas_overview':
      return [
        '- This is the Service Areas hub page — a site-wide page that lists every city the business serves and links out to each city-specific page. Its primary job is SEO: a single hub that consolidates link equity for the long-tail service-area pages.',
        '- The letter should briefly say WHERE the business is based (HQ city) and WHO it serves (every service area, named). Mention the home metro region by name if the master brief uses one (e.g. "Northeast Wisconsin").',
        '- Every service area from the master brief is mentioned by city name in the letter. The SEO block\'s `Internal links` field must list every `/service-areas/{service}-{city}-{state}` slug that exists for this project (services × cities — assume all combinations).',
        '- Don\'t go deep on any single city. That\'s the per-city service-area page\'s job. The hub is short and link-dense — keep the letter at the lower end of the length budget.',
        '- URL slug is `/service-areas` (single tier, not `/service-areas-overview`).',
        '- A customer quote that mentions a specific city is great if available, but skip if not — don\'t force one.',
      ].join('\n');
    case 'service':
      return [
        '- The angle is usually "how WE do this service differently" — drawn from review themes about this specific service. Lead with it in the letter.',
        '- Address what customers actually worry about for this service. Look in the master brief reviews for what reviewers thanked the company for, or what they say went wrong elsewhere — that\'s the worry to defuse.',
        '- A customer quote about THIS service (or about this kind of work) is gold. Use it verbatim if available.',
        '- Internal links to every child service-area page slug must be in the SEO block. Phone reachability is a constraint stated in the letter.',
      ].join('\n');
    case 'service_area':
      return [
        '- Local proof is the angle. A testimonial from a customer in or near this city is worth more than any other content on the page — surface it verbatim with attribution if the master brief has one.',
        '- Acknowledge the city specifically: neighborhoods, common local conditions (weather, housing stock, codes) — but ONLY if the master brief supports it. Do not invent local detail.',
        '- The SEO block\'s H1 must contain the service name and the city. The meta title follows the standard service-area pattern.',
        '- Internal links: cross-link to the parent service page and to 1–2 nearby service-area pages. These belong in the SEO block.',
      ].join('\n');
    case 'contact':
      return [
        '- Light page. The angle shows up in the response-time promise and what to expect on first contact.',
        '- The letter should state phone, email, hours, service-area summary, and a way to reach out in writing. Leave layout (block order, form vs phone primacy) to the builder.',
        '- Skip a customer quote unless one specifically reinforces the response-time or first-contact promise.',
      ].join('\n');
    case 'faq':
      return [
        '- Provide 6–10 questions in the letter as a numbered list (the letter\'s ONE allowed structured element — questions need to be discrete). Each question gets a 1–2 sentence answer.',
        '- Draw the questions from real customer concerns evident in the reviews — what reviewers said the company *cleared up* or *explained well*. Skip generic questions ("Do you offer free estimates?") unless the business has a non-generic answer.',
      ].join('\n');
    case 'custom':
      return [
        '- The page spec gives only a title — infer the purpose from the title and the master brief, then pick an angle that serves it.',
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
    case 'services_overview': return 'Services';
    case 'service_areas_overview': return 'Service Areas';
    case 'contact': return 'Contact';
    case 'faq': return 'FAQ';
    case 'service': return spec.service as string;
    case 'service_area': return `${spec.service} in ${spec.city}`;
    case 'custom': return spec.customTitle as string;
  }
}

/** Letter-body word budget. The SEO block is in addition; don't count it. */
function lengthBudget(type: PageType): string {
  switch (type) {
    case 'homepage': return '400–600';
    case 'about': return '350–500';
    case 'services_overview': return '350–500';
    case 'service_areas_overview': return '250–400';
    case 'service': return '300–450';
    case 'service_area': return '250–400';
    case 'contact': return '200–350';
    case 'faq': return '250–400';
    case 'custom': return '250–400';
  }
}
