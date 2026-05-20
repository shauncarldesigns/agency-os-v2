// Claude prompt to generate the executive-summary narrative for a Tier 3 monthly report.
// CRITICAL: must NEVER reference "Merchynt" — this is white-labeled to the client.

export interface ExecSummaryInput {
  businessName: string;
  city: string | null;
  period: string;             // "April 2026"
  current: { impressions: number; clicks: number; avgPosition: number; ctr: number };
  previous: { impressions: number; clicks: number; avgPosition: number; ctr: number } | null;
  topKeywordWins: Array<{ query: string; previousPosition: number | null; currentPosition: number }>;
  pagesBuiltThisMonth: Array<{ service?: string; city?: string; type: string }>;
  pagesPlannedNextMonth?: number;
}

export function buildExecSummaryPrompt(input: ExecSummaryInput): string {
  const fmtPct = (cur: number, prev: number) => prev > 0 ? `${(((cur - prev) / prev) * 100).toFixed(1)}%` : 'NEW';
  const lines: string[] = [];

  lines.push(`Current month (${input.period}):`);
  lines.push(`- Impressions: ${input.current.impressions.toLocaleString()}`);
  lines.push(`- Clicks: ${input.current.clicks.toLocaleString()}`);
  lines.push(`- Avg Position: ${input.current.avgPosition.toFixed(1)}`);
  lines.push(`- CTR: ${(input.current.ctr * 100).toFixed(2)}%`);

  if (input.previous) {
    lines.push('');
    lines.push('vs. previous month:');
    lines.push(`- Impressions ${fmtPct(input.current.impressions, input.previous.impressions)}`);
    lines.push(`- Clicks ${fmtPct(input.current.clicks, input.previous.clicks)}`);
    lines.push(`- Avg position changed by ${(input.previous.avgPosition - input.current.avgPosition).toFixed(1)} spots (lower = better)`);
  }

  if (input.topKeywordWins.length > 0) {
    lines.push('');
    lines.push('Top keyword movement:');
    for (const k of input.topKeywordWins.slice(0, 5)) {
      const change = k.previousPosition === null
        ? `NEW at #${Math.round(k.currentPosition)}`
        : `from #${Math.round(k.previousPosition)} to #${Math.round(k.currentPosition)}`;
      lines.push(`- "${k.query}" — ${change}`);
    }
  }

  if (input.pagesBuiltThisMonth.length > 0) {
    lines.push('');
    lines.push('Pages built this month:');
    for (const p of input.pagesBuiltThisMonth.slice(0, 8)) {
      const label = p.type === 'service-area' && p.service && p.city
        ? `${p.service} in ${p.city}`
        : p.type;
      lines.push(`- ${label}`);
    }
  }

  return `You are writing the executive summary paragraph for the monthly SEO report we send to ${input.businessName}${input.city ? ` in ${input.city}` : ''}.

This is a CLIENT-FACING document. The client is the small-business owner. Rules:
- Never use the word "Merchynt" or reference any third-party vendor by name.
- Describe work generically: "we added pages", "we updated GBP", "we responded to reviews".
- Plain English at a 7th-grade reading level. Active voice. No marketing fluff.
- 2-4 sentences. Lead with the biggest single win. Include one specific number to make it concrete.
- If a metric got worse, say so honestly and add one sentence about what we're doing about it.
- End with a forward-looking sentence about next month if relevant.

Data for ${input.period}:
${lines.join('\n')}

Output ONLY the executive-summary paragraph as plain text. No headers, no bullet points, no markdown.`;
}
