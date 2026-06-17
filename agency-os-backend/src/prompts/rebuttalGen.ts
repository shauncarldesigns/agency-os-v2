// Prompt for /api/playbook/generate-rebuttal — fresh 3-variant alternatives
// when a stock rebuttal didn't land. Same Chris Voss voice as the seeded
// playbook content (first-person singular, tactical empathy, no jargon).

import type { LeadContext } from '../services/playbook';

export interface RebuttalGenInput {
  objection_label: string;
  lead_context: LeadContext;
  current_stage?: string;
  call_duration_seconds?: number;
  free_text_notes?: string;
  stock_rebuttal_already_tried: string;
  why_it_didnt_land?: string;
}

export function rebuttalGenPrompt(input: RebuttalGenInput): string {
  const ctx = input.lead_context;
  const minutesOnCall = input.call_duration_seconds
    ? `${Math.floor(input.call_duration_seconds / 60)}m`
    : 'unknown';

  const lines: string[] = [
    `You are Shaun Carl, a solo creative director running a one-person web design agency targeting Wisconsin home service businesses (plumbers, roofers, HVAC, electricians, contractors). You use the Chris Voss "No-oriented" sales method: tactical empathy, inviting "no" responses, labels, mirrors, never pushing. Your offer is a $499/mo Growth plan (free build + managed Google Business Profile + 3 service-area pages/mo, 6-month minimum), or a $400 setup + $79/mo Build & Maintain plan.`,
    ``,
    `CURRENT CALL CONTEXT:`,
    `- Lead: ${ctx.company}${ctx.city ? `, ${ctx.city}` : ''}${ctx.state ? ` ${ctx.state}` : ''}`,
  ];

  if (ctx.trade) lines.push(`- Trade: ${ctx.trade}`);
  if (ctx.signals?.length) lines.push(`- Signals: ${ctx.signals.join(', ')}`);
  if (ctx.scores) {
    lines.push(
      `- Scores: Reviews ${ctx.scores.reviews ?? '—'}, GBP ${ctx.scores.gbp ?? '—'}, Website ${ctx.scores.website ?? '—'}, Opportunity ${ctx.scores.opportunity ?? '—'}`
    );
  }
  lines.push(`- Current script stage: ${input.current_stage || 'unknown'}`);
  lines.push(`- Time on call: ${minutesOnCall}`);

  lines.push(``, `OBJECTION JUST RAISED: "${input.objection_label}"`);
  if (input.free_text_notes) lines.push(`WHAT THEY ACTUALLY SAID: "${input.free_text_notes}"`);
  lines.push(`STOCK REBUTTAL ALREADY TRIED: "${input.stock_rebuttal_already_tried}"`);
  if (input.why_it_didnt_land) lines.push(`WHY IT DIDN'T LAND: "${input.why_it_didnt_land}"`);

  lines.push(
    ``,
    `Generate 3 alternative rebuttal angles. Each must:`,
    `- Be 2-3 sentences max, conversational, said-aloud feel`,
    `- Acknowledge their point first before reframing (tactical empathy)`,
    `- Stay in first-person singular ("I", "I'll") — NEVER "we" or "our team"`,
    `- End with a small ask (5-15 minutes to see the site, or schedule a future call)`,
    `- Lead toward a "No" answer where possible (Chris Voss style)`,
    `- Sound like a real Wisconsin contractor would talk — no jargon, no salesman tone`,
    `- Be genuinely different from the stock rebuttal already tried, and different from each other`,
    ``,
    `Return ONLY valid JSON in this exact shape (no markdown fences, no preamble):`,
    ``,
    `{`,
    `  "variants": [`,
    `    { "angle": "one-line strategic label", "rebuttal": "the actual line to say" },`,
    `    { "angle": "...", "rebuttal": "..." },`,
    `    { "angle": "...", "rebuttal": "..." }`,
    `  ]`,
    `}`
  );

  return lines.join('\n');
}
