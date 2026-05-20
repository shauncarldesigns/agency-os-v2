import type { GoogleReview } from '../services/places';

export function buildReviewExtractionPrompt(business: string, city: string, reviews: GoogleReview[]): string {
  const reviewLines = reviews
    .map((r, i) => `[${i + 1}] ${r.author} (${r.rating}★, ${r.relativeTime}): "${r.text.replace(/\s+/g, ' ').trim()}"`)
    .join('\n');

  return `You are analyzing Google reviews for ${business} in ${city}. Extract structured intel useful for cold-call sales prep and SEO content generation.

Reviews:
${reviewLines}

Extract and return ONLY valid JSON in this exact shape:
{
  "service_areas": [<list of cities/neighborhoods customers mention>],
  "services_performed": [<specific services mentioned, be granular>],
  "owner_names": [<names of staff customers mention by name>],
  "strengths": [<recurring themes mentioned in 3+ reviews>],
  "pitch_quotes": [
    {
      "author": "...",
      "location": "...",
      "quote": "...",
      "why": "<1-sentence why this is sales-quality>"
    }
  ],
  "differentiators": [<unique selling points emerging from reviews>]
}

Rules:
- Only include locations actually mentioned in reviews
- Be specific about services ("replaced 50-gallon water heater" not just "plumbing")
- Pitch quotes should be vivid, specific, and emotionally resonant
- Maximum 5 pitch quotes
- If something isn't found, return empty array — don't invent
- Return ONLY the JSON object, no preface or commentary`;
}
