import type { Env } from '../types';
import { callClaudeJson } from './claude';
import { log } from '../utils/errors';
import { recordingKeyFromValue } from '../utils/recordings';
import { buildCallAnalysisPrompt, callAnalysisSystemPrompt, CALL_ANALYSIS_MODEL, CALL_ANALYSIS_PROMPT_VERSION, CALL_ANALYSIS_SCHEMA_VERSION } from '../prompts/callAnalysis';
import { validateCallAnalysis, type AnalysisRecord } from './callAnalysisSchema';

interface Job { id: number; call_id: number; requested_prompt_version: string }
interface CallContext { id: number; lead_id: number; recording_url: string | null; outcome: string; created_at: string; call_approach: string | null; company: string; contact: string | null; industry: string | null; city: string | null; state: string | null; status: string; pipeline_status: string }
interface Utterance { speaker: number; start: number; end: number; transcript: string }
interface TranscriptResult { provider: string; model: string; language: string | null; duration: number | null; shaunSpeaker: number; utterances: Utterance[] }

const MOCK_ANALYSIS: AnalysisRecord = {
  call_summary: 'Safe test-mode call analysis.', call_type: 'cold_call', outcome: 'conversation', outcome_confidence: 0.8,
  prospect_situation: 'The prospect is evaluating visibility options.', stated_needs: ['More calls from Google'],
  inferred_needs: [], objections: [], buying_signals: [], benefits_discussed: [],
  strongest_moment: { description: 'Prospect states the desired outcome.', timestamp: '00:03' },
  call_lost_moment: { description: '', timestamp: '' }, what_shaun_did_well: ['Asked about the desired business outcome.'],
  improvements: [], missed_follow_up_questions: [], recommended_next_action: 'Confirm a follow-up time.',
  recommended_follow_up_message: 'Thanks for the conversation. I will follow up with the Google visibility options we discussed.',
  scores: { opening: 75, rapport: null, discovery: 70, listening: 80, objection_handling: null, clarity: 75, close: 65, overall: 73 },
  important_quotes: [{ speaker: 'Prospect', quote: 'We need more calls from Google.', timestamp: '00:03', why_it_matters: 'It is an explicit need.' }],
};

