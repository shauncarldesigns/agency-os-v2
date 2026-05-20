/**
 * Monthly batch brief — Phase 2 baseline.
 *
 * Generates a small markdown doc describing N service-area pages to build this
 * month. Designed to be pasted into Cowork. Final quality iteration happens in
 * Phase 5 when the SEO Coverage Matrix UI exists; this is a working baseline.
 */

import type { BuiltMasterBriefPrompt } from './masterBrief';

export interface MonthlyBatchPageRequest {
  service: string;
  city: string;
  /** Pre-filtered review quotes that mention this city, if any. */
  city_review_quotes?: Array<{ author: string; quote: string }>;
}

export interface MonthlyBatchInput {
  business_name: string;
  state: string | null;
  phone: string | null;
  batch_period: string;            // e.g. '2026-06'
  monthly_pages_target: number;    // expected page count (5 for default Tier 3)
  brand_voice_summary: string | null;
  master_brief_excerpt: string | null;
  already_built_pages: Array<{ service: string; city: string; url?: string | null }>;
  pages: MonthlyBatchPageRequest[];
}

const SYSTEM_PROMPT = `You are writing a monthly batch brief for a local-service agency. The brief will be pasted into Cowork (an AI prompt-driver). Cowork will then write per-page prompts on its own and drive landingsite.ai.

OUTPUT FORMAT — produce a SHORT markdown document (target: 1–2 pages) with these sections, in order:

1. # Monthly Batch Brief: {Business Name} — {Batch Period}
2. ## Brand Voice (one paragraph — recap, do not re-derive)
3. ## Pages To Build (numbered list — one block per page)
   For each page, include:
   - URL pattern: \`/service-areas/{service-slug}-{city-slug}-{state-lower}\`
   - H1: "{Service} in {City}, {State}"
   - Local context to incorporate (1–3 short bullets — neighborhoods, weather, housing stock, etc., based on general knowledge of the city if no review quote is provided)
   - Customer quote to use (verbatim from review_quotes if provided; otherwise write "[no quote available — operator may supply]")
   - Internal links (1–3 already-built pages that this page should link to, chosen from the "Pages already built" list — prefer the same service or same city)
4. ## Build Order (one line — "Build these in order: 1, 2, 3, … so internal links resolve as you go.")
5. ## Operator Checklist (one checkbox line per page, ready to copy into a tracker)

HARD RULES:
- Brand voice paragraph must be a paraphrased recap of the provided brand voice summary, not a re-derivation from scratch. Keep it under 4 sentences.
- Quote customers verbatim. No paraphrasing of testimonials.
- If no review quote exists for a city, do NOT invent one. Write "[no quote available — operator may supply]".
- Do not use "premier," "world-class," "leading," or "trusted."
- The word "Merchynt" must not appear.
- Active voice. Zero fluff. 6th-8th grade reading level for any prose that will end up in site copy.
- Do not output any preamble or closing remarks. Start with the H1 and end with the last operator checklist line.
- Do not wrap the output in a markdown code fence.`;

export function buildMonthlyBatchBriefPrompt(input: MonthlyBatchInput): BuiltMasterBriefPrompt {
  const lines: string[] = [];
  lines.push(`Generate the monthly batch brief for ${input.business_name} — batch period ${input.batch_period}.`);
  lines.push('');
  lines.push(`State: ${input.state ?? '[missing]'}`);
  lines.push(`Phone: ${input.phone ?? '[missing]'}`);
  lines.push(`Monthly target: ${input.monthly_pages_target} page(s). Pages requested this batch: ${input.pages.length}.`);
  lines.push('');

  lines.push('## Brand voice summary (for recap, not re-derivation)');
  lines.push(input.brand_voice_summary?.trim() || '(none — use the master brief excerpt below if present)');
  lines.push('');

  if (input.master_brief_excerpt) {
    lines.push('## Master brief excerpt');
    lines.push('```');
    lines.push(input.master_brief_excerpt.length > 4000
      ? input.master_brief_excerpt.slice(0, 4000) + '\n…[truncated]'
      : input.master_brief_excerpt);
    lines.push('```');
    lines.push('');
  }

  lines.push('## Pages already built (for internal-linking context)');
  if (input.already_built_pages.length === 0) {
    lines.push('(none yet)');
  } else {
    for (const p of input.already_built_pages) {
      lines.push(`- ${p.service} in ${p.city}${p.url ? ` — ${p.url}` : ''}`);
    }
  }
  lines.push('');

  lines.push('## Pages to build this batch');
  for (let i = 0; i < input.pages.length; i++) {
    const p = input.pages[i];
    lines.push(`### ${i + 1}. ${p.service} in ${p.city}`);
    if (p.city_review_quotes && p.city_review_quotes.length > 0) {
      lines.push('Review quotes mentioning this city:');
      for (const q of p.city_review_quotes) {
        lines.push(`- "${q.quote}" — ${q.author}`);
      }
    } else {
      lines.push('Review quotes mentioning this city: (none)');
    }
    lines.push('');
  }

  lines.push('## Now produce the brief in the format defined in the system message.');
  return { system: SYSTEM_PROMPT, user: lines.join('\n') };
}
