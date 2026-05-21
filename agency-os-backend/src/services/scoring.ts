export interface ScoringInput {
  hasWebsite: boolean;
  pagespeedMobile: number | null;
  pagespeedDesktop: number | null;
  gbpClaimed: boolean;
  gbpPhotos: number;
  gbpHasDescription: boolean;
  gbpHasHours: boolean;
  reviewCount: number;
  rating: number | null;
  recentReviewActivity: boolean;
  yearsInBusiness: number | null;
}

export interface ScoringResult {
  score: number;
  tier: 1 | 2 | 3;
  reasoning: string;
  factors: string[];
}

export function calculateOpportunityScore(input: ScoringInput): ScoringResult {
  let score = 0;
  const factors: string[] = [];

  // Website signals (weight: 30 points)
  if (!input.hasWebsite) {
    score += 25;
    factors.push('No website — easy Tier 1 pitch');
  } else if (input.pagespeedMobile !== null && input.pagespeedMobile < 50) {
    score += 25;
    factors.push(`Slow website (PSI ${input.pagespeedMobile}) — clear pain point`);
  } else if (input.pagespeedMobile !== null && input.pagespeedMobile < 70) {
    score += 15;
    factors.push('Decent but improvable site');
  }

  // GBP signals (weight: 30 points)
  if (!input.gbpClaimed) {
    score += 25;
    factors.push('Unclaimed GBP — high opportunity');
  } else {
    if (input.gbpPhotos < 5) { score += 10; factors.push('Few GBP photos'); }
    if (!input.gbpHasDescription) { score += 5; factors.push('No GBP description'); }
    if (!input.gbpHasHours) { score += 5; factors.push('GBP missing hours'); }
  }

  // Review/authority signals (weight: 30 points)
  if (input.reviewCount >= 50) {
    score += 25;
    factors.push(`${input.reviewCount} reviews — established business`);
  } else if (input.reviewCount >= 20) {
    score += 18;
    factors.push(`${input.reviewCount} reviews — solid presence`);
  } else if (input.reviewCount >= 5) {
    score += 10;
  }
  if (input.rating !== null && input.rating >= 4.5) score += 5;
  if (input.recentReviewActivity) score += 5;

  // Years in business (weight: 10 points)
  if (input.yearsInBusiness && input.yearsInBusiness >= 10) {
    score += 10;
    factors.push(`${input.yearsInBusiness}+ years in business`);
  } else if (input.yearsInBusiness && input.yearsInBusiness >= 5) {
    score += 5;
  }

  score = Math.min(100, score);

  let tier: 1 | 2 | 3;
  if (score >= 60 && input.reviewCount >= 5) tier = 3;
  else if (score >= 40 || (input.hasWebsite && input.pagespeedMobile !== null && input.pagespeedMobile < 50)) tier = 2;
  else tier = 1;

  return { score, tier, reasoning: factors.join(' · '), factors };
}

export function recentReviewActivity(reviews: Array<{ publishTime?: string; relativeTime?: string }>): boolean {
  if (!reviews.length) return false;
  // Check publishTime ISO if present
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  for (const r of reviews) {
    if (r.publishTime) {
      const t = Date.parse(r.publishTime);
      if (!Number.isNaN(t) && t > cutoff) return true;
    }
    // Fallback: relative descriptions like "a week ago", "2 months ago"
    if (r.relativeTime) {
      const m = r.relativeTime.toLowerCase();
      if (/(day|week)s? ago/.test(m)) return true;
      const monthMatch = m.match(/(\d+)\s+months?\s+ago/);
      if (monthMatch && parseInt(monthMatch[1], 10) <= 3) return true;
      if (m.includes('a month ago')) return true;
    }
  }
  return false;
}
