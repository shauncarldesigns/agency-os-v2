import type { GoogleReview } from '../services/places';
import type { MinedReviewData } from '../services/reviewMiner';

export interface BrandAttribute {
  category:
    | 'tagline'
    | 'certification'
    | 'review_theme'
    | 'photography_direction'
    | 'positioning'
    | 'differentiator'
    | 'value'
    | 'other';
  value: string;
  source?: 'scrape' | 'reviews' | 'operator' | 'claude' | null;
}

export interface Testimonial {
  author_name: string;
  author_location?: string | null;
  quote: string;
  rating?: number | null;
  source?: 'google' | 'operator' | 'website' | 'other' | null;
  is_featured?: boolean;
}

export interface MasterBriefProject {
  business_name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  founded_year: number | null;
  owner_name: string | null;
  owner_credentials: string | null;
  tagline: string | null;
  primary_color: string | null;
  accent_color: string | null;
  photography_direction: string | null;
  monthly_pages_target?: number | null;
  tier?: string | null;
}

export interface MasterBriefInput {
  project: MasterBriefProject;
  mined: MinedReviewData;
  reviews: GoogleReview[];
  brand_attributes: BrandAttribute[];
  testimonials: Testimonial[];
  scrape_data: string | null;
}

export interface BuiltMasterBriefPrompt {
  system: string;
  user: string;
}

const APEX_FORMAT_EXAMPLE = `# Site Brief: {Business Name}

## Business Overview
**Business Name:** ...
**Location:** {city, state}
**Phone:** ...
**Email:** ...
**Years in Business:** ... ({founded year})
**Description:** {2-3 sentence summary}
**Owner:** {name, credentials}

## Target Audience
**Primary customer:** {who actually hires this business — 1-2 real segments drawn from the reviews and services, e.g. "homeowners with flat or low-slope roofs" and "commercial property managers." Do not list every conceivable customer.}
**What brings them here:** {the triggering problem or job — what just happened that made them go looking}
**What they worry about:** {the hesitation, fear, or bad past experience this business has to overcome — pulled from the language customers actually use in reviews}
**Why they choose this business:** {the deciding factor in the customers' own terms, from review themes}
**Primary action the site should drive:** {the single conversion goal — call, form submission, or quote request}

## Brand Voice
- {3-6 voice descriptors}
- Reading level: 6th-8th grade
- {audience target}
- {sentence/voice style}
- {tone notes}

## Brand Style
- **Primary color:** {hex}
- **Accent color:** {hex}
- **Vibe:** {short description}

## Services Offered
1. **{Service}** — {description}
2. ...

## Service Areas ({region})
- {City 1} (HQ)
- {City 2}
- ...

## Key Differentiators
- {differentiator 1}
- ...

## Customer Reviews to Reference
**{Author Name}, {Location}** ({rating} stars):
"{quote}"
...

## Site Structure Required
{numbered list of pages — homepage, about, services overview, individual service pages, service-area pages with all combinations, insurance/lead-gen pages, contact, FAQ}

## SEO Requirements
- Unique meta title and description per page
- Title format for service-area pages: "{Service} in {City}, {State} | {Business Name}"
- Meta descriptions: 150-160 characters
- Internal linking rules
- Schema markup requirements

## Important Build Instructions
{numbered list of final nudges to the site builder}`;

const FULL_SITE_SECTIONS = `Business Overview, Target Audience, Brand Voice, Brand Style, Services Offered, Service Areas, Key Differentiators, Customer Reviews to Reference, Site Structure Required, SEO Requirements, Important Build Instructions`;

export function buildMasterBriefPrompt(input: MasterBriefInput): BuiltMasterBriefPrompt {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(input);
  return { system, user };
}

function buildSystemPrompt(): string {
  const sections = FULL_SITE_SECTIONS;

  return `You are writing the master site brief for a local-service web design agency. It is the source of truth for the project — every per-page brief is derived from it. The format below is the proven template — match it exactly.

OUTPUT FORMAT — produce a markdown document with exactly these sections, in this order:
${sections}

Reference template (structure to mirror; placeholders in {curly braces} show what content belongs where, not the literal text to output):

${APEX_FORMAT_EXAMPLE}

HARD RULES:
1. Use ONLY the data provided in the user message. Do not invent founded years, certifications, owner names, hex colors, or any other specific fact. Where a specific field is missing, emit a labelled TBD token so the operator can fill it inline later — use \`[TBD: <field name>]\`. Examples: \`[TBD: founded year]\`, \`[TBD: owner credentials]\`, \`[TBD: tagline]\`, \`[TBD: email]\`, \`[TBD: primary color]\`, \`[TBD: accent color]\`. One TBD token per missing field, kept short and lowercase. Never fabricate.
2. Synthesize brand voice from review themes — voice descriptors should come from the actual language customers use about this business, not generic adjectives.
3. Reading level for the resulting site copy must be 6th-8th grade. State this in the Brand Voice section.
4. Customer reviews must be quoted verbatim. Do not paraphrase or "improve" them. Cite author name and location exactly as given.
5. Service-area page URLs follow this pattern: \`/service-areas/{service-slug}-{city-slug}-{state-lower}\`. Service page URLs follow: \`/services/{service-slug}\`.
6. Service-area page meta titles follow: \`{Service} in {City}, {State} | {Business Name}\`. Meta descriptions are 150-160 characters.
7. The word "Merchynt" must not appear anywhere in the output. This is white-labeled.
8. Do not include any preamble, commentary, or closing remarks outside the brief itself. Start with the H1 \`# Site Brief: {Business Name}\` and end with the last bullet of Build Instructions.
9. Do not wrap the output in a markdown code fence. Output raw markdown.
10. Active voice. Zero fluff. No filler adjectives like "premier," "world-class," "leading."

QUALITY BAR:
- Target Audience must be synthesized from the reviews, services performed, and strengths — the actual people hiring this business, not a generic "homeowners and businesses." Name 1-2 real segments, the problem that brings them, and what they worry about, using the language customers use in the reviews. If a brand attribute explicitly names the audience (operator-supplied), prefer it over inference. Do not invent demographics the data doesn't support.
- Primary action the site should drive: state exactly ONE conversion goal (call, form submission, or quote request). This is the most important line in the Target Audience section — every page downstream should point at this action. If it genuinely can't be inferred from the data, emit \`[TBD: primary conversion goal]\`.
- Services Offered descriptions should be one tight sentence each, grounded in what reviews mention the business actually does.
- Key Differentiators should be 3-6 items, each a concrete claim (a certification, a years-in-trade number, a specific guarantee, a named owner trait) — not vague positioning.
- Site Structure should enumerate every page. For full_site, that means listing every service-area page combination explicitly (e.g., "Roof Replacement in Madison", "Roof Replacement in Sun Prairie", etc.) so the builder doesn't have to guess.
- Build Instructions are direct imperatives to the site builder: "Use the customer quote from {Author} on the homepage hero." "Link every service-area page back to the parent service page."`;
}

