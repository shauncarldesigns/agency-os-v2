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
} from '../agency-os-backend/src/prompts/masterBrief';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

function parseArgs(argv: string[]): { model: string } {
  let model = DEFAULT_MODEL;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--mode=')) {
      // Legacy flag from v2.1; the master prompt no longer branches on mode.
      // Ignore silently so existing wrappers don't break.
      continue;
    } else if (arg.startsWith('--model=')) {
      model = arg.split('=')[1];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { model };
}

// ---------------------------------------------------------------------------
// Test fixture: Beno Plumbing (real Green Bay, WI lead — actual enriched data)
//
// This mirrors the operator-form state RIGHT AFTER signing, where most
// structured fields are still empty and we expect the prompt to emit
// per-field [TBD: <field>] tokens for the operator to fill inline.
// ---------------------------------------------------------------------------

const TEST_INPUT: MasterBriefInput = {
  project: {
    business_name: 'Beno Plumbing',
    city: 'Green Bay',
    state: 'WI',
    phone: '(920) 468-4777',
    email: null,                       // intentionally missing → [TBD: email]
    website: 'https://www.benoplumbing.com/',
    founded_year: null,                // → [TBD: founded year]
    owner_name: null,                  // multiple owners — operator picks lead → [TBD: owner name]
    owner_credentials: null,           // → [TBD: owner credentials]
    tagline: null,                     // → [TBD: tagline]
    primary_color: null,               // → [TBD: primary color]
    accent_color: null,                // → [TBD: accent color]
    photography_direction: null,       // → [TBD: photography direction]
    monthly_pages_target: 0,
    tier: 'tier_2',
  },
  mined: {
    services_performed: [
      'Complete house renovation plumbing',
      'Tankless water heater installation',
      'Water heater replacement',
      'Kitchen and bath remodel plumbing',
      'Water heater repair',
      'Leaking water heater replacement',
      'General plumbing repairs',
    ],
    service_areas: ['Green Bay', 'GB area'],
    owner_names: ['Kory', 'Brad', 'Corey', 'Dustin'],
    strengths: [
      'Quick scheduling and responsiveness',
      'On-time arrival and punctuality',
      'Professional craftsmanship and quality work',
      'Customer-centric problem-solving (troubleshooting before service calls)',
      'Manufacturer advocacy and warranty support',
      'Attention to detail and going above and beyond',
    ],
    pitch_quotes: [
      {
        author: 'Tom Wiesner',
        location: 'Green Bay',
        quote: 'Beno was in our corner communicating with the manufacturer and eventually the manufacturer broke down and gave us a new unit... I would recommend them as a fine local company with very knowledgeable employees.',
        why: 'Demonstrates willingness to fight for customers even outside warranty period, building trust and loyalty.',
      },
      {
        author: 'Pete Warmenhoven',
        location: 'Green Bay',
        quote: 'Rather than try to sell me a new one or book a service call right away, he gave me troubleshooting advice and we determined it was plugged into a bad circuit breaker. I really appreciate that he saved me the cost and wait for a service trip.',
        why: 'Shows integrity and customer-first mentality that differentiates from competitors focused on upselling.',
      },
      {
        author: 'Jared Olsen',
        location: 'Green Bay',
        quote: 'Always responded quickly and gave me options on my project so I could get exactly what I needed with the budget I had. The craftsmanship quality was top notch.',
        why: 'Combines responsiveness, flexibility, and quality—three critical decision factors for renovation projects.',
      },
      {
        author: 'SchoeME',
        location: 'Green Bay',
        quote: "He wasn't cussing or angry and he even cleaned some dirt and spiderwebs up while he was in our old basement... Above and beyond fasho!",
        why: 'Authentic voice highlighting professionalism and unexpected service recovery that creates word-of-mouth momentum.',
      },
      {
        author: 'Robin H',
        location: 'Green Bay',
        quote: 'Kory got me scheduled very quickly for a water heater replacement and some other issues. Brad showed up precisely on time and did an excellent job with the installation and repairs, in a very timely manner.',
        why: 'Stacks multiple value propositions (speed, punctuality, quality) in one customer journey.',
      },
    ],
    differentiators: [],
  },
  reviews: [
    {
      author: 'Jared Olsen',
      rating: 5,
      text: 'Beno helped me with a complete house renovation and did an outstanding job. From the earliest stages of the project, Kory was great to work with. Always responded quickly and gave me options on my project so I could get exactly what I needed with the budget I had. The craftsmanship quality was top notch. One of the jobs they did was install a tankless water heater. What a great investment! Saves water and heating costs. If you need any plumbing services done in the GB area I recommend Beno.',
      relativeTime: '4 months ago',
      publishTime: '2025-12-22T12:48:15.925Z',
    },
    {
      author: 'Tom Wiesner',
      rating: 5,
      text: 'Purchased a Tankless hot Water heater from Bemo plumbing a few years back. The heater worked fine until one day it started heating the water intermittently, going from hot to ice cold and back to hot. Although the unit\'s warranty was out of date, Beno worked with us and the manufacturer to repair it. Beno was in our corner communicating with the manufacturer and eventually the manufacturer broke down and gave us a new unit. We were more than impressed! The new unit was installed and it has been working fine for well over a year now. Beno also worked with our contractor on our kitchen and bath remodel and did a great job. I would recommend them as a fine local company with very knowledgeable employees.',
      relativeTime: '3 months ago',
      publishTime: '2026-01-13T22:20:31.741Z',
    },
    {
      author: 'Robin H',
      rating: 5,
      text: 'AWESOME! Kory got me scheduled very quickly for a water heater replacement and some other issues. Brad showed up precisely on time and did an excellent job with the installation and repairs, in a very timely manner. These guys are great!',
      relativeTime: '3 months ago',
      publishTime: '2026-01-28T16:38:13.898Z',
    },
    {
      author: 'Pete Warmenhoven',
      rating: 5,
      text: 'We purchased our water heater from Beno in 2019. It stopped working yesterday so I called Beno and spoke with Corey. Rather than try to sell me a new one or book a service call right away, he gave me troubleshooting advice and we determined it was plugged into a bad circuit breaker. I really appreciate that he saved me the cost and wait for a service trip and we got it working with just a phone call! Thanks, Corey!',
      relativeTime: '3 months ago',
      publishTime: '2026-01-21T16:44:38.844Z',
    },
    {
      author: 'SchoeME',
      rating: 5,
      text: "Over this past week, we had to call Beno for a leaking water heater. Dustin came out the next day and did a very professional job replacing it. He wasn't cussing or angry and he even cleaned some dirt and spiderwebs up while he was in our old basement... Above and beyond fasho! Will definitely go through Beno again!",
      relativeTime: '3 months ago',
      publishTime: '2026-01-22T21:26:38.073Z',
    },
  ],
  brand_attributes: [],   // empty — operator hasn't supplied extras yet
  testimonials: [],       // empty — operator hasn't curated yet; prompt should fall back to raw reviews
  scrape_data: null,      // scrape not run yet at form-open time
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { model } = parseArgs(process.argv);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY env var not set.');
    process.exit(1);
  }

  const { system, user } = buildMasterBriefPrompt(TEST_INPUT);

  console.error(`[test-master-brief] model=${model}`);
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
