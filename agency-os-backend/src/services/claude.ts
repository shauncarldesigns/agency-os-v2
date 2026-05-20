import { log } from '../utils/errors';

const HAIKU = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';

export interface ClaudeCallOptions {
  model?: string;
  systemPrompt?: string;
  cacheSystem?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export async function callClaude(
  apiKey: string,
  userPrompt: string,
  opts: ClaudeCallOptions = {}
): Promise<string> {
  const start = Date.now();
  const model = opts.model ?? HAIKU;
  const maxTokens = opts.maxTokens ?? 4096;

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.systemPrompt) {
    body.system = opts.cacheSystem
      ? [{ type: 'text', text: opts.systemPrompt, cache_control: { type: 'ephemeral' } }]
      : opts.systemPrompt;
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
  };

  const elapsed = Date.now() - start;
  const u = data.usage;
  log('info', 'claude', `${model} ${elapsed}ms`, {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
  });

  const textBlock = data.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in Claude response');
  return textBlock.text;
}

export async function callClaudeJson<T = unknown>(
  apiKey: string,
  userPrompt: string,
  opts: ClaudeCallOptions = {}
): Promise<T> {
  const raw = await callClaude(apiKey, userPrompt, opts);
  try {
    return JSON.parse(raw) as T;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude did not return valid JSON');
    return JSON.parse(match[0]) as T;
  }
}
