/**
 * Brand extraction from scraped website text.
 *
 * Phase 4 — scraper service runs this prompt against the combined homepage +
 * up-to-3-internal-pages text to pull out brand voice signals that get stored
 * as brand_attributes.
 */

export interface ExtractedBrand {
  tagline: string | null;
  positioning: string | null;
  owner_story: string | null;
  certifications: string[];
  services_described: string[];
  distinctive_phrases: string[];
}

export function buildBrandExtractionPrompt(businessName: string, scrapedText: string): string {
  const trimmed = scrapedText.length > 12000 ? scrapedText.slice(0, 12000) + '\n…[truncated]' : scrapedText;
  return `You are reading scraped text from ${businessName}'s existing website. Extract brand voice signals.

OUTPUT — return ONLY a single JSON object with this exact shape:

{
  "tagline": "<the literal tagline if one appears prominently on the homepage, or null>",
  "positioning": "<one-sentence positioning statement that summarises how the business describes itself, or null>",
  "owner_story": "<the owner's personal story summarised in 1-2 sentences as it appears on the site, or null>",
  "certifications": ["<each certification or award mentioned, verbatim>"],
  "services_described": ["<each service described in the business's own words, kept short>"],
  "distinctive_phrases": ["<5-10 distinctive phrases that capture the brand voice — actual quotes, not paraphrased>"]
}

RULES:
- Quote exactly from the source text. Do not paraphrase taglines, owner stories, or distinctive_phrases.
- For services_described, keep each entry under 12 words. If the site lists "Roof Replacement: We tear off and replace asphalt shingle roofs", output "Roof Replacement — tear off and replace asphalt shingle roofs".
- If a field is not present in the text, use null (for strings) or [] (for arrays). Do not invent.
- Aim for 5-10 distinctive_phrases. They should be the language that makes this business sound different from a generic competitor.
- Skip generic filler ("call us today", "we are committed to quality").
- Output ONLY the JSON object — no preamble, no closing remarks, no markdown code fences.

--- SCRAPED TEXT ---

${trimmed}`;
}
