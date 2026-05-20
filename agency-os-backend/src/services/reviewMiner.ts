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
  services_performed: string[];
  owner_names: string[];
  strengths: string[];
  pitch_quotes: PitchQuote[];
  differentiators: string[];
}

const EMPTY: MinedReviewData = {
  service_areas: [],
  services_performed: [],
  owner_names: [],
  strengths: [],
  pitch_quotes: [],
  differentiators: [],
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
    services_performed: result.services_performed ?? [],
    owner_names: result.owner_names ?? [],
    strengths: result.strengths ?? [],
    pitch_quotes: (result.pitch_quotes ?? []).slice(0, 5),
    differentiators: result.differentiators ?? [],
  };
}
