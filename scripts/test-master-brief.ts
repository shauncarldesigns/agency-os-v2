/**
 * Phase 1 test harness — generates a master brief from hardcoded test data
 * and prints the resulting markdown to stdout.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/test-master-brief.ts
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/test-master-brief.ts --mode=homepage_only
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/test-master-brief.ts --model=claude-opus-4-7
 *
 * Pipe the markdown to a file:
 *   npx tsx scripts/test-master-brief.ts > /tmp/brief.md
 */

import { callClaude } from '../agency-os-backend/src/services/claude';
import {
  buildMasterBriefPrompt,
  type MasterBriefInput,
  type MasterBriefMode,
} from '../agency-os-backend/src/prompts/masterBrief';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

function parseArgs(argv: string[]): { mode: MasterBriefMode; model: string } {
  let mode: MasterBriefMode = 'full_site';
  let model = DEFAULT_MODEL;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--mode=')) {
      const val = arg.split('=')[1];
      if (val !== 'homepage_only' && val !== 'full_site') {
        throw new Error(`Invalid --mode value: ${val}`);
      }
      mode = val;
    } else if (arg.startsWith('--model=')) {
      model = arg.split('=')[1];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { mode, model };
}

// ---------------------------------------------------------------------------
// Hardcoded test data: Northshore Plumbing (fake but realistic Wisconsin SMB)
// ---------------------------------------------------------------------------

const TEST_INPUT: MasterBriefInput = {
  project: {
    business_name: 'Northshore Plumbing',
    city: 'Mequon',
    state: 'WI',
    phone: '(262) 555-0142',
    email: 'service@northshoreplumbingwi.com',
    website: 'https://northshoreplumbingwi.com',
    founded_year: 2008,
    owner_name: 'Dan Kovacs',
    owner_credentials: 'Master Plumber, 22 years in trade, WI License #234567',
    tagline: null, // intentionally missing — should produce [TBD]
    primary_color: '#1B3A5C',
    accent_color: '#E8A33D',
    photography_direction: 'Real crews on real jobs, no stock. Show trucks, tools, and the homeowner handoff.',
    monthly_pages_target: 5,
    tier: 'tier_3',
  },
  mined: {
    services_performed: [
      'water heater replacement',
      'sewer line repair',
      'sump pump installation',
      'frozen pipe thaw',
      'bathroom remodel plumbing',
      'drain cleaning',
      'gas line repair',
    ],
    service_areas: ['Mequon', 'Cedarburg', 'Thiensville', 'Grafton', 'Bayside', 'Fox Point', 'Whitefish Bay'],
    owner_names: ['Dan', 'Dan Kovacs'],
    strengths: [
      'arrives on time',
      'explains the work before starting',
      'fair pricing without surprise upcharges',
      'cleans up after the job',
      'available for emergencies on weekends',
    ],
    pitch_quotes: [
      {
        author: 'Linda M.',
        location: 'Cedarburg',
        quote:
          "Dan came out on a Sunday morning when our basement was flooding. He didn't try to upsell us — just fixed the sump and showed us what failed. Total pro.",
        why: 'demonstrates emergency response + honesty',
      },
      {
        author: 'Robert T.',
        location: 'Mequon',
        quote:
          "Quoted me $1,800 for a water heater. Three other plumbers wanted $2,400+. Same brand, same warranty. Dan's been our guy for six years now.",
        why: 'price differentiator + loyalty',
      },
      {
        author: 'Anita P.',
        location: 'Thiensville',
        quote:
          "He found a pinhole leak in our copper that two other companies missed. Walked me through every step. I trust him with anything plumbing now.",
        why: 'diagnostic skill + communication',
      },
    ],
    differentiators: [
      'master plumber on every job (not apprentices)',
      'flat-rate quotes given before work starts',
      '24/7 emergency availability',
      'family-run, second-generation',
    ],
  },
  reviews: [
    {
      author: 'Linda M.',
      rating: 5,
      text:
        "Dan came out on a Sunday morning when our basement was flooding. He didn't try to upsell us — just fixed the sump and showed us what failed. Total pro.",
      relativeTime: '2 weeks ago',
      publishTime: '2026-05-04T00:00:00Z',
    },
    {
      author: 'Robert T.',
      rating: 5,
      text:
        "Quoted me $1,800 for a water heater. Three other plumbers wanted $2,400+. Same brand, same warranty. Dan's been our guy for six years now.",
      relativeTime: 'a month ago',
      publishTime: '2026-04-15T00:00:00Z',
    },
    {
      author: 'Anita P.',
      rating: 5,
      text:
        "He found a pinhole leak in our copper that two other companies missed. Walked me through every step. I trust him with anything plumbing now.",
      relativeTime: '2 months ago',
      publishTime: '2026-03-10T00:00:00Z',
    },
    {
      author: 'Greg H.',
      rating: 5,
      text:
        "Replaced our old galvanized line to the street. Crew was on time, polite, cleaned up the lawn after they trenched. Price was exactly what was quoted.",
      relativeTime: '3 months ago',
      publishTime: '2026-02-20T00:00:00Z',
    },
    {
      author: 'Susan K.',
      rating: 4,
      text:
        "Had to wait two days for an appointment which was the only downside. But the work was excellent — new toilet install and they fixed the wax ring leak the previous plumber missed.",
      relativeTime: '4 months ago',
      publishTime: '2026-01-18T00:00:00Z',
    },
  ],
  brand_attributes: [
    { category: 'positioning', value: 'The plumber you call when you want it done right the first time.', source: 'operator' },
    { category: 'certification', value: 'WI Master Plumber License #234567', source: 'operator' },
    { category: 'certification', value: 'Bradford White Pro Service partner (water heaters)', source: 'operator' },
    { category: 'differentiator', value: 'Family-run since 2008, second-generation Kovacs plumbers.', source: 'operator' },
    { category: 'value', value: 'Flat-rate quotes — no hourly surprise.', source: 'operator' },
  ],
  testimonials: [
    {
      author_name: 'Linda M.',
      author_location: 'Cedarburg, WI',
      quote:
        "Dan came out on a Sunday morning when our basement was flooding. He didn't try to upsell us — just fixed the sump and showed us what failed. Total pro.",
      rating: 5,
      source: 'google',
      is_featured: true,
    },
    {
      author_name: 'Robert T.',
      author_location: 'Mequon, WI',
      quote:
        "Quoted me $1,800 for a water heater. Three other plumbers wanted $2,400+. Same brand, same warranty. Dan's been our guy for six years now.",
      rating: 5,
      source: 'google',
      is_featured: true,
    },
  ],
  scrape_data: null, // pre-scrape (homepage_demo timeframe) or scrape didn't run
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { mode, model } = parseArgs(process.argv);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY env var not set.');
    process.exit(1);
  }

  const { system, user } = buildMasterBriefPrompt(TEST_INPUT, mode);

  console.error(`[test-master-brief] mode=${mode} model=${model}`);
  console.error(`[test-master-brief] system prompt: ${system.length} chars`);
  console.error(`[test-master-brief] user prompt:   ${user.length} chars`);
  console.error(`[test-master-brief] calling Claude…`);

  const start = Date.now();
  const result = await callClaude(apiKey, user, {
    model,
    systemPrompt: system,
    cacheSystem: true,
    maxTokens: 8000,
    temperature: 0.4,
    timeoutMs: 90_000,
  });
  const elapsed = Date.now() - start;

  console.error(`[test-master-brief] done in ${elapsed}ms, ${result.length} chars`);
  console.error('---');
  process.stdout.write(result);
  process.stdout.write('\n');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
