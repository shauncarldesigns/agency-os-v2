import { Hono } from 'hono';
import type { Env } from '../types';
import {
  listScripts,
  listObjectionsByCategory,
  listFollowUps,
  getScript,
  getObjection,
  getFollowUp,
  type LeadContext,
} from '../services/playbook';
import { callClaudeJson } from '../services/claude';
import { rebuttalGenPrompt } from '../prompts/rebuttalGen';
import { log } from '../utils/errors';

// Haiku — fast + cheap + honors temperature. Good fit for short rebuttal
// generation where variety matters more than nuance.
const REBUTTAL_MODEL = 'claude-haiku-4-5-20251001';

export const playbookRouter = new Hono<{ Bindings: Env }>();

// Parser errors (frontmatter/body mismatch in a .md file) used to bubble
// up as the generic Hono 500 "Internal server error", which the dashboard
// then showed as "Could not load playbook content: Internal server
// error" with no clue which file was broken. Surface the actual error
// message so the operator can fix the markdown without grepping logs.
playbookRouter.onError((err, c) => {
  log('error', 'playbook', 'parse/load failed', err);
  return c.json({ error: `Playbook parse error: ${err.message}` }, 422);
});

// Sanity endpoint — eagerly parses every playbook file. Returns counts
// and full IDs so the operator can curl after deploy and confirm the
// runtime sees what's on disk.
playbookRouter.get('/_debug', (c) => {
  const scripts = listScripts();
  const objectionsByCategory = listObjectionsByCategory();
  const followUps = listFollowUps();
  return c.json({
    scripts: { count: scripts.length, items: scripts },
    objections: {
      counts: {
        standard: objectionsByCategory.standard.length,
        'deep-dive': objectionsByCategory['deep-dive'].length,
        closing: objectionsByCategory.closing.length,
      },
      by_category: objectionsByCategory,
    },
    follow_ups: { count: followUps.length, items: followUps.map((f) => ({ id: f.id, label: f.label, touch_count: f.touches.length })) },
  });
});

playbookRouter.get('/scripts', (c) => c.json({ scripts: listScripts() }));

playbookRouter.get('/scripts/:id', (c) => {
  const script = getScript(c.req.param('id'));
  if (!script) return c.json({ error: 'Script not found' }, 404);
  return c.json({ script });
});

playbookRouter.get('/objections', (c) => {
  return c.json({ by_category: listObjectionsByCategory() });
});

playbookRouter.get('/objections/:id', (c) => {
  const objection = getObjection(c.req.param('id'));
  if (!objection) return c.json({ error: 'Objection not found' }, 404);
  return c.json({ objection });
});

playbookRouter.get('/follow-ups/:id', (c) => {
  const sequence = getFollowUp(c.req.param('id'));
  if (!sequence) return c.json({ error: 'Follow-up not found' }, 404);
  return c.json({ sequence });
});

// ============================================================================
// GENERATE-REBUTTAL — fresh Claude variants when stock didn't land
// ============================================================================

interface GenerateRebuttalRequest {
  objection_id: string;
  lead_id?: number;
  lead_context: LeadContext;
  current_stage?: string;
  call_duration_seconds?: number;
  free_text_notes?: string;
  stock_rebuttal_already_tried: string;
  why_it_didnt_land?: string;
}

interface RebuttalVariant {
  angle: string;
  rebuttal: string;
}

interface ClaudeRebuttalResponse {
  variants: RebuttalVariant[];
}

function validateVariants(parsed: unknown): RebuttalVariant[] {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Response is not an object');
  }
  const variants = (parsed as ClaudeRebuttalResponse).variants;
  if (!Array.isArray(variants) || variants.length !== 3) {
    throw new Error(`Expected 3 variants, got ${Array.isArray(variants) ? variants.length : 'non-array'}`);
  }
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (!v || typeof v.angle !== 'string' || typeof v.rebuttal !== 'string') {
      throw new Error(`Variant ${i} missing angle or rebuttal string`);
    }
  }
  return variants;
}

