import { callClaudeJson } from './claude';
import { buildReviewExtractionPrompt } from '../prompts/reviewExtraction';
import type { GoogleReview } from './places';

export interface PitchQuote {
  author: string;
  location: string;
  quote: string;
  why: string;
}

export interface MinedReviewData {
  service_areas: string[];
  /**
   * Sub-city geographic references mined from reviews: neighborhoods,
   * named districts, landmarks, roads, bridges, regions. Each item may
   * include the city when it was obvious from context (e.g. "East Side
   * of Green Bay"). Used to seed local color on per-city service-area
   * page briefs.
   */
  local_landmarks: string[];
  services_performed: string[];
  owner_names: string[];
  strengths: string[];
  pitch_quotes: PitchQuote[];
}

const EMPTY: MinedReviewData = {
  service_areas: [],
  local_landmarks: [],
  services_performed: [],
  owner_names: [],
  strengths: [],
  pitch_quotes: [],
};

export async function mineReviews(
  apiKey: string,
  business: string,
  city: string,
  reviews: GoogleReview[]
): Promise<MinedReviewData> {
  if (!reviews.length) return EMPTY;

  const prompt = buildReviewExtractionPrompt(business, city, reviews);
  const result = await callClaudeJson<Partial<MinedReviewData>>(apiKey, prompt, {
    maxTokens: 2048,
    temperature: 0.2,
  });

  return {
    service_areas: result.service_areas ?? [],
    local_landmarks: result.local_landmarks ?? [],
    services_performed: result.services_performed ?? [],
    owner_names: result.owner_names ?? [],
    strengths: result.strengths ?? [],
    pitch_quotes: (result.pitch_quotes ?? []).slice(0, 5),
  };
}
