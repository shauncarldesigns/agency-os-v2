// Pipeline brief prompt — generates a landingsite.ai-ready brief for a
// pre-qualification demo homepage.
//
// Distinct from `masterBrief.ts`, which is per-PROJECT (post-qualification,
// with operator-curated services/service_areas). This prompt runs
// per-LEAD, using only what enrichment has already discovered — no
// operator input yet, no project object. The output is a compact,
// structured brief the operator drops straight into landingsite to
// generate a single homepage for the outreach text.
//
// Output shape mirrors mockups/LeadPipelinePage.jsx's sample brief:
// Business overview → Target audience → Page purpose → What must
// appear → What to emphasize → Constraints. Section headers stay
// intact because landingsite consumes this as prompt input; letter
// form is reserved for master/page briefs where prose matters.

export interface PipelineBriefInput {
  lead_id: number; // seeds the assigned design direction — stable per lead
  company: string;
  industry: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  hours: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  extracted_services: string | null;        // JSON array string; may be null
  extracted_service_areas: string | null;   // JSON array string — mined towns
  extracted_strengths: string | null;       // JSON array string
  extracted_local_landmarks: string | null; // JSON array string
  pitch_quotes: string | null;              // JSON array of { text, author? }
  owner_names: string | null;
  opportunity_reasoning: string | null;     // why this lead scored well
}

export interface BuiltPipelineBriefPrompt {
  system: string;
  user: string;
}

// The anti-fluff word list is the same one enforced on master briefs
// (see CLAUDE.md brief-evolution notes) — kept in sync so both flows
// produce copy in the same voice.
const BANNED_WORDS = [
  'premier',
  'trusted',
  'leading',
  'passionate',
  'seamless',
  'elevate',
  'unlock',
  'unparalleled',
  'unmatched',
  'best-in-class',
  'cutting-edge',
  'state-of-the-art',
  'world-class',
  'dedicated',
];

// ---------------------------------------------------------------------------
// Design direction assignment.
//
// Landingsite's wrapper prompt tells the builder to "choose a restrained,
// professional visual direction appropriate for the industry" when no
// branding is supplied — which converges on the same navy-blue template for
// every lead. It also says "use the supplied business branding when
// available": that's the hook. We assign each lead a concrete direction
// (palette, typography, hero layout, one signature element) IN CODE, seeded
// by lead id — asking the model to "pick a unique look" converges the same
// way the pre-angle-led master briefs did (see CLAUDE.md brief evolution).
// Seeding by id keeps a lead's look stable across regenerates while
// neighbouring leads land on different combinations.

const PALETTES = [
  'Deep forest green (#1B4332) with aged-brass accents (#B08D57) on warm off-white (#FAF7F2) — grounded, premium, outdoorsy',
  'Charcoal (#23262B) with safety orange (#E8590C) on light gray (#F4F5F6) — bold, industrial, job-site energy',
  'Midnight navy (#14213D) with warm amber (#FCA311) on soft white (#F8F9FA) — classic, established',
  'Slate blue (#3D5A80) with copper (#C46F33) on cream (#FBF6EF) — steady, craftsman',
  'Dark teal (#134E4A) with sun yellow (#FACC15) on white — fresh but workmanlike',
  'Graphite (#2B2D31) with steel blue (#5C8DB8) and a single red accent (#C0392B) — no-nonsense, technical',
  'Espresso brown (#3E2C23) with burnt orange (#CC5500) on cream (#FFF8F0) — warm, family-business',
  'Deep burgundy (#5C1A2B) with tan leather tones (#C9A66B) on off-white — heritage, old-school trade pride',
  'Ink black (#181818) with construction yellow (#F5B301) — heavy-equipment confidence',
  'Gunmetal (#39424E) with muted aqua (#2A9D8F) and sand (#E9C46A) — modern industrial',
];

const TYPOGRAPHY = [
  'Heavy geometric sans headlines with a clean humanist sans body — modern shop-front',
  'Slab-serif headlines with a neutral sans body — hardworking Americana',
  'Condensed all-caps sans headlines with a roomy regular-case body — highway-signage clarity',
  'Classic serif headlines with a plain sans body — established, editorial',
  'Sturdy rounded sans throughout — approachable, family-run',
  'High-contrast modern sans with tight headline tracking — crisp, current',
];

const HERO_LAYOUTS = [
  'Full-bleed photo with a dark gradient overlay, copy and CTA left-aligned',
  'Split hero: headline and proof points left, a quote-request card right',
  'Solid brand-color hero with an oversized centered headline, photo band directly below',
  'Light hero: copy left, photo right, review stars directly under the CTA',
  "Dark hero on the palette's darkest tone, oversized headline, phone number as the dominant CTA",
];

