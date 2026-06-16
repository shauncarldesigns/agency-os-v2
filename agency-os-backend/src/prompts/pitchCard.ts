// Pitch card prompt — generates a 2-3 sentence pre-call script that the
// operator reads off the execution view. Synthesizes business strengths,
// competitive intel, and an opening question.
//
// Designed for cheap on-demand use (Haiku). Generated only when operator
// clicks ↻ on the execution view — never automatically. Cached on
// leads.pitch_card_text once generated.

import type { Lead } from '../types';

interface PitchCardInput {
  company: string;
  city: string | null;
  state: string | null;
  industry: string | null;
  ownerName: string | null;
  reviewCount: number | null;
  rating: number | null;
  pagespeed: number | null;
  hasWebsite: boolean;
  gbpClaimed: boolean;
  extractedStrengths: string[];     // bulleted strengths mined from reviews
  pitchQuotes: string[];            // verbatim review quotes useful for pitch
  recommendedTier: number | null;
  scoreReasoning: string | null;
}

export function buildPitchCardPrompt(input: PitchCardInput): string {
  const intel: string[] = [];
  if (input.reviewCount != null) intel.push(`${input.reviewCount} Google reviews${input.rating != null ? `, ${input.rating.toFixed(1)}★` : ''}`);
  if (!input.gbpClaimed) intel.push(`unclaimed GBP`);
  if (!input.hasWebsite) intel.push(`no website`);
  else if (input.pagespeed != null) intel.push(`mobile PageSpeed ${input.pagespeed}/100`);
  if (input.recommendedTier) intel.push(`pitched at Tier ${input.recommendedTier}`);

  const strengthsBlock = input.extractedStrengths.length > 0
    ? `\nReview-mined strengths:\n${input.extractedStrengths.map((s) => `- ${s}`).join('\n')}`
    : '';

  const quotesBlock = input.pitchQuotes.length > 0
    ? `\nVerbatim review quotes (you may paraphrase one):\n${input.pitchQuotes.slice(0, 3).map((q) => `- "${q}"`).join('\n')}`
    : '';

  const where = [input.city, input.state].filter(Boolean).join(', ');
  const ownerLine = input.ownerName ? `Owner: ${input.ownerName}` : '';

  return `You are writing a 2-3 sentence pre-call PITCH CARD for a cold call to a local-service business. The agency operator will read this just before dialing, so it must sound like prep notes, not sales copy.

THE BUSINESS
${input.company}${where ? ` · ${where}` : ''}${input.industry ? ` · ${input.industry}` : ''}
${ownerLine}
Intel: ${intel.join(' · ') || '(none)'}
${input.scoreReasoning ? `Scoring: ${input.scoreReasoning}` : ''}
${strengthsBlock}${quotesBlock}

OUTPUT RULES
- 2-3 sentences total, MAX 60 words combined.
- Sentence 1: one specific observation about THIS business (lift from reviews/intel — never generic).
- Sentence 2: one competitive angle or market observation if relevant ("three plumbers in De Pere crossed 100 reviews this year") OR a second specific observation.
- Sentence 3 (optional): one specific opening question the operator can ask.
- Do NOT use words like "premier", "trusted", "leading", "passionate", "dedicated", "quality", "professional". Anti-fluff.
- Do NOT mention the agency, our services, or any pricing.
- Do NOT use the operator's name or sign off.
- Output ONLY the 2-3 sentences, no preamble.

Write the pitch card now:`;
}

// Helper to extract the inputs the prompt needs from a Lead row.
export function leadToPitchCardInput(lead: Lead): PitchCardInput {
  const safeJsonArray = (raw: string | null): string[] => {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
    } catch { return []; }
  };
  return {
    company: lead.company,
    city: lead.city,
    state: lead.state,
    industry: lead.industry,
    ownerName: (safeJsonArray(lead.owner_names)[0] ?? null),
    reviewCount: lead.google_review_count,
    rating: lead.google_rating,
    pagespeed: lead.pagespeed_mobile,
    hasWebsite: !!lead.website,
    gbpClaimed: lead.gbp_claimed === 1,
    extractedStrengths: safeJsonArray(lead.extracted_strengths),
    pitchQuotes: safeJsonArray(lead.pitch_quotes),
    recommendedTier: lead.recommended_tier,
    scoreReasoning: lead.opportunity_reasoning,
  };
}