function stamp(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function transcriptText(result: TranscriptResult): string {
  return result.utterances.map(u => `[${stamp(u.start)}] ${u.speaker === result.shaunSpeaker ? 'Shaun' : 'Prospect'}: ${u.transcript}`).join('\n');
}

async function existingTranscript(db: D1Database, callId: number): Promise<TranscriptResult | null> {
  const row = await db.prepare(`SELECT provider,model,language,duration_seconds,shaun_speaker,transcript_json FROM call_transcripts WHERE call_id=?`).bind(callId).first<{
    provider: string; model: string; language: string | null; duration_seconds: number | null; shaun_speaker: number; transcript_json: string;
  }>();
  if (!row) return null;
  const utterances = JSON.parse(row.transcript_json) as Utterance[];
  if (!Array.isArray(utterances) || !utterances.length) return null;
  return { provider: row.provider, model: row.model, language: row.language, duration: row.duration_seconds, shaunSpeaker: row.shaun_speaker, utterances };
}

async function transcribe(env: Env, call: CallContext): Promise<TranscriptResult> {
  if (env.CALL_INTELLIGENCE_TEST_MODE === 'mock') return { provider: 'mock', model: 'fixture-v1', language: 'en', duration: 8, shaunSpeaker: 0, utterances: [
    { speaker: 0, start: 0, end: 2.8, transcript: 'What would help your business most right now?' },
    { speaker: 1, start: 3, end: 6, transcript: 'We need more calls from Google.' },
  ] };
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const key = recordingKeyFromValue(call.recording_url);
  if (!key) throw new Error('Call has no valid R2 recording');
  const audio = await env.RECORDINGS.get(key);
  if (!audio) throw new Error('Recording not found in R2');

  const model = env.CALL_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe-diarize';
  const contentType = audio.httpMetadata?.contentType || 'application/octet-stream';
  const extension = key.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'webm';
  const form = new FormData();
  form.append('file', new File([await audio.arrayBuffer()], `call.${extension}`, { type: contentType }));
  form.append('model', model);
  form.append('response_format', 'diarized_json');
  form.append('chunking_strategy', 'auto');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`OpenAI transcription error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json() as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ speaker?: string; start?: number; end?: number; text?: string }>;
  };
  const segments = data.segments ?? [];
  if (!segments.length) throw new Error('OpenAI transcription returned no speaker segments');

  const speakerIds = new Map<string, number>();
  const utterances = segments.flatMap((segment): Utterance[] => {
    const text = segment.text?.trim();
    if (!text) return [];
    const label = segment.speaker || 'unknown';
    if (!speakerIds.has(label)) speakerIds.set(label, speakerIds.size);
    return [{ speaker: speakerIds.get(label)!, start: segment.start ?? 0, end: segment.end ?? segment.start ?? 0, transcript: text }];
  });
  if (!utterances.length) throw new Error('OpenAI transcription returned no usable speaker segments');
  // These recordings are operator-initiated outbound calls. Retain the
  // assignment in call_transcripts so it can be inspected and corrected if a
  // call begins with the prospect or a recording starts late.
  const shaunSpeaker = utterances[0].speaker;
  const duration = data.duration ?? utterances.reduce((max, row) => Math.max(max, row.end), 0);
  return { provider: 'openai', model, language: data.language ?? null, duration, shaunSpeaker, utterances };
}

async function normalizeFacts(db: D1Database, analysisId: number, callId: number, a: AnalysisRecord): Promise<void> {
  const statements: D1PreparedStatement[] = [db.prepare('DELETE FROM call_analysis_facts WHERE analysis_id = ?').bind(analysisId)];
  const add = (type: string, category: string, reaction?: string | null, confidence?: number | null, quote?: string | null, timestamp?: string | null) => statements.push(db.prepare(`INSERT OR IGNORE INTO call_analysis_facts (analysis_id, call_id, fact_type, category, reaction, confidence, quote, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(analysisId, callId, type, category, reaction ?? null, confidence ?? null, quote ?? null, timestamp ?? ''));
  (a.stated_needs as string[]).forEach(value => add('stated_need', value));
  (a.missed_follow_up_questions as string[]).forEach(value => add('missed_question', value));
  for (const row of a.inferred_needs as AnalysisRecord[]) { const e = (row.evidence as AnalysisRecord[])[0]; add('inferred_need', String(row.need), null, Number(row.confidence), e?.quote as string, e?.timestamp as string); }
  for (const row of a.objections as AnalysisRecord[]) { const e = (row.evidence as AnalysisRecord[])[0]; add('objection', String(row.category || row.objection), String(row.response_effectiveness), null, e?.quote as string, e?.timestamp as string); }
  for (const row of a.benefits_discussed as AnalysisRecord[]) { const e = (row.evidence as AnalysisRecord[])[0]; add('benefit_reaction', String(row.benefit), String(row.prospect_reaction), null, e?.quote as string, e?.timestamp as string); }
  await db.batch(statements);
}

export async function enqueueCallAnalysis(db: D1Database, callId: number, force = false): Promise<number> {
  if (force) await db.prepare('DELETE FROM call_intelligence_jobs WHERE call_id = ? AND requested_prompt_version = ?').bind(callId, CALL_ANALYSIS_PROMPT_VERSION).run();
  await db.prepare(`INSERT OR IGNORE INTO call_intelligence_jobs (call_id, requested_prompt_version) VALUES (?, ?)`).bind(callId, CALL_ANALYSIS_PROMPT_VERSION).run();
  const row = await db.prepare('SELECT id FROM call_intelligence_jobs WHERE call_id = ? AND requested_prompt_version = ?').bind(callId, CALL_ANALYSIS_PROMPT_VERSION).first<{ id: number }>();
  if (!row) throw new Error('Unable to enqueue analysis');
  return row.id;
}

export async function enqueueUnprocessedRecordings(db: D1Database): Promise<number> {
  const result = await db.prepare(`
    INSERT OR IGNORE INTO call_intelligence_jobs (call_id, requested_prompt_version)
    SELECT c.id, ?
      FROM call_log c
     WHERE c.recording_url IS NOT NULL
       AND TRIM(c.recording_url) <> ''
  `).bind(CALL_ANALYSIS_PROMPT_VERSION).run();
  return result.meta.changes ?? 0;
}

export async function processCallIntelligenceJobs(env: Env, limit = 2, allowWhenDisabled = false): Promise<{ processed: number }> {
  if (!allowWhenDisabled && env.CALL_INTELLIGENCE_ENABLED !== 'true' && env.CALL_INTELLIGENCE_TEST_MODE !== 'mock') return { processed: 0 };
  await env.DB.prepare(`UPDATE call_intelligence_jobs SET status='queued', locked_at=NULL, updated_at=datetime('now') WHERE status IN ('transcribing','analyzing') AND locked_at < datetime('now','-4 minutes')`).run();
  const jobs = await env.DB.prepare(`SELECT id, call_id, requested_prompt_version FROM call_intelligence_jobs WHERE status='queued' ORDER BY created_at LIMIT ?`).bind(limit).all<Job>();
  let processed = 0;
  for (const job of jobs.results ?? []) {
    try {
      const claim = await env.DB.prepare(`UPDATE call_intelligence_jobs SET status='transcribing', locked_at=datetime('now'), started_at=COALESCE(started_at,datetime('now')), attempt_count=attempt_count+1, error=NULL, updated_at=datetime('now') WHERE id=? AND status='queued'`).bind(job.id).run();
      if (!claim.meta.changes) continue;
      const call = await env.DB.prepare(`SELECT c.*, l.company, l.contact, l.industry, l.city, l.state, l.status, l.pipeline_status FROM call_log c JOIN leads l ON l.id=c.lead_id WHERE c.id=?`).bind(job.call_id).first<CallContext>();
      if (!call) throw new Error('Call or lead not found');
      const transcript = await existingTranscript(env.DB, call.id) ?? await transcribe(env, call);
      const text = transcriptText(transcript);
      await env.DB.prepare(`INSERT INTO call_transcripts (call_id,provider,model,language,duration_seconds,shaun_speaker,transcript_json,transcript_text) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(call_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,language=excluded.language,duration_seconds=excluded.duration_seconds,shaun_speaker=excluded.shaun_speaker,transcript_json=excluded.transcript_json,transcript_text=excluded.transcript_text,updated_at=datetime('now')`).bind(call.id, transcript.provider, transcript.model, transcript.language, transcript.duration, transcript.shaunSpeaker, JSON.stringify(transcript.utterances), text).run();
      await env.DB.prepare(`UPDATE call_intelligence_jobs SET status='analyzing', locked_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).bind(job.id).run();
      const metadata = { call_id: call.id, lead_id: call.lead_id, business_name: call.company, contact_name: call.contact, industry: call.industry, city: call.city, state: call.state, call_date: call.created_at, pipeline_stage: call.pipeline_status || call.status, known_outcome: call.outcome, script_opener_version: call.call_approach };
      const raw = env.CALL_INTELLIGENCE_TEST_MODE === 'mock' ? MOCK_ANALYSIS : await callClaudeJson(env.CLAUDE_API_KEY, buildCallAnalysisPrompt(metadata, text), { model: CALL_ANALYSIS_MODEL, systemPrompt: callAnalysisSystemPrompt, maxTokens: 8000, temperature: 0, timeoutMs: 90_000 });
      const analysis = validateCallAnalysis(raw);
      const transcriptRow = await env.DB.prepare('SELECT id FROM call_transcripts WHERE call_id=?').bind(call.id).first<{ id: number }>();
      if (!transcriptRow) throw new Error('Transcript save failed');
      await env.DB.prepare(`UPDATE call_analyses SET superseded_at=datetime('now') WHERE call_id=? AND superseded_at IS NULL`).bind(call.id).run();
      await env.DB.prepare(`INSERT INTO call_analyses (call_id,transcript_id,provider,model,analysis_prompt_version,analysis_schema_version,analysis_json,call_type,outcome,outcome_confidence,overall_score,recommended_next_action) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(call_id,analysis_prompt_version,analysis_schema_version) DO UPDATE SET transcript_id=excluded.transcript_id,provider=excluded.provider,model=excluded.model,analysis_json=excluded.analysis_json,call_type=excluded.call_type,outcome=excluded.outcome,outcome_confidence=excluded.outcome_confidence,overall_score=excluded.overall_score,recommended_next_action=excluded.recommended_next_action,created_at=datetime('now'),superseded_at=NULL`).bind(call.id, transcriptRow.id, env.CALL_INTELLIGENCE_TEST_MODE === 'mock' ? 'mock' : 'anthropic', env.CALL_INTELLIGENCE_TEST_MODE === 'mock' ? 'fixture-v1' : CALL_ANALYSIS_MODEL, job.requested_prompt_version, CALL_ANALYSIS_SCHEMA_VERSION, JSON.stringify(analysis), analysis.call_type, analysis.outcome, analysis.outcome_confidence, (analysis.scores as AnalysisRecord).overall, analysis.recommended_next_action).run();
      const analysisRow = await env.DB.prepare(`SELECT id FROM call_analyses WHERE call_id=? AND analysis_prompt_version=? AND analysis_schema_version=?`).bind(call.id, job.requested_prompt_version, CALL_ANALYSIS_SCHEMA_VERSION).first<{ id: number }>();
      if (!analysisRow) throw new Error('Analysis save failed');
      await normalizeFacts(env.DB, analysisRow.id, call.id, analysis);
      await env.DB.prepare(`UPDATE call_intelligence_jobs SET status='completed', completed_at=datetime('now'), locked_at=NULL, updated_at=datetime('now') WHERE id=?`).bind(job.id).run();
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('error', 'call-intelligence', `Job ${job.id} failed`, { error: message });
      await env.DB.prepare(`UPDATE call_intelligence_jobs SET status='failed', error=?, locked_at=NULL, updated_at=datetime('now') WHERE id=?`).bind(message.slice(0, 1000), job.id).run();
    }
  }
  return { processed };
}
