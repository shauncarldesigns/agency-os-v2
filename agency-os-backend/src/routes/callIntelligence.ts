import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, notFound, serverError } from '../utils/errors';
import { enqueueCallAnalysis, enqueueUnprocessedRecordings, processCallIntelligenceJobs } from '../services/callIntelligence';

export const callIntelligenceRouter = new Hono<{ Bindings: Env }>();

function operatorOutcomeClass(value: unknown): string | null {
  const outcome = String(value ?? '').toLowerCase().replaceAll('_', ' ').trim();
  if (!outcome || outcome === 'recording') return null;
  if (outcome.includes('not interested')) return 'rejected';
  if (outcome.includes('email') && (outcome.includes('captur') || outcome.includes('saved'))) return 'email_captured';
  if (outcome.includes('booked') || outcome.includes('qualified for tier')) return 'meeting_booked';
  if (outcome === 'sold' || outcome.includes('signed')) return 'sold';
  if (outcome.includes('callback') || outcome.includes('follow up') || outcome.includes('talk later')) return 'follow_up';
  if (outcome.includes('spoke') || outcome === 'interested' || outcome.includes('feedback')) return 'conversation';
  return null;
}

function reconcileOutcome(operatorOutcome: unknown, analysis: unknown): { status: 'matched'|'mismatch'|'unclear'; operator_class: string | null; analysis_class: string | null } {
  const operatorClass = operatorOutcomeClass(operatorOutcome);
  const analysisClass = analysis && typeof analysis === 'object' ? String((analysis as Record<string, unknown>).outcome ?? '') || null : null;
  if (!operatorClass || !analysisClass || analysisClass === 'unknown') return { status: 'unclear', operator_class: operatorClass, analysis_class: analysisClass };
  return { status: operatorClass === analysisClass ? 'matched' : 'mismatch', operator_class: operatorClass, analysis_class: analysisClass };
}

callIntelligenceRouter.post('/backfill', async c => {
  if (!c.env.OPENAI_API_KEY && c.env.CALL_INTELLIGENCE_TEST_MODE !== 'mock') {
    return c.json({ error: 'OPENAI_API_KEY is not configured', code: 'PROVIDER_NOT_CONFIGURED' }, 409);
  }
  const queued = await enqueueUnprocessedRecordings(c.env.DB);
  c.executionCtx.waitUntil(processCallIntelligenceJobs(c.env, 2, true));
  return c.json({ queued, status: 'processing' }, 202);
});

callIntelligenceRouter.post('/calls/:id/process', async c => {
  const callId = Number(c.req.param('id'));
  if (!Number.isInteger(callId) || callId < 1) return c.json(badRequest('Invalid call ID'), 400);
  const call = await c.env.DB.prepare('SELECT id, recording_url FROM call_log WHERE id=?').bind(callId).first<{ id: number; recording_url: string | null }>();
  if (!call) return c.json(notFound('Call'), 404);
  if (!call.recording_url && c.env.CALL_INTELLIGENCE_TEST_MODE !== 'mock') return c.json(badRequest('Call has no recording'), 400);
  if (!c.env.OPENAI_API_KEY && c.env.CALL_INTELLIGENCE_TEST_MODE !== 'mock') return c.json({ error: 'OPENAI_API_KEY is not configured', code: 'PROVIDER_NOT_CONFIGURED' }, 409);
  const body = await c.req.json().catch(() => ({})) as { force?: boolean };
  try {
    const jobId = await enqueueCallAnalysis(c.env.DB, callId, body.force === true);
    c.executionCtx.waitUntil(processCallIntelligenceJobs(c.env, 1, true));
    return c.json({ job_id: jobId, status: 'queued' }, 202);
  } catch (error) { return c.json(serverError((error as Error).message), 500); }
});

callIntelligenceRouter.post('/calls/:id/retry', async c => {
  const callId = Number(c.req.param('id'));
  const result = await c.env.DB.prepare(`UPDATE call_intelligence_jobs SET status='queued', error=NULL, locked_at=NULL, updated_at=datetime('now') WHERE call_id=? AND status='failed'`).bind(callId).run();
  if (!result.meta.changes) return c.json(badRequest('No failed job to retry'), 400);
  c.executionCtx.waitUntil(processCallIntelligenceJobs(c.env, 1, true));
  return c.json({ status: 'queued' }, 202);
});