async function logGeneration(
  db: D1Database,
  req: GenerateRebuttalRequest,
  response: ClaudeRebuttalResponse | null,
  model: string,
  status: 'success' | 'parse_error' | 'api_error',
  errorMessage: string | null,
  durationMs: number
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO playbook_generations
        (lead_id, objection_id, request_json, response_json, model, duration_ms, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      req.lead_id ?? null,
      req.objection_id,
      JSON.stringify(req),
      response ? JSON.stringify(response) : null,
      model,
      durationMs,
      status,
      errorMessage
    )
    .run();
  return result.meta.last_row_id;
}

playbookRouter.post('/generate-rebuttal', async (c) => {
  const start = Date.now();
  const body = await c.req.json<GenerateRebuttalRequest>();

  if (!body.objection_id || !body.lead_context?.company || !body.stock_rebuttal_already_tried) {
    return c.json(
      { error: 'Missing required fields: objection_id, lead_context.company, stock_rebuttal_already_tried' },
      400
    );
  }

  const objection = getObjection(body.objection_id);
  if (!objection) {
    return c.json({ error: `Unknown objection_id: ${body.objection_id}` }, 400);
  }

  const prompt = rebuttalGenPrompt({
    objection_label: objection.label,
    lead_context: body.lead_context,
    current_stage: body.current_stage,
    call_duration_seconds: body.call_duration_seconds,
    free_text_notes: body.free_text_notes,
    stock_rebuttal_already_tried: body.stock_rebuttal_already_tried,
    why_it_didnt_land: body.why_it_didnt_land,
  });

  let parsed: ClaudeRebuttalResponse;
  try {
    parsed = await callClaudeJson<ClaudeRebuttalResponse>(c.env.CLAUDE_API_KEY, prompt, {
      model: REBUTTAL_MODEL,
      maxTokens: 1024,
      temperature: 0.85,
      timeoutMs: 25_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isParseErr = /JSON|parse/i.test(msg);
    const status = isParseErr ? 'parse_error' : 'api_error';
    await logGeneration(c.env.DB, body, null, REBUTTAL_MODEL, status, msg, Date.now() - start);
    log('error', 'playbook', `generate-rebuttal ${status}`, msg);
    return c.json({ error: 'Failed to generate rebuttal', code: status.toUpperCase() }, 500);
  }

  let variants: RebuttalVariant[];
  try {
    variants = validateVariants(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logGeneration(c.env.DB, body, parsed, REBUTTAL_MODEL, 'parse_error', msg, Date.now() - start);
    log('error', 'playbook', 'generate-rebuttal validation failed', msg);
    return c.json({ error: 'Generated response failed validation', code: 'VALIDATION_FAILED' }, 500);
  }

  const duration = Date.now() - start;
  const responseObj: ClaudeRebuttalResponse = { variants };
  const generationId = await logGeneration(
    c.env.DB,
    body,
    responseObj,
    REBUTTAL_MODEL,
    'success',
    null,
    duration
  );

  return c.json({
    generation_id: generationId,
    variants,
    generated_at: new Date().toISOString(),
    model: REBUTTAL_MODEL,
  });
});

// Marks which variant the operator clicked "Use this" on. Drives the
// future handled-rate analysis when promoting variants back to markdown.
playbookRouter.post('/generations/:id/mark-used', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid generation id' }, 400);
  const { variant_index } = await c.req.json<{ variant_index: number }>();
  if (!Number.isInteger(variant_index) || variant_index < 0 || variant_index > 2) {
    return c.json({ error: 'variant_index must be 0, 1, or 2' }, 400);
  }
  await c.env.DB.prepare(`UPDATE playbook_generations SET used_variant_index = ? WHERE id = ?`)
    .bind(variant_index, id)
    .run();
  return c.json({ ok: true });
});
