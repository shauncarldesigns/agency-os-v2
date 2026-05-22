/**
 * Pre-signing homepage demo brief.
 *
 * Operators generate this from the Pipeline tab on a qualified lead. It's
 * built only from Places + review-mined data (no project, no master brief).
 * The brief is ephemeral — copied to landingsite.ai for a quick demo
 * homepage the operator shows on the next call. Not persisted in the briefs
 * table.
 *
 * Output target: ~600–800 words, homepage only.
 */

import type { GoogleReview } from '../services/places';
import type { MinedReviewData } from '../services/reviewMiner';

export interface HomepageDemoInput {
  business_name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  mined: MinedReviewData;
  reviews: GoogleReview[];
}

export interface BuiltHomepageDemoPrompt {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = `You are writing a single-page brief for a homepage demo. The agency uses this brief to seed landingsite.ai for a cold-call demo before the prospect has signed — the operator will show the resulting homepage on a follow-up call to close the deal.

OUTPUT FORMAT (markdown, in this order)
1. \`# Homepage Demo: {Business Name}\`
2. \`## URL & SEO\` — URL slug \`/\`, meta title, meta description (150–160 chars), H1
3. \`## Page Structure\` — sectioned outline of the homepage with the headline copy and key paragraphs to produce. Hero, services teaser, social proof, contact CTA. Be specific about what to write.
4. \`## Customer Voice\` — name the specific testimonials from the data that should appear, with the verbatim quote and attribution.
5. \`## Build Notes\` — short imperatives for landingsite.ai (phone display, photo direction, CTA placement, schema).

HARD RULES
- Use ONLY the provided data. Where a specific is missing (founded year, owner credentials, hex colors, photography direction), write \`[TBD: <field>]\` — never fabricate.
- Voice must come from the review themes, not generic adjectives.
- 6th–8th grade reading level.
- Reviews quoted verbatim, with author + location.
- No "premier," "world-class," or "leading."
- Output raw markdown only — no code fence, no preamble, no closing remarks. Start with the H1, end with the last Build Notes bullet.
- Target length: 600–800 words.
- This is a DEMO. It's a sales tool, not the production homepage. Keep CTAs friendly and inviting; don't over-commit on services or guarantees beyond what the reviews validate.`;

export function buildHomepageDemoBriefPrompt(input: HomepageDemoInput): BuiltHomepageDemoPrompt {
  const lines: string[] = [];
  lines.push(`Generate the homepage demo brief for ${input.business_name}.`);
  lines.push('');
  lines.push('## Lead data (Places + reviews — no signed contract yet)');
  lines.push(`- Business name: ${input.business_name}`);
  lines.push(`- City/State: ${input.city ?? '[missing]'}, ${input.state ?? '[missing]'}`);
  lines.push(`- Phone: ${input.phone ?? '[missing]'}`);
  lines.push(`- Website (existing): ${input.website ?? '[missing]'}`);
  lines.push(`- Google rating: ${input.google_rating ?? '—'} (${input.google_review_count ?? 0} reviews)`);
  lines.push('');

  lines.push('## Mined review data');
  lines.push(`- Services performed: ${listOr(input.mined.services_performed)}`);
  lines.push(`- Service areas: ${listOr(input.mined.service_areas)}`);
  lines.push(`- Owner names mentioned: ${listOr(input.mined.owner_names)}`);
  lines.push(`- Strengths (themes): ${listOr(input.mined.strengths)}`);
  if (input.mined.pitch_quotes.length) {
    lines.push('- Mined pitch quotes:');
    for (const q of input.mined.pitch_quotes) {
      lines.push(`  - "${q.quote}" — ${q.author}${q.location ? `, ${q.location}` : ''} (${q.why})`);
    }
  }
  lines.push('');

  lines.push('## Raw Google reviews');
  if (input.reviews.length === 0) {
    lines.push('(none)');
  } else {
    for (const r of input.reviews.slice(0, 5)) {
      lines.push(`- ${r.author} (${r.rating}★, ${r.relativeTime}): "${r.text.replace(/\s+/g, ' ').trim()}"`);
    }
  }
  lines.push('');

  lines.push('## Now produce the brief in the format defined in the system message.');
  return { system: SYSTEM_PROMPT, user: lines.join('\n') };
}

function listOr(arr: string[]): string {
  if (!arr || arr.length === 0) return '[none]';
  return arr.join(', ');
}