const SIGNATURE_ELEMENTS = [
  'A stats band with oversized numerals (rating, review count, services offered)',
  'A review-highlight strip of one-line quotes with first names, distinct from the main reviews section',
  'A map-first service-area section with the towns called out as chips or pins',
  "A short owner's-note block styled like a signed letter (only if owner names are on file — otherwise a plain about block)",
  'Alternating section background tints so the scroll never feels like one long white page',
  'Badge-style iconography for each service with a consistent stroke weight',
  'An oversized section-numbering motif (01, 02, 03) running down the page',
  'A call-to-done process strip: how a job goes from first call to finished work',
];

// Headline angles — the copy-side counterpart to design directions.
// Landingsite, left to write its own hero, converges on the same
// trust-cliché formulas ("Honest HVAC Services You Can Trust", "Fair
// Prices, Real People") for every site. The brief therefore authors the
// hero copy itself, and variance across leads is manufactured by
// assigning each lead one of these angles — same reasoning as the
// angle-led master briefs. Each angle degrades gracefully: if its data
// isn't on file, the model keeps the angle's spirit and builds from
// what is.
const HEADLINE_ANGLES = [
  'Plain-spoken service catalog: lead with the two or three highest-value services and the town — the headline a customer would literally search for.',
  'Customer-voice: build the hero around a short verbatim phrase customers actually use in the reviews (quoted or woven in), anchored to service + town.',
  'Numbers-led: lead with the concrete reputation numbers on file — rating, review count — plus service + town. Never use numbers not in the data.',
  "Owner-led: H1 stays service + town, but the subhead names the owner(s) so the hero reads like a real person's business, not a franchise. If no owner names are on file, use the business name's personal form instead.",
  'Problem-first: open on the concrete moment a customer needs this trade (the failed furnace, the burst pipe, the leaking roof), resolving to service + town within the hero.',
  'Area-led: lead with the service territory — the towns and county from the data — positioning the business as the one that covers it.',
  'Specialty-led: lead with the single most distinctive service or review-mined strength this business has, plus the town.',
  "Question-led: the H1 poses the customer's actual search question naturally, and the subhead answers it with specifics from the data.",
];

interface DesignDirection {
  palette: string;
  typography: string;
  hero: string;
  signature: string;
}

// Distinct multipliers/offsets decorrelate the four picks so sequential
// lead ids don't walk through the lists in lockstep.
function assignDesignDirection(leadId: number): DesignDirection {
  return {
    palette: PALETTES[leadId % PALETTES.length],
    typography: TYPOGRAPHY[(leadId * 7 + 3) % TYPOGRAPHY.length],
    hero: HERO_LAYOUTS[(leadId * 13 + 1) % HERO_LAYOUTS.length],
    signature: SIGNATURE_ELEMENTS[(leadId * 17 + 2) % SIGNATURE_ELEMENTS.length],
  };
}

function assignHeadlineAngle(leadId: number): string {
  return HEADLINE_ANGLES[(leadId * 11 + 5) % HEADLINE_ANGLES.length];
}

// Landingsite's wrapper asks for "the most accurate Schema.org business
// type available" — we know the trade, so state it instead of leaving it
// to guesswork. Order matters: check specific trades before the generic
// contractor match (industry values like 'general_contractor').
function schemaTypeForIndustry(industry: string | null): string {
  const s = (industry ?? '').toLowerCase();
  if (s.includes('plumb')) return 'Plumber';
  if (s.includes('hvac') || s.includes('heating') || s.includes('cooling')) return 'HVACBusiness';
  if (s.includes('electric')) return 'Electrician';
  if (s.includes('roof')) return 'RoofingContractor';
  if (s.includes('contractor') || s.includes('construction') || s.includes('remodel')) return 'GeneralContractor';
  return 'LocalBusiness';
}

function safeParseArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface Quote {
  text?: string;
  author?: string;
}

function safeParseQuotes(json: string | null): Quote[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is Quote => typeof x === 'object' && x !== null && 'text' in x,
    );
  } catch {
    return [];
  }
}

