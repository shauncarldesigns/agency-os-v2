// Master site-brief prompt for Cowork → landingsite.ai handoff.
// Output is opinionated markdown; the human-in-the-loop reviews it before queueing.

export interface SiteBriefInput {
  businessName: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  yearsInBusiness: number | null;
  ownerName: string | null;
  industry: string | null;
  description: string | null;
  brandVoiceNotes: string | null;
  services: string[];           // mined or curated
  serviceAreas: string[];       // mined or curated
  pitchQuotes: Array<{ author: string; location?: string; quote: string }>;
  strengths: string[];
  tier: 1 | 2 | 3;
  // Optional override: which pages to plan in initial build.
  // If omitted, defaults to a tier-appropriate spread.
  plannedPages?: Array<{ type: string; service?: string; city?: string }>;
}

const TIER_DEFAULTS: Record<1 | 2 | 3, {
  totalPages: number;
  buildType: string;
  servicePages: number;
  serviceAreaPages: number;
  invest: string;
}> = {
  1: { totalPages: 5, buildType: 'Tier 1 Foundation', servicePages: 2, serviceAreaPages: 0, invest: 'minimum viable foundation — fast, no fluff, complete handoff' },
  2: { totalPages: 5, buildType: 'Tier 2 Foundation', servicePages: 3, serviceAreaPages: 0, invest: 'foundation + ongoing edits — concise but conversion-focused' },
  3: { totalPages: 15, buildType: 'Tier 3 Launch', servicePages: 6, serviceAreaPages: 5, invest: 'this is a Tier 3 launch — invest in SEO depth, schema, internal linking, and page-level uniqueness' },
};

export function buildSiteBriefPrompt(input: SiteBriefInput): string {
  const tier = TIER_DEFAULTS[input.tier];

  // Plan structure: prefer explicit plannedPages, otherwise auto-allocate
  const plannedPages = input.plannedPages?.length
    ? input.plannedPages
    : autoPlanPages(input.services, input.serviceAreas, input.tier);

  return `You are generating a markdown site brief for "${input.businessName}". This brief is the handoff document a human operator will paste into Cowork (an AI desktop agent) to drive landingsite.ai's chat UI page-by-page.

Output ONLY the markdown brief, exactly in the format below. Do not add commentary, do not wrap in code fences, do not use placeholders.

CRITICAL RULES:
- Never reference "Merchynt" anywhere — it is a white-label internal vendor and must not appear in client-facing content.
- Brand voice: local, trustworthy, direct. 6th-8th grade reading level. Active voice. Zero fluff. Sounds like a real owner wrote it. Written for homeowners, not businesses.
- Tier ${input.tier} build: ${tier.invest}.
- Each page must have a unique meta title and description (150-160 chars).
- Service-area page title format: "{Service} in {City}, ${input.state ?? 'WI'} | ${input.businessName}".
- Internal linking between service pages and service-area pages.
- LocalBusiness schema on homepage; Service schema on service pages.

INPUT DATA:
- Business: ${input.businessName}
- Phone: ${input.phone ?? '(not provided)'}
- Location: ${[input.city, input.state].filter(Boolean).join(', ') || '(not provided)'}
- Years in business: ${input.yearsInBusiness ?? 'unknown'}
- Owner name (if mined): ${input.ownerName ?? '(not extracted from reviews)'}
- Industry: ${input.industry ?? '(unspecified)'}
- Description: ${input.description ?? '(none)'}
- Brand voice notes: ${input.brandVoiceNotes ?? '(use defaults)'}
- Services: ${input.services.join(', ') || '(none mined — make educated picks based on industry)'}
- Service areas mined from reviews: ${input.serviceAreas.join(', ') || '(only the home city)'}
- Customer pitch quotes:
${input.pitchQuotes.map(q => `  - "${q.quote}" — ${q.author}${q.location ? `, ${q.location}` : ''}`).join('\n') || '  - (no pitch quotes mined)'}
- Recurring strengths from reviews: ${input.strengths.join(', ') || '(none mined)'}

PLANNED SITE STRUCTURE (${tier.totalPages} pages):
${plannedPages.map((p, i) => `  ${i + 1}. ${describePage(p)}`).join('\n')}

OUTPUT FORMAT (replace bracketed sections with content; keep all section headers verbatim):

# Site Brief: ${input.businessName}

## Business Overview
**Name:** ${input.businessName}
**Phone:** ${input.phone ?? '(client to provide)'}
**Location:** ${[input.city, input.state].filter(Boolean).join(', ')}${input.yearsInBusiness ? ` · ${input.yearsInBusiness} years` : ''}
**Owner:** ${input.ownerName ?? '(to be confirmed with client)'}

## Brand Voice
[2-3 sentences capturing the brand voice based on the inputs above. Sounds like the owner wrote it. 6th-8th grade reading level. Active voice. Zero fluff.]

## Services
[Numbered list of services, in order of importance. One per line.]

## Service Areas (review-mined)
[List service areas. If reviews mention areas not on the GBP, flag those with " (review-only)".]

## Site Structure (${tier.buildType})
[Bullet list summarizing the planned pages above, with 1-line rationale per page-type group.]

## Customer Quotes (from reviews)
[Up to 5 of the most pitch-worthy quotes, one per line, format: "{quote}" — {Author}, {Location}.]

## SEO Requirements
- Each page must have a unique meta title and meta description (150-160 chars).
- Title format for service-area pages: "{Service} in {City}, ${input.state ?? 'WI'} | ${input.businessName}".
- Meta descriptions: include service + city + phone.
- Internal linking between service pages and service-area pages.
- LocalBusiness schema on homepage, Service schema on service pages.

## Build Instructions for Cowork
Sequential page-by-page. Send the homepage brief first, then prompt for each subsequent page individually. Do not start a new page until the previous one returns "complete" in landingsite.ai.

`;
}

function describePage(p: { type: string; service?: string; city?: string }): string {
  switch (p.type) {
    case 'homepage': return 'Homepage';
    case 'about': return 'About page';
    case 'contact': return 'Contact page';
    case 'faq': return 'FAQ page';
    case 'service': return p.service ? `Service page — ${p.service}` : 'Service page';
    case 'service-area': return [p.service, p.city].filter(Boolean).length === 2
      ? `Service-area page — ${p.service} in ${p.city}`
      : 'Service-area page';
    default: return p.type;
  }
}

function autoPlanPages(services: string[], areas: string[], tier: 1 | 2 | 3): Array<{ type: string; service?: string; city?: string }> {
  const t = TIER_DEFAULTS[tier];
  const pages: Array<{ type: string; service?: string; city?: string }> = [
    { type: 'homepage' },
    { type: 'about' },
    { type: 'contact' },
  ];
  if (tier === 3) pages.push({ type: 'faq' });

  // Service pages
  for (let i = 0; i < Math.min(services.length, t.servicePages); i++) {
    pages.push({ type: 'service', service: services[i] });
  }

  // Service-area pages — pair top services × top areas (Tier 3 only by default)
  if (t.serviceAreaPages > 0 && areas.length > 0 && services.length > 0) {
    const pairs: Array<{ service: string; city: string }> = [];
    outer: for (const svc of services.slice(0, 3)) {
      for (const city of areas.slice(0, 3)) {
        pairs.push({ service: svc, city });
        if (pairs.length >= t.serviceAreaPages) break outer;
      }
    }
    for (const p of pairs) pages.push({ type: 'service-area', ...p });
  }

  return pages.slice(0, t.totalPages);
}
