import { log } from '../utils/errors';

export interface PageSpeedResult {
  score: number;
}

export interface PageSpeedReport {
  mobile: number;
  desktop: number;
  url: string;
  fetchedAt: string;
}

async function runPageSpeed(apiKey: string, url: string, strategy: 'mobile' | 'desktop'): Promise<PageSpeedResult> {
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&key=${apiKey}&category=performance`;
  // PageSpeed Insights can legitimately take 60–90s for slow sites — and slow
  // sites are exactly the leads worth scoring. 90s timeout per strategy. The
  // two strategies run via Promise.all in getPageSpeedReport, so worst-case
  // wall time is still ~90s, not 180s.
  const res = await fetch(endpoint, { signal: AbortSignal.timeout(90_000) });

  if (!res.ok) {
    const err = await res.text();
    log('error', 'pagespeed', `PageSpeed fetch failed (${strategy}): ${res.status}`, { err: err.slice(0, 200), url });
    throw new Error(`PageSpeed API error: ${res.status}`);
  }

  const data = await res.json() as {
    lighthouseResult?: { categories?: { performance?: { score: number } } };
  };
  const score = Math.round((data.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
  return { score };
}

export async function getPageSpeedReport(apiKey: string, url: string): Promise<PageSpeedReport> {
  const [mobile, desktop] = await Promise.all([
    runPageSpeed(apiKey, url, 'mobile'),
    runPageSpeed(apiKey, url, 'desktop'),
  ]);

  log('info', 'pagespeed', `Scores for ${url}`, { mobile: mobile.score, desktop: desktop.score });

  return { mobile: mobile.score, desktop: desktop.score, url, fetchedAt: new Date().toISOString() };
}