callIntelligenceRouter.get('/calls/:id/report', async c => {
  const callId = Number(c.req.param('id'));
  const job = await c.env.DB.prepare(`SELECT status,error,attempt_count,updated_at FROM call_intelligence_jobs WHERE call_id=? ORDER BY id DESC LIMIT 1`).bind(callId).first();
  const transcript = await c.env.DB.prepare(`SELECT provider,model,language,duration_seconds,shaun_speaker,transcript_json,transcript_text,updated_at FROM call_transcripts WHERE call_id=?`).bind(callId).first<Record<string, unknown>>();
  const analysis = await c.env.DB.prepare(`SELECT id,provider,model,analysis_prompt_version,analysis_schema_version,analysis_json,created_at FROM call_analyses WHERE call_id=? AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1`).bind(callId).first<Record<string, unknown>>();
  return c.json({ job, transcript: transcript ? { ...transcript, transcript_json: JSON.parse(String(transcript.transcript_json)) } : null, analysis: analysis ? { ...analysis, analysis_json: JSON.parse(String(analysis.analysis_json)) } : null });
});

callIntelligenceRouter.get('/insights', async c => {
  const callType = c.req.query('call_type');
  const industry = c.req.query('industry');
  const outcome = c.req.query('outcome');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const filters: string[] = ['a.superseded_at IS NULL'];
  const values: unknown[] = [];
  if (callType) { filters.push('a.call_type=?'); values.push(callType); }
  if (industry) { filters.push('l.industry=?'); values.push(industry); }
  if (outcome) { filters.push('a.outcome=?'); values.push(outcome); }
  if (from) { filters.push('c.created_at>=?'); values.push(from); }
  if (to) { filters.push('c.created_at<?'); values.push(`${to} 23:59:59`); }
  const where = filters.join(' AND ');
  const summary = await c.env.DB.prepare(`SELECT COUNT(*) calls_analyzed, SUM(CASE WHEN a.outcome='meeting_booked' THEN 1 ELSE 0 END) meetings_booked, SUM(CASE WHEN a.outcome='sold' THEN 1 ELSE 0 END) sold, SUM(CASE WHEN a.outcome='rejected' OR LOWER(REPLACE(c.outcome,'_',' '))='not interested' THEN 1 ELSE 0 END) not_interested FROM call_analyses a JOIN call_log c ON c.id=a.call_id JOIN leads l ON l.id=c.lead_id WHERE ${where}`).bind(...values).first();
  const outcomes = await c.env.DB.prepare(`SELECT a.outcome label,COUNT(*) count FROM call_analyses a JOIN call_log c ON c.id=a.call_id JOIN leads l ON l.id=c.lead_id WHERE ${where} GROUP BY a.outcome ORDER BY count DESC`).bind(...values).all();
  const facts = await c.env.DB.prepare(`SELECT f.fact_type,f.category,f.reaction,COUNT(DISTINCT f.call_id) supporting_calls,ROUND(100.0*COUNT(DISTINCT f.call_id)/(SELECT MAX(1,COUNT(DISTINCT a2.call_id)) FROM call_analyses a2 JOIN call_log c2 ON c2.id=a2.call_id JOIN leads l2 ON l2.id=c2.lead_id WHERE a2.superseded_at IS NULL),1) percentage,MIN(f.call_id) representative_call_id,MIN(f.quote) quote,MIN(f.timestamp) timestamp FROM call_analysis_facts f JOIN call_analyses a ON a.id=f.analysis_id JOIN call_log c ON c.id=a.call_id JOIN leads l ON l.id=c.lead_id WHERE ${where} GROUP BY f.fact_type,f.category,f.reaction ORDER BY supporting_calls DESC LIMIT 100`).bind(...values).all();
  const jobs = await c.env.DB.prepare(`SELECT j.id,j.call_id,j.status,j.attempt_count,j.error,j.updated_at,l.id lead_id,l.company,c.outcome,a.analysis_json FROM call_intelligence_jobs j JOIN call_log c ON c.id=j.call_id JOIN leads l ON l.id=c.lead_id LEFT JOIN call_analyses a ON a.call_id=j.call_id AND a.superseded_at IS NULL ORDER BY j.updated_at DESC LIMIT 25`).all<Record<string, unknown>>();
  const jobRows = (jobs.results ?? []).map(row => {
    const analysis = row.analysis_json ? JSON.parse(String(row.analysis_json)) as Record<string, unknown> : null;
    return { ...row, analysis, outcome_reconciliation: reconcileOutcome(row.outcome, analysis), analysis_json: undefined };
  });
  return c.json({ summary, outcomes: outcomes.results, findings: facts.results, jobs: jobRows, sample: { call_type: callType ?? null, industry: industry ?? null, outcome: outcome ?? null, from: from ?? null, to: to ?? null }, directional: Number((summary as { calls_analyzed?: number } | null)?.calls_analyzed ?? 0) < 20 });
});