function buildUserPrompt(input: MasterBriefInput): string {
  const p = input.project;
  const lines: string[] = [];

  lines.push(`Generate the master brief for the following business.`);
  lines.push('');
  lines.push('## Project data');
  lines.push(`- Business name: ${p.business_name}`);
  lines.push(`- City/State: ${p.city ?? '[missing]'}, ${p.state ?? '[missing]'}`);
  lines.push(`- Phone: ${p.phone ?? '[missing]'}`);
  lines.push(`- Email: ${p.email ?? '[missing]'}`);
  lines.push(`- Website: ${p.website ?? '[missing]'}`);
  lines.push(`- Founded year: ${p.founded_year ?? '[missing]'}`);
  lines.push(`- Owner name: ${p.owner_name ?? '[missing]'}`);
  lines.push(`- Owner credentials: ${p.owner_credentials ?? '[missing]'}`);
  lines.push(`- Tagline: ${p.tagline ?? '[missing]'}`);
  lines.push(`- Primary color: ${p.primary_color ?? '[missing]'}`);
  lines.push(`- Accent color: ${p.accent_color ?? '[missing]'}`);
  if (p.tier) lines.push(`- Tier: ${p.tier}`);
  if (p.monthly_pages_target) lines.push(`- Monthly pages target: ${p.monthly_pages_target}`);
  lines.push('');

  lines.push('## Mined review data');
  lines.push(`- Services performed (from reviews): ${listOrEmpty(input.mined.services_performed)}`);
  lines.push(`- Service areas (from reviews): ${listOrEmpty(input.mined.service_areas)}`);
  lines.push(`- Owner names mentioned in reviews: ${listOrEmpty(input.mined.owner_names)}`);
  lines.push(`- Strengths (themes): ${listOrEmpty(input.mined.strengths)}`);
  if (input.mined.pitch_quotes.length) {
    lines.push('- Mined pitch quotes:');
    for (const pq of input.mined.pitch_quotes) {
      lines.push(`  - "${pq.quote}" — ${pq.author}${pq.location ? `, ${pq.location}` : ''} (${pq.why})`);
    }
  }
  lines.push('');

  lines.push('## Raw Google reviews');
  if (input.reviews.length === 0) {
    lines.push('(none)');
  } else {
    for (const r of input.reviews) {
      lines.push(`- ${r.author} (${r.rating}★, ${r.relativeTime}): "${r.text.replace(/\s+/g, ' ').trim()}"`);
    }
  }
  lines.push('');

  lines.push('## Brand attributes (operator/scrape/claude-supplied)');
  if (input.brand_attributes.length === 0) {
    lines.push('(none)');
  } else {
    for (const ba of input.brand_attributes) {
      lines.push(`- [${ba.category}${ba.source ? `, source=${ba.source}` : ''}] ${ba.value}`);
    }
  }
  lines.push('');

  lines.push('## Curated testimonials');
  if (input.testimonials.length === 0) {
    lines.push('(none — use Raw Google reviews for the Customer Reviews section)');
  } else {
    for (const t of input.testimonials) {
      const featured = t.is_featured ? ' [FEATURED]' : '';
      const rating = t.rating ? `${t.rating}★` : 'no rating';
      const loc = t.author_location ? `, ${t.author_location}` : '';
      lines.push(`- ${t.author_name}${loc} (${rating}, source=${t.source ?? 'unknown'})${featured}: "${t.quote}"`);
    }
  }
  lines.push('');

  lines.push('## Website scrape data');
  if (input.scrape_data) {
    lines.push('```');
    lines.push(input.scrape_data.length > 8000 ? input.scrape_data.slice(0, 8000) + '\n…[truncated]' : input.scrape_data);
    lines.push('```');
  } else {
    lines.push('(none — no website scraped for this project)');
  }
  lines.push('');

  lines.push('## Now produce the brief');
  lines.push('Output the full master brief with every section. Enumerate every service-area page (service × city) combination in Site Structure.');

  return lines.join('\n');
}

function listOrEmpty(arr: string[]): string {
  if (!arr || arr.length === 0) return '[none]';
  return arr.join(', ');
}
