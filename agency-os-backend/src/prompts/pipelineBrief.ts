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
  const services = safeParseArray(input.extracted_services);
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
- WHAT MUST APPEAR
- SUGGESTED SECTIONS
- WHAT TO EMPHASIZE
- CONSTRAINTS

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
For Reviews, reference the actual rating/count. For Service area with map,
anchor on the business's city/area. For Services, use the mined services if
present, category-standard defaults if not. Do not invent FAQ answers that
require facts you don't have — frame FAQ topics instead (hours, service
area, pricing expectations, how to book).

Rules:
- Ground every claim in the enrichment data provided. Never invent services, awards, staff members, or history.
- Contact details (phone, address, hours) must be written VERBATIM wherever you reference them — the exact digits, the exact street address. Never write "phone number" or "address" generically: this brief is landingsite's only data source, so a value you don't transcribe does not exist to the builder. If a detail is marked "(none on file)", do not instruct the page to include it — route contact through the form instead.
- If the enrichment is sparse, say so honestly ("Reviews do not name specific services; use category-standard defaults for barbershops.") rather than filling gaps with generic marketing copy.
- No fabricated testimonials. If quotes are provided in the input, you may quote them verbatim with attribution; do not paraphrase them.
- A "CUSTOMER REVIEWS (VERBATIM)" section containing the business's full mined review set is appended below your brief automatically after you finish — do NOT reproduce full reviews yourself. In the Reviews section suggestion and WHAT TO EMPHASIZE, direct the builder to pull exact quotes from that appended section.
- Do not use any of these fluff words or their close variants: ${BANNED_WORDS.join(', ')}. If you catch yourself reaching for one, cut it or find a concrete alternative.
- Keep the whole brief under 450 words. This is a working doc, not marketing copy.
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
  if (strengths.length) {
    dataLines.push(`Strengths mined from reviews: ${strengths.join('; ')}`);
  }
  if (landmarks.length) {
    dataLines.push(`Local landmarks mentioned: ${landmarks.join(', ')}`);
  }
  if (input.opportunity_reasoning) {
    dataLines.push(`Why this lead scored well: ${input.opportunity_reasoning}`);
  }

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