export function buildPipelineBriefPrompt(input: PipelineBriefInput): BuiltPipelineBriefPrompt {
  const design = assignDesignDirection(input.lead_id);
  const headlineAngle = assignHeadlineAngle(input.lead_id);
  const schemaType = schemaTypeForIndustry(input.industry);
  const services = safeParseArray(input.extracted_services);
  const serviceAreas = safeParseArray(input.extracted_service_areas);
  const strengths = safeParseArray(input.extracted_strengths);
  const landmarks = safeParseArray(input.extracted_local_landmarks);
  const quotes = safeParseQuotes(input.pitch_quotes).slice(0, 4);

  const locationLabel = [input.city, input.state].filter(Boolean).join(', ') || 'their area';
  const ratingLine =
    input.google_rating && input.google_review_count
      ? `${input.google_rating.toFixed(1)} stars (${input.google_review_count} Google reviews)`
      : input.google_review_count
        ? `${input.google_review_count} Google reviews`
        : 'no public review data available';

  const system = `You are writing a compact brief that will be pasted into landingsite.ai to build a one-page demo homepage for a small local business. The business is being sold on this homepage cold — they did not ask for it, and they have no website today. The homepage's job is to make the operator's follow-up text (from Shaun at Shaun Carl Designs) feel like a gift: something so clearly useful and legitimate that the recipient wants to keep it.

Write plainly. Every sentence must be actionable for landingsite. Do not editorialize about the industry, the operator, or the business's future.

Structure the output as exactly these section headers, in this order, and nothing else:
- BUSINESS OVERVIEW
- TARGET AUDIENCE
- PAGE PURPOSE
- HERO COPY (USE VERBATIM)
- SEO SPECIFICS (USE VERBATIM)
- WHAT MUST APPEAR
- SUGGESTED SECTIONS
- WHAT TO EMPHASIZE
- DESIGN DIRECTION
- CONSTRAINTS

HERO COPY rules: write the exact hero copy the page must use — the words
themselves, not a description of them. Format:
  H1: <the headline, roughly 6–12 words>
  Subhead: <one or two sentences>
Open the section with a line telling the builder to use this copy
verbatim as the page hero and NOT to replace it with a generated
headline. The H1 must read like something a customer would actually
search for: it names the primary service(s) and the town. Include the
business name only when it flows naturally — never force it. Write the
copy through the assigned headline angle in the input; if the angle
calls for data that isn't on file, keep its spirit and build from what
is. The subhead must contain at least one concrete fact from the data
(a specific service, the rating, the town, hours, an owner's name) and
zero generic virtues.
Hard bans for hero copy, beyond the fluff-word list: "honest", any
"trust"/"you can trust" construction, "fair prices", "real people",
"quality you can count on", "done right", "your local experts", "peace
of mind", "no job too big or small", and any headline shaped like
"[Adjective] [Trade] Services You Can [Verb]". These are the formulas
every generated site converges on. Test: if the headline could be
pasted onto a competitor's site unchanged, rewrite it until it
couldn't.

SEO SPECIFICS rules: exact strings the builder must use, not
descriptions. Format:
  Title tag: <roughly 50–60 chars: primary service in town | business name>
  Meta description: <roughly 140–160 chars: service, town, one concrete differentiator, call to action>
  Primary search phrase: <the single query this page should rank for>
  Schema type: <the Schema.org type given in the input, exactly>
  Area served: <the business's town plus every mined service area, comma-separated>
Write the title tag and meta description fresh — do not reuse the H1's
wording. The meta description's differentiator must be a fact from the
data (the rating, a named service, the owners), never a generic virtue.
The hero-copy phrase bans apply here too.

SUGGESTED SECTIONS rules: present this as a suggested page layout the
builder may adapt — open the section with a line like "Suggested layout,
adapt as fits the business:" so landingsite treats it as guidance, not a
mandate. List these sections in this order, each with one short line
tailoring it to THIS business from the enrichment data (skip the tailoring
line, not the section, when there's nothing specific to say):
- Hero
- Services
- About
- Reviews
- Service area with map
- Contact form
- FAQs
For Hero, point to the HERO COPY section rather than proposing a second
headline. For Reviews, reference the actual rating/count. For Service area
with map, anchor on the business's city AND name every mined service-area
town — the builder should reference these nearby communities naturally, not
just the home city. For Services, use the mined services if present,
category-standard defaults if not. For FAQs, supply four to six actual
questions and give definitive answers wherever the data can answer them
(hours, towns served, services offered, who runs the shop) — real answers
make the FAQ schema-worthy, while a page of "contact us to learn more"
answers is thin content. Frame only genuinely unknown items (pricing,
warranties, emergency availability) as questions answered with a neutral
contact-for-details line.

DESIGN DIRECTION rules: the input assigns this business a specific visual
direction — palette (with hex codes), typography, hero layout, and one
signature element. Reproduce all four in this section, hex codes exact,
and open it with a line telling the builder this direction replaces its
default industry styling (e.g. "Use this visual direction instead of a
default 'professional' look:"). Then add one or two imagery notes specific
to THIS business — its trade, its town, its landmarks, its owners — so the
photos and texture feel local rather than stock-generic. The assignment is
binding: do not soften it into a suggestion, swap the palette, or fall
back to industry-typical colors.

Rules:
- Ground every claim in the enrichment data provided. Never invent services, awards, staff members, or history.
- Contact details (phone, address, hours) must be written VERBATIM wherever you reference them — the exact digits, the exact street address. Never write "phone number" or "address" generically: this brief is landingsite's only data source, so a value you don't transcribe does not exist to the builder. If a detail is marked "(none on file)", do not instruct the page to include it — route contact through the form instead.
- If the enrichment is sparse, say so honestly ("Reviews do not name specific services; use category-standard defaults for barbershops.") rather than filling gaps with generic marketing copy.
- No fabricated testimonials. If quotes are provided in the input, you may quote them verbatim with attribution; do not paraphrase them.
- A "CUSTOMER REVIEWS (VERBATIM)" section containing the business's full mined review set is appended below your brief automatically after you finish — do NOT reproduce full reviews yourself. In the Reviews section suggestion and WHAT TO EMPHASIZE, direct the builder to pull exact quotes from that appended section.
- Do not use any of these fluff words or their close variants: ${BANNED_WORDS.join(', ')}. If you catch yourself reaching for one, cut it or find a concrete alternative.
- Keep the whole brief under 620 words. This is a working doc, not marketing copy.
- Write for an operator who will paste this into a landingsite prompt. Direct instructions ("include", "avoid", "position the CTA above the fold") beat descriptive prose.`;

  // Structured data blob for the user turn — Claude parses more reliably
  // when the input is labeled rather than embedded in prose.
  const dataLines: string[] = [
    `Business: ${input.company}`,
    `Industry: ${input.industry ?? 'unspecified'}`,
    `Location: ${locationLabel}`,
  ];
  // Absence is data: an explicit "(none on file)" marker lets the system
  // prompt forbid demanding contact details we don't hold, instead of the
  // model filling the gap with generic NAP advice.
  dataLines.push(`Address: ${input.address ?? '(none on file)'}`);
  dataLines.push(`Phone: ${input.phone ?? '(none on file)'}`);
  dataLines.push(`Hours: ${input.hours ?? '(none on file)'}`);
  dataLines.push(`Reputation: ${ratingLine}`);
  if (input.owner_names) dataLines.push(`Owner(s): ${input.owner_names}`);

  if (services.length) {
    dataLines.push(`Services mined from reviews: ${services.join(', ')}`);
  } else {
    dataLines.push('Services mined from reviews: (none extracted)');
  }
  if (serviceAreas.length) {
    dataLines.push(`Service-area towns mined from reviews: ${serviceAreas.join(', ')}`);
  }
  dataLines.push(`Schema.org business type to specify: ${schemaType}`);
  if (strengths.length) {
    dataLines.push(`Strengths mined from reviews: ${strengths.join('; ')}`);
  }
  if (landmarks.length) {
    dataLines.push(`Local landmarks mentioned: ${landmarks.join(', ')}`);
  }
  if (input.opportunity_reasoning) {
    dataLines.push(`Why this lead scored well: ${input.opportunity_reasoning}`);
  }

  dataLines.push('');
  dataLines.push(`Assigned headline angle (write HERO COPY through this lens): ${headlineAngle}`);

  dataLines.push('');
  dataLines.push('Assigned design direction (carry into the DESIGN DIRECTION section):');
  dataLines.push(`  Palette: ${design.palette}`);
  dataLines.push(`  Typography: ${design.typography}`);
  dataLines.push(`  Hero layout: ${design.hero}`);
  dataLines.push(`  Signature element: ${design.signature}`);

  if (quotes.length) {
    dataLines.push('');
    dataLines.push('Customer quotes from reviews (verbatim; do NOT paraphrase):');
    for (const q of quotes) {
      const attribution = q.author ? ` — ${q.author}` : '';
      dataLines.push(`  "${q.text?.trim() ?? ''}"${attribution}`);
    }
  }

  const user = `Write the pipeline brief for the business below.

${dataLines.join('\n')}

Return the brief only. No preamble, no closing remarks, no code fences.`;

  return { system, user };
}
