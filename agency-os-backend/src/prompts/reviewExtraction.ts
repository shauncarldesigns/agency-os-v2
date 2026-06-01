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
  "service_areas": [<list of CITIES OR TOWNS customers mention by name — only place-names at city/town granularity, not neighborhoods or landmarks>],
  "local_landmarks": [<sub-city geographic references customers mention: neighborhoods, named districts, landmark locations, roads, bridges, parks, regions. Include both the reference and which city it belongs to if obvious from context. Examples: "East Side of Green Bay", "Allouez", "near the Fox River bridge", "downtown De Pere", "off Lombardi Ave". Used to seed local color on per-city service-area pages.>],
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
  ]
}

Rules:
- service_areas is for the geographic grid the agency targets — strictly city/town names.
- local_landmarks is for finer-grained geography customers actually said: neighborhoods, named areas, landmarks. Include the city when obvious from context.
- Be specific about services ("replaced 50-gallon water heater" not just "plumbing").
- Pitch quotes should be vivid, specific, and emotionally resonant.
- Maximum 5 pitch quotes.
- If something isn't found, return empty array — don't invent.
- Return ONLY the JSON object, no preface or commentary.`;
}
