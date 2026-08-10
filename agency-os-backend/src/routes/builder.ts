import { Hono } from 'hono';
import type { Env, Lead } from '../types';
import { completePipelineBuild, ensurePipelineBrief } from './pipeline';
import { builderEligibleLeadSql } from '../services/outreachEligibility';

type WorkerState = 'idle' | 'starting' | 'running' | 'building' | 'login_required' | 'paused' | 'error';
interface Job { id: number; lead_id: number; run_id: number; status: string; attempt_count: number; lock_token: string | null }
interface EligibilityRow {
  id: number;
  company: string;
  status: string;
  pipeline_status: string;
  outcome: string | null;
  phone_route: string | null;
  enrichment_status: string | null;
  has_website: number | null;
  site_url: string | null;
  site_url_raw: string | null;
  project_id: number | null;
  demo_id: number | null;
}

// Builder eligibility is the union of the Email and Text Outreach audiences,
// narrowed to their Awaiting Build cards. Old leads received awaiting_build as
// a migration default, so the status flag alone is never sufficient.
const BUILDER_ELIGIBLE_LEAD = builderEligibleLeadSql('l');

const ELIGIBILITY_GUARD_PREFIX = 'Eligibility guard:';
const RESUME_EXISTING_MARKER = 'Operator resume requested: reuse existing LandingSite editor';

function exclusionReason(lead: EligibilityRow): string {
  if (lead.project_id) return `Existing project #${lead.project_id}`;
  if (lead.demo_id) return `Demo already booked (#${lead.demo_id})`;
  if (lead.status === 'not_interested') return 'CRM stage is Not interested';
  if (lead.status === 'qualified') return 'CRM stage is Demo booked / qualified';
  if (!['cold', 'contacted'].includes(lead.status)) return `CRM stage is ${lead.status}`;
  if (lead.outcome?.toLowerCase().includes('not interested')) return 'Latest outcome is Not Interested';
  if (lead.enrichment_status !== 'enriched') return 'Lead enrichment is not complete';
  if (lead.phone_route === 'review') return 'Phone route requires review before Email or Text Outreach';
  if (!['call', 'text', 'unknown', null].includes(lead.phone_route)) return `Phone route is ${lead.phone_route}`;
  if (lead.site_url_raw || lead.site_url) return 'A demo URL is already saved';
  if (lead.has_website) return 'Lead already has a website';
  return 'Lead no longer meets Builder safety rules';
}

async function writeBuilderEvent(
  db: D1Database,
  input: { runId: number; jobId?: number | null; eventType: string; state?: string | null; step?: string | null; message?: string | null; metadata?: unknown },
): Promise<void> {
  await db.prepare(`INSERT INTO builder_events(run_id,job_id,event_type,state,step,message,metadata) VALUES(?,?,?,?,?,?,?)`).bind(
    input.runId,
    input.jobId ?? null,
    input.eventType.slice(0, 100),
    input.state?.slice(0, 100) ?? null,
    input.step?.slice(0, 200) ?? null,
    input.message?.slice(0, 1000) ?? null,
    input.metadata === undefined ? null : JSON.stringify(input.metadata),
  ).run();
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const e = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', e.encode(left)), crypto.subtle.digest('SHA-256', e.encode(right))]);
  const av = new Uint8Array(a); const bv = new Uint8Array(b); let mismatch = av.length ^ bv.length;
  for (let i = 0; i < Math.max(av.length, bv.length); i++) mismatch |= (av[i] ?? 0) ^ (bv[i] ?? 0);
  return mismatch === 0;
}

async function finishRunIfDrained(db: D1Database, runId: number): Promise<void> {
  const pending = await db.prepare(`SELECT COUNT(*) count FROM builder_jobs WHERE run_id = ? AND status IN ('waiting','retry','building')`).bind(runId).first<{count:number}>();
  if (pending?.count) return;
  const run = await db.prepare(`SELECT status FROM builder_runs WHERE id=?`).bind(runId).first<{status:string}>();
  if (!run || !['starting','running','paused'].includes(run.status)) return;
  await writeBuilderEvent(db, { runId, eventType: 'run_completed', state: 'completed', step: 'Queue complete', message: 'All queued websites have finished.' });
  await db.batch([
    db.prepare(`UPDATE builder_runs SET status='completed', ended_at=datetime('now') WHERE id=? AND status IN ('starting','running','paused')`).bind(runId),
    db.prepare(`UPDATE builder_control SET active_run_id=NULL, worker_state='idle', current_step=NULL, worker_message=NULL, updated_at=datetime('now') WHERE id=1 AND active_run_id=?`).bind(runId),
  ]);
}

async function stopRunAfterCurrent(db: D1Database, runId: number): Promise<void> {
  // Unstarted queue entries are only a snapshot. Removing them releases the
  // active-lead uniqueness guard so those leads can be selected in a later run.
  await db.prepare(`DELETE FROM builder_jobs WHERE run_id=? AND status IN ('waiting','retry')`).bind(runId).run();
  const retained = await db.prepare(`SELECT COUNT(*) count FROM builder_jobs WHERE run_id=?`).bind(runId).first<{count:number}>();
  await db.batch([
    db.prepare(`UPDATE builder_runs SET status='stopped',total_jobs=?,ended_at=datetime('now') WHERE id=?`).bind(retained?.count??0,runId),
    db.prepare(`UPDATE builder_control SET active_run_id=NULL,stop_requested=0,paused=0,worker_state='idle',current_step=NULL,worker_message=NULL,updated_at=datetime('now') WHERE id=1 AND active_run_id=?`).bind(runId),
  ]);
}

async function blockIneligibleJob(db: D1Database, job: Job, reason: string): Promise<void> {
  const message = `${ELIGIBILITY_GUARD_PREFIX} ${reason}`;
  await db.prepare(`UPDATE builder_jobs SET status='failed',failure_reason=?,ended_at=datetime('now'),duration_ms=CASE WHEN started_at IS NULL THEN NULL ELSE CAST((julianday('now')-julianday(started_at))*86400000 AS INTEGER) END,lock_token=NULL,lease_expires_at=NULL,updated_at=datetime('now') WHERE id=?`).bind(message, job.id).run();
  await writeBuilderEvent(db, { runId: job.run_id, jobId: job.id, eventType: 'job_skipped_ineligible', state: 'failed', step: 'Eligibility guard', message });
}

export const builderWorkerRouter = new Hono<{ Bindings: Env }>();
builderWorkerRouter.use('*', async (c, next) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!c.env.BUILDER_API_TOKEN || !token || !await secureEqual(token, c.env.BUILDER_API_TOKEN)) return c.json({ error: 'Unauthorized' }, 401);
  await next();
});

builderWorkerRouter.post('/claim', async (c) => {
  const control = await c.env.DB.prepare(`SELECT paused, stop_requested, active_run_id FROM builder_control WHERE id=1`).first<{paused:number;stop_requested:number;active_run_id:number|null}>();
  if (control?.active_run_id && control.stop_requested) {
    await stopRunAfterCurrent(c.env.DB, control.active_run_id);
    return c.json({ paused: false, stopped: true, job: null });
  }
  if (!control?.active_run_id || control.paused) {
    await c.env.DB.prepare(`UPDATE builder_control SET last_worker_seen_at=datetime('now'),worker_state=?,current_step=CASE WHEN ?='idle' THEN NULL ELSE current_step END,worker_message=CASE WHEN ?='idle' THEN NULL ELSE worker_message END,updated_at=datetime('now') WHERE id=1`).bind(control?.paused ? 'paused' : 'idle', control?.paused ? 'paused' : 'idle', control?.paused ? 'paused' : 'idle').run();
    return c.json({ paused: !!control?.paused, stopped: !!control?.stop_requested, job: null });
  }
  await c.env.DB.prepare(`UPDATE builder_jobs SET status='retry',lock_token=NULL,lease_expires_at=NULL,failure_reason='Worker lease expired',updated_at=datetime('now') WHERE run_id=? AND status='building' AND lease_expires_at<datetime('now')`).bind(control.active_run_id).run();
  const blocked = await c.env.DB.prepare(`SELECT j.*,l.company,l.status,l.pipeline_status,l.outcome,l.phone_route,l.enrichment_status,l.has_website,l.site_url,l.site_url_raw,(SELECT MIN(id) FROM projects WHERE lead_id=l.id) project_id,(SELECT MIN(id) FROM demos WHERE lead_id=l.id AND status IN ('booked','held','rescheduled')) demo_id FROM builder_jobs j JOIN leads l ON l.id=j.lead_id WHERE j.run_id=? AND j.status IN ('waiting','retry') AND NOT (${BUILDER_ELIGIBLE_LEAD})`).bind(control.active_run_id).all<Job & EligibilityRow>();
  for (const row of blocked.results) await blockIneligibleJob(c.env.DB, row, exclusionReason(row));
  const preparation = await c.env.DB.prepare(`SELECT j.id jobId,j.lead_id leadId,j.run_id runId,l.company businessName FROM builder_jobs j JOIN leads l ON l.id=j.lead_id WHERE j.run_id=? AND j.status IN ('waiting','retry') AND ${BUILDER_ELIGIBLE_LEAD} AND (l.pipeline_brief IS NULL OR trim(l.pipeline_brief)='') ORDER BY CASE WHEN j.failure_reason LIKE 'Brief preparation failed:%' THEN 1 ELSE 0 END,j.id LIMIT 1`).bind(control.active_run_id).first<{jobId:number;leadId:number;runId:number;businessName:string}>();
  if (preparation) {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE builder_runs SET status='running' WHERE id=? AND status='starting'`).bind(control.active_run_id),
      // builder_control's durable CHECK constraint has no `preparing` state;
      // preparation is represented by running + the explicit current step.
      c.env.DB.prepare(`UPDATE builder_control SET worker_state='running',current_step='Preparing brief',worker_message=?,last_worker_seen_at=datetime('now'),updated_at=datetime('now') WHERE id=1`).bind(`Preparing brief for ${preparation.businessName}.`),
    ]);
    return c.json({ prepare: preparation, job: null });
  }
  const candidate = await c.env.DB.prepare(`SELECT j.id,j.failure_reason FROM builder_jobs j JOIN leads l ON l.id=j.lead_id WHERE j.run_id=? AND j.status IN ('waiting','retry') AND j.attempt_count<3 AND ${BUILDER_ELIGIBLE_LEAD} AND l.pipeline_brief IS NOT NULL AND trim(l.pipeline_brief)!='' ORDER BY j.id LIMIT 1`).bind(control.active_run_id).first<{id:number;failure_reason:string|null}>();
  if (!candidate) { await finishRunIfDrained(c.env.DB, control.active_run_id); return c.json({ job: null }); }
  const resumeExisting = candidate.failure_reason?.startsWith(RESUME_EXISTING_MARKER) ?? false;
  const resumeEditorUrl = resumeExisting ? candidate.failure_reason?.slice(RESUME_EXISTING_MARKER.length).replace(/^\s*\|\s*/, '') || null : null;
  const lockToken = crypto.randomUUID();
  const claimed = await c.env.DB.prepare(`UPDATE builder_jobs SET status='building',attempt_count=attempt_count+1,lock_token=?,locked_at=datetime('now'),lease_expires_at=datetime('now','+20 minutes'),started_at=COALESCE(started_at,datetime('now')),failure_reason=NULL,updated_at=datetime('now') WHERE id=? AND status IN ('waiting','retry')`).bind(lockToken,candidate.id).run();
  if (!claimed.meta.changes) return c.json({ job:null });
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE builder_runs SET status='running' WHERE id=? AND status='starting'`).bind(control.active_run_id),
    c.env.DB.prepare(`UPDATE builder_control SET worker_state='building',current_step='Opening LandingSite.ai',worker_message=NULL,last_worker_seen_at=datetime('now'),updated_at=datetime('now') WHERE id=1`),
  ]);
  const job = await c.env.DB.prepare(`SELECT j.id,j.lead_id leadId,j.run_id runId,j.attempt_count attempt,l.company businessName,l.pipeline_brief prompt FROM builder_jobs j JOIN leads l ON l.id=j.lead_id WHERE j.id=?`).bind(candidate.id).first();
  await writeBuilderEvent(c.env.DB, { runId: control.active_run_id, jobId: candidate.id, eventType: 'job_claimed', state: 'building', step: 'Opening LandingSite.ai', message: `Build started for ${(job as {businessName?:string}|null)?.businessName ?? `lead ${candidate.id}`}` });
  return c.json({ job:{...job,lockToken,resumeExisting,resumeEditorUrl} });
});

builderWorkerRouter.post('/prepare-brief', async (c) => {
  const body = await c.req.json<{jobId?:number}>().catch(() => ({} as {jobId?:number}));
  if (!body.jobId) return c.json({ error: 'jobId is required' }, 400);
  const control = await c.env.DB.prepare(`SELECT active_run_id,paused,stop_requested FROM builder_control WHERE id=1`).first<{active_run_id:number|null;paused:number;stop_requested:number}>();
  if (!control?.active_run_id || control.paused || control.stop_requested) {
    return c.json({ success: false, skipped: true, reason: control?.paused ? 'Builder is paused' : 'Builder run is no longer active' });
  }
  const job = await c.env.DB.prepare(`SELECT j.id,j.run_id,j.lead_id,j.status,l.company business_name FROM builder_jobs j JOIN leads l ON l.id=j.lead_id WHERE j.id=? AND j.run_id=? AND j.status IN ('waiting','retry') AND ${BUILDER_ELIGIBLE_LEAD}`).bind(body.jobId,control.active_run_id).first<{id:number;run_id:number;lead_id:number;status:string;business_name:string}>();
  if (!job) return c.json({ success: false, skipped: true, reason: 'Brief job is no longer eligible or waiting' });
  await writeBuilderEvent(c.env.DB, { runId: job.run_id, jobId: job.id, eventType: 'brief_preparation_started', state: 'preparing', step: 'Preparing brief', message: `Generating the LandingSite brief for ${job.business_name}.` });
  try {
    const lead = await ensurePipelineBrief(c.env, job.lead_id);
    if (!lead) throw new Error('Lead was removed before its brief could be prepared');
    await c.env.DB.prepare(`UPDATE builder_jobs SET failure_reason=NULL,updated_at=datetime('now') WHERE id=? AND status IN ('waiting','retry')`).bind(job.id).run();
    await c.env.DB.prepare(`UPDATE builder_control SET worker_state='running',current_step='Brief ready',worker_message=?,last_worker_seen_at=datetime('now'),updated_at=datetime('now') WHERE id=1 AND active_run_id=? AND paused=0 AND stop_requested=0`).bind(`Brief ready for ${job.business_name}.`,job.run_id).run();
    await writeBuilderEvent(c.env.DB, { runId: job.run_id, jobId: job.id, eventType: 'brief_preparation_completed', state: 'running', step: 'Brief ready', message: `${job.business_name} is ready for LandingSite.ai.` });
    const after = await c.env.DB.prepare(`SELECT stop_requested FROM builder_control WHERE id=1 AND active_run_id=?`).bind(job.run_id).first<{stop_requested:number}>();
    if (after?.stop_requested) await stopRunAfterCurrent(c.env.DB, job.run_id);
    return c.json({ success: true, jobId: job.id, leadId: job.lead_id, businessName: job.business_name });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const priorFailures = await c.env.DB.prepare(`SELECT COUNT(*) count FROM builder_events WHERE job_id=? AND event_type='brief_preparation_failed'`).bind(job.id).first<{count:number}>();
    const attempt = (priorFailures?.count ?? 0) + 1;
    const failed = attempt >= 3;
    const message = `Brief preparation failed: ${reason}`.slice(0, 2000);
    await c.env.DB.prepare(`UPDATE builder_jobs SET status=?,failure_reason=?,ended_at=CASE WHEN ? THEN datetime('now') ELSE ended_at END,updated_at=datetime('now') WHERE id=? AND status IN ('waiting','retry')`).bind(failed?'failed':job.status,message,failed?1:0,job.id).run();
    await writeBuilderEvent(c.env.DB, { runId: job.run_id, jobId: job.id, eventType: 'brief_preparation_failed', state: failed ? 'failed' : 'retry', step: 'Brief preparation failed', message, metadata: { attempt, maxAttempts: 3 } });
    const after = await c.env.DB.prepare(`SELECT stop_requested FROM builder_control WHERE id=1 AND active_run_id=?`).bind(job.run_id).first<{stop_requested:number}>();
    if (after?.stop_requested) await stopRunAfterCurrent(c.env.DB, job.run_id);
    else if (failed) await finishRunIfDrained(c.env.DB, job.run_id);
    return c.json({ success: false, failed, reason: message, attempt, maxAttempts: 3 });
  }
});

builderWorkerRouter.post('/heartbeat', async (c) => {
  const b = await c.req.json<{jobId?:number;lockToken?:string;state?:WorkerState;step?:string;message?:string}>();
  const before = await c.env.DB.prepare(`SELECT active_run_id,current_step,worker_state,worker_message FROM builder_control WHERE id=1`).first<{active_run_id:number|null;current_step:string|null;worker_state:string;worker_message:string|null}>();
  if (b.jobId && b.lockToken) await c.env.DB.prepare(`UPDATE builder_jobs SET lease_expires_at=datetime('now','+20 minutes'),updated_at=datetime('now') WHERE id=? AND lock_token=? AND status='building'`).bind(b.jobId,b.lockToken).run();
  await c.env.DB.prepare(`UPDATE builder_control SET last_worker_seen_at=datetime('now'),worker_state=?,current_step=?,worker_message=?,updated_at=datetime('now') WHERE id=1`).bind(b.state??'idle',b.step?.slice(0,200)??null,b.message?.slice(0,500)??null).run();
  if (before?.active_run_id && (b.step !== before.current_step || b.state !== before.worker_state || b.message !== before.worker_message)) {
    await writeBuilderEvent(c.env.DB, { runId: before.active_run_id, jobId: b.jobId, eventType: 'step_changed', state: b.state, step: b.step, message: b.message });
  }
  return c.json({ok:true});
});

builderWorkerRouter.post('/result', async (c) => {
  const b = await c.req.json<{jobId?:number;lockToken?:string;success?:boolean;demoUrl?:string;reason?:string;recoverable?:boolean;systemError?:boolean;artifactPath?:string}>();
  if (!b.jobId || !b.lockToken) return c.json({error:'jobId and lockToken are required'},400);
  const job = await c.env.DB.prepare(`SELECT * FROM builder_jobs WHERE id=? AND lock_token=?`).bind(b.jobId,b.lockToken).first<Job>();
  if (!job || job.status !== 'building') return c.json({error:'Job lock is no longer valid'},409);
  if (b.success) {
    const url=b.demoUrl?.trim()??''; try { const p=new URL(url); if(!/^https?:$/.test(p.protocol)) throw new Error(); } catch { return c.json({error:'Valid demoUrl required'},400); }
    const lead=await c.env.DB.prepare(`SELECT l.* FROM leads l WHERE l.id=? AND ${BUILDER_ELIGIBLE_LEAD}`).bind(job.lead_id).first<Lead>();
    if(!lead) {
      const state=await c.env.DB.prepare(`SELECT l.id,l.company,l.status,l.pipeline_status,l.outcome,l.phone_route,l.enrichment_status,l.has_website,l.site_url,l.site_url_raw,(SELECT MIN(id) FROM projects WHERE lead_id=l.id) project_id,(SELECT MIN(id) FROM demos WHERE lead_id=l.id AND status IN ('booked','held','rescheduled')) demo_id FROM leads l WHERE l.id=?`).bind(job.lead_id).first<EligibilityRow>();
      const reason=state ? exclusionReason(state) : 'Lead was removed';
      await blockIneligibleJob(c.env.DB,job,reason);
      await finishRunIfDrained(c.env.DB,job.run_id);
      return c.json({success:false,leadId:job.lead_id,reason:`${ELIGIBILITY_GUARD_PREFIX} ${reason}`});
    }
    await completePipelineBuild(c.env,lead,url);
    await c.env.DB.prepare(`UPDATE builder_jobs SET status='completed',demo_url=?,ended_at=datetime('now'),duration_ms=CAST((julianday('now')-julianday(started_at))*86400000 AS INTEGER),lock_token=NULL,lease_expires_at=NULL,artifact_path=?,updated_at=datetime('now') WHERE id=?`).bind(url,b.artifactPath?.slice(0,1000)??null,job.id).run();
    await writeBuilderEvent(c.env.DB, { runId: job.run_id, jobId: job.id, eventType: 'job_completed', state: 'completed', step: 'Completing job', message: url, metadata: { demoUrl: url } });
  } else {
    const retry=b.recoverable===true && job.attempt_count<3;
    await c.env.DB.prepare(`UPDATE builder_jobs SET status=?,failure_reason=?,ended_at=datetime('now'),duration_ms=CAST((julianday('now')-julianday(started_at))*86400000 AS INTEGER),lock_token=NULL,lease_expires_at=NULL,artifact_path=?,updated_at=datetime('now') WHERE id=?`).bind(retry?'retry':'failed',(b.reason??'Unknown failure').slice(0,2000),b.artifactPath?.slice(0,1000)??null,job.id).run();
    await writeBuilderEvent(c.env.DB, { runId: job.run_id, jobId: job.id, eventType: retry ? 'job_retrying' : 'job_failed', state: retry ? 'retry' : 'failed', step: 'Build failed', message: b.reason ?? 'Unknown failure', metadata: { recoverable: !!b.recoverable, systemError: !!b.systemError, artifactPath: b.artifactPath ?? null } });
    if(b.systemError) await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE builder_runs SET status='error',error_reason=?,ended_at=datetime('now') WHERE id=?`).bind(b.reason??'System error',job.run_id),
      c.env.DB.prepare(`UPDATE builder_control SET worker_state='error',paused=1,current_step='System error',worker_message=?,updated_at=datetime('now') WHERE id=1`).bind(b.reason??'System error'),
    ]);
  }
  const control=await c.env.DB.prepare(`SELECT paused,stop_requested FROM builder_control WHERE id=1`).first<{paused:number;stop_requested:number}>();
  if(control?.stop_requested) await stopRunAfterCurrent(c.env.DB,job.run_id);
  else if(!b.systemError) await finishRunIfDrained(c.env.DB,job.run_id);
  return c.json({success:!!b.success,leadId:job.lead_id,demoUrl:b.demoUrl,reason:b.reason});
});

export const builderAdminRouter = new Hono<{ Bindings: Env }>();
builderAdminRouter.get('/status', async c => {
  const control=await c.env.DB.prepare(`SELECT *,CASE WHEN last_worker_seen_at IS NULL OR last_worker_seen_at<datetime('now','-2 minutes') THEN 'offline' ELSE worker_state END effective_state FROM builder_control WHERE id=1`).first();
  const activeRunId=(control as {active_run_id?:number|null})?.active_run_id;
  const requestedRunId = Number.parseInt(c.req.query('runId') ?? '', 10);
  const selectedRunId = Number.isFinite(requestedRunId) ? requestedRunId : activeRunId;
  const displayRun = selectedRunId
    ? await c.env.DB.prepare(`SELECT * FROM builder_runs WHERE id=?`).bind(selectedRunId).first<{id:number}>()
    : await c.env.DB.prepare(`SELECT * FROM builder_runs ORDER BY id DESC LIMIT 1`).first<{id:number}>();
  const displayRunId = displayRun?.id;
  const [awaiting,ready,missingBriefLeads,nextBatchLeads,safetyExcluded,jobs,activeBuildingJob,durations,today,runHistory,events]=await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) count FROM leads l WHERE ${BUILDER_ELIGIBLE_LEAD}`).first(),
    c.env.DB.prepare(`SELECT COUNT(*) count FROM leads l WHERE ${BUILDER_ELIGIBLE_LEAD} AND l.pipeline_brief IS NOT NULL AND trim(l.pipeline_brief)!=''`).first(),
    c.env.DB.prepare(`SELECT l.id,l.company,l.email,l.phone_route FROM leads l WHERE ${BUILDER_ELIGIBLE_LEAD} AND (l.pipeline_brief IS NULL OR trim(l.pipeline_brief)='') ORDER BY CASE WHEN l.email IS NOT NULL AND trim(l.email)!='' THEN 0 ELSE 1 END,l.opportunity_score DESC NULLS LAST,l.id LIMIT 500`).all(),
    c.env.DB.prepare(`SELECT l.id,l.company,l.email,l.phone_route,l.status crm_status,l.outcome,CASE WHEN l.pipeline_brief IS NOT NULL AND trim(l.pipeline_brief)!='' THEN 1 ELSE 0 END has_brief FROM leads l WHERE ${BUILDER_ELIGIBLE_LEAD} ORDER BY CASE WHEN l.email IS NOT NULL AND trim(l.email)!='' THEN 0 ELSE 1 END,l.opportunity_score DESC NULLS LAST,l.id LIMIT 60`).all(),
    c.env.DB.prepare(`SELECT l.id,l.company,l.status,l.pipeline_status,l.outcome,l.phone_route,l.enrichment_status,l.has_website,l.site_url,l.site_url_raw,(SELECT MIN(id) FROM projects WHERE lead_id=l.id) project_id,(SELECT MIN(id) FROM demos WHERE lead_id=l.id AND status IN ('booked','held','rescheduled')) demo_id FROM leads l WHERE l.pipeline_status='awaiting_build' AND l.deleted_at IS NULL AND NOT (${BUILDER_ELIGIBLE_LEAD}) ORDER BY l.updated_at DESC,l.id LIMIT 100`).all<EligibilityRow>(),
    displayRunId?c.env.DB.prepare(`SELECT j.*,l.company business_name,l.email,l.pipeline_status,l.site_url,l.site_url_raw,CASE WHEN l.pipeline_brief IS NOT NULL AND trim(l.pipeline_brief)!='' THEN 1 ELSE 0 END has_brief FROM builder_jobs j JOIN leads l ON l.id=j.lead_id WHERE j.run_id=? ORDER BY j.id`).bind(displayRunId).all():{results:[]},
    activeRunId?c.env.DB.prepare(`SELECT j.id,l.company business_name FROM builder_jobs j JOIN leads l ON l.id=j.lead_id WHERE j.run_id=? AND j.status='building' ORDER BY j.id LIMIT 1`).bind(activeRunId).first<{id:number;business_name:string}>():null,
    c.env.DB.prepare(`SELECT duration_ms FROM builder_jobs WHERE status='completed' AND duration_ms IS NOT NULL ORDER BY ended_at DESC LIMIT 100`).all<{duration_ms:number}>(),
    c.env.DB.prepare(`SELECT SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completedToday,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failedToday FROM builder_jobs WHERE ended_at>=datetime('now','-24 hours')`).first(),
    c.env.DB.prepare(`SELECT r.*,SUM(CASE WHEN j.status='completed' THEN 1 ELSE 0 END) completed_jobs,SUM(CASE WHEN j.status='failed' THEN 1 ELSE 0 END) failed_jobs,SUM(CASE WHEN j.status IN ('waiting','retry','building') THEN 1 ELSE 0 END) remaining_jobs,ROUND(AVG(CASE WHEN j.status='completed' THEN j.duration_ms END)) average_ms FROM builder_runs r LEFT JOIN builder_jobs j ON j.run_id=r.id GROUP BY r.id ORDER BY r.id DESC LIMIT 12`).all(),
    displayRunId?c.env.DB.prepare(`SELECT e.*,l.company business_name FROM builder_events e LEFT JOIN builder_jobs j ON j.id=e.job_id LEFT JOIN leads l ON l.id=j.lead_id WHERE e.run_id=? ORDER BY e.id DESC LIMIT 100`).bind(displayRunId).all():{results:[]},
  ]);
  const durationValues = durations.results.map(row=>row.duration_ms).filter(value=>Number.isFinite(value)).sort((a,b)=>a-b);
  const averageMs = durationValues.length ? Math.round(durationValues.reduce((sum,value)=>sum+value,0)/durationValues.length) : null;
  const middle = Math.floor(durationValues.length/2);
  const medianMs = durationValues.length ? (durationValues.length%2 ? durationValues[middle] : Math.round((durationValues[middle-1]+durationValues[middle])/2)) : null;
  const effectiveState=(control as {effective_state?:string}|null)?.effective_state??'offline';
  const buildingJob = activeBuildingJob;
  const canResume = !!buildingJob && ['idle','offline','error'].includes(effectiveState);
  const resumeReason = !buildingJob
    ? null
    : effectiveState === 'login_required'
      ? 'Sign in to LandingSite.ai first; the employee will continue automatically.'
      : effectiveState === 'building'
        ? 'The browser employee is actively working on this website.'
        : canResume
          ? 'The queue says Building, but the browser employee is no longer working on it.'
          : 'Wait for the current browser activity to finish.';
  return c.json({
    awaitingBuild:(awaiting as {count:number}|null)?.count??0,
    readyToQueue:(ready as {count:number}|null)?.count??0,
    missingBriefLeads:missingBriefLeads.results,
    nextBatchLeads:nextBatchLeads.results,
    safetyExcluded:safetyExcluded.results.map(lead=>({id:lead.id,company:lead.company,crmStatus:lead.status,outcome:lead.outcome,reason:exclusionReason(lead)})),
    control,
    run:displayRun??null,
    jobs:jobs.results,
    events:events.results,
    runHistory:runHistory.results,
    metrics:{averageMs,medianMs,sampleSize:durationValues.length,completedToday:(today as {completedToday:number|null}|null)?.completedToday??0,failedToday:(today as {failedToday:number|null}|null)?.failedToday??0},
    health:{apiConnected:true,workerOnline:effectiveState!=='offline',landingSiteAuthenticated:effectiveState!=='login_required',readyToStart:effectiveState!=='offline'&&effectiveState!=='login_required'},
    resume:{canResume,jobId:buildingJob?.id??null,businessName:buildingJob?.business_name??null,reason:resumeReason},
  });
});

builderAdminRouter.post('/start', async c => {
  const body=(await c.req.json().catch(()=>({}))) as {batchSize?:number;leadIds?:number[]};
  const requestedBatchSize=body.batchSize??20;
  if(!Number.isInteger(requestedBatchSize)||requestedBatchSize<20||requestedBatchSize>60||requestedBatchSize%20!==0) return c.json({error:'batchSize must be 20, 40, or 60'},400);
  const reviewedLeadIds=body.leadIds === undefined ? null : [...new Set(body.leadIds)];
  if(reviewedLeadIds && (!reviewedLeadIds.length||reviewedLeadIds.length>60||reviewedLeadIds.some(id=>!Number.isInteger(id)||id<1))) return c.json({error:'leadIds must contain 1 to 60 unique lead IDs'},400);
  const control=await c.env.DB.prepare(`SELECT active_run_id FROM builder_control WHERE id=1`).first<{active_run_id:number|null}>();
  if(control?.active_run_id) return c.json({error:'A Builder run is already active'},409);
  const created=await c.env.DB.prepare(`INSERT INTO builder_runs(status) VALUES('starting') RETURNING id`).first<{id:number}>();
  if(!created) return c.json({error:'Could not create Builder run'},500);
  if(reviewedLeadIds) {
    const placeholders=reviewedLeadIds.map(()=>'?').join(',');
    await c.env.DB.prepare(`INSERT INTO builder_jobs(lead_id,run_id,status) SELECT l.id,?,'waiting' FROM leads l WHERE l.id IN (${placeholders}) AND ${BUILDER_ELIGIBLE_LEAD} ORDER BY CASE WHEN l.email IS NOT NULL AND trim(l.email)!='' THEN 0 ELSE 1 END,l.opportunity_score DESC NULLS LAST,l.id`).bind(created.id,...reviewedLeadIds).run();
  } else {
    await c.env.DB.prepare(`INSERT INTO builder_jobs(lead_id,run_id,status) SELECT l.id,?,'waiting' FROM leads l WHERE ${BUILDER_ELIGIBLE_LEAD} ORDER BY CASE WHEN l.email IS NOT NULL AND trim(l.email)!='' THEN 0 ELSE 1 END,l.opportunity_score DESC NULLS LAST,l.id LIMIT ?`).bind(created.id,requestedBatchSize).run();
  }
  const total=await c.env.DB.prepare(`SELECT COUNT(*) count FROM builder_jobs WHERE run_id=?`).bind(created.id).first<{count:number}>();
  if(!total?.count){await c.env.DB.prepare(`UPDATE builder_runs SET status='completed',ended_at=datetime('now') WHERE id=?`).bind(created.id).run();return c.json({runId:created.id,queued:0});}
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE builder_runs SET total_jobs=? WHERE id=?`).bind(total.count,created.id),
    c.env.DB.prepare(`UPDATE builder_control SET active_run_id=?,paused=0,stop_requested=0,worker_state='starting',current_step='Waiting for browser worker',worker_message=NULL,updated_at=datetime('now') WHERE id=1`).bind(created.id),
  ]);
  await writeBuilderEvent(c.env.DB, { runId: created.id, eventType: 'run_started', state: 'starting', step: 'Waiting for browser worker', message: `${total.count} website${total.count===1?'':'s'} queued.` });
  return c.json({runId:created.id,queued:total.count});
});

builderAdminRouter.post('/control', async c => {
  const b=await c.req.json<{action?:'pause'|'resume'|'stop'}>();
  const control=await c.env.DB.prepare(`SELECT active_run_id,worker_state,current_step FROM builder_control WHERE id=1`).first<{active_run_id:number|null;worker_state:string;current_step:string|null}>();
  if(!control?.active_run_id) return c.json({error:'No active Builder run'},409);
  if(b.action==='pause') { const current=control.current_step==='Preparing brief'?'brief':control.worker_state==='building'?'website':'step'; await c.env.DB.batch([c.env.DB.prepare(`UPDATE builder_control SET paused=1,worker_state=CASE WHEN worker_state='building' THEN worker_state ELSE 'paused' END,updated_at=datetime('now') WHERE id=1`),c.env.DB.prepare(`UPDATE builder_runs SET status='paused' WHERE id=?`).bind(control.active_run_id)]); await writeBuilderEvent(c.env.DB,{runId:control.active_run_id,eventType:'run_paused',state:'paused',step:`Pausing after current ${current}`,message:'Pause requested by operator.'}); }
  else if(b.action==='resume') { await c.env.DB.batch([c.env.DB.prepare(`UPDATE builder_control SET paused=0,stop_requested=0,worker_state='running',updated_at=datetime('now') WHERE id=1`),c.env.DB.prepare(`UPDATE builder_runs SET status='running' WHERE id=?`).bind(control.active_run_id)]); await writeBuilderEvent(c.env.DB,{runId:control.active_run_id,eventType:'run_resumed',state:'running',step:'Resuming queue',message:'Builder resumed by operator.'}); }
  else if(b.action==='stop') {
    const active=await c.env.DB.prepare(`SELECT COUNT(*) count FROM builder_jobs WHERE run_id=? AND status='building'`).bind(control.active_run_id).first<{count:number}>();
    const preparing=control.current_step==='Preparing brief';
    const current=preparing?'brief':'website';
    if(active?.count || preparing) { await c.env.DB.prepare(`UPDATE builder_control SET stop_requested=1,current_step=?,updated_at=datetime('now') WHERE id=1`).bind(`Stopping after current ${current}`).run(); await writeBuilderEvent(c.env.DB,{runId:control.active_run_id,eventType:'stop_requested',state:'running',step:`Stopping after current ${current}`,message:'Safe stop requested by operator.'}); }
    else await stopRunAfterCurrent(c.env.DB,control.active_run_id);
  }
  else return c.json({error:'Invalid action'},400);
  return c.json({ok:true});
});

builderAdminRouter.post('/resume-stuck', async c => {
  const control=await c.env.DB.prepare(`SELECT active_run_id,worker_state,worker_message,CASE WHEN last_worker_seen_at IS NULL OR last_worker_seen_at<datetime('now','-2 minutes') THEN 'offline' ELSE worker_state END effective_state FROM builder_control WHERE id=1`).first<{active_run_id:number|null;worker_state:string;worker_message:string|null;effective_state:string}>();
  if(!control?.active_run_id) return c.json({error:'No active Builder run'},409);
  const job=await c.env.DB.prepare(`SELECT j.id,j.run_id,j.lead_id,j.attempt_count,l.company business_name FROM builder_jobs j JOIN leads l ON l.id=j.lead_id WHERE j.run_id=? AND j.status='building' ORDER BY j.id LIMIT 1`).bind(control.active_run_id).first<{id:number;run_id:number;lead_id:number;attempt_count:number;business_name:string}>();
  if(!job) return c.json({error:'No website is currently marked Building'},409);
  if(!['idle','offline','error'].includes(control.effective_state)) {
    const message=control.effective_state==='login_required'
      ? 'LandingSite.ai login is required. Sign in and the active build will continue automatically.'
      : 'The browser employee is still actively working on this website.';
    return c.json({error:message},409);
  }
  const editorMatch=control.worker_message?.match(/LandingSite editor:\s*(https:\/\/app\.landingsite\.ai\/chat\/[^\s]+)/i);
  const resumeMarker=editorMatch ? `${RESUME_EXISTING_MARKER} | ${editorMatch[1]}` : RESUME_EXISTING_MARKER;
  const released=await c.env.DB.prepare(`UPDATE builder_jobs SET status='retry',attempt_count=CASE WHEN attempt_count>0 THEN attempt_count-1 ELSE 0 END,failure_reason=?,ended_at=NULL,duration_ms=NULL,lock_token=NULL,locked_at=NULL,lease_expires_at=NULL,updated_at=datetime('now') WHERE id=? AND status='building'`).bind(resumeMarker,job.id).run();
  if(!released.meta.changes) return c.json({error:'The build changed state before it could be resumed. Refresh and try again.'},409);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE builder_runs SET status='running',ended_at=NULL,error_reason=NULL WHERE id=?`).bind(job.run_id),
    c.env.DB.prepare(`UPDATE builder_control SET paused=0,stop_requested=0,worker_state='running',current_step='Resume requested',worker_message='Waiting for browser employee to reuse the existing LandingSite editor.',updated_at=datetime('now') WHERE id=1 AND active_run_id=?`).bind(job.run_id),
  ]);
  await writeBuilderEvent(c.env.DB,{runId:job.run_id,jobId:job.id,eventType:'job_resume_requested',state:'retry',step:'Resume requested',message:`Reusing the existing LandingSite project for ${job.business_name}.`,metadata:{leadId:job.lead_id}});
  return c.json({ok:true,jobId:job.id,businessName:job.business_name});
});

builderAdminRouter.post('/retry-failed', async c => {
  const body=(await c.req.json().catch(()=>({}))) as {runId?:number};
  const control=await c.env.DB.prepare(`SELECT active_run_id FROM builder_control WHERE id=1`).first<{active_run_id:number|null}>();
  if(control?.active_run_id) {
    const result=await c.env.DB.prepare(`UPDATE builder_jobs SET status='retry',attempt_count=0,failure_reason=NULL,ended_at=NULL,duration_ms=NULL,updated_at=datetime('now') WHERE run_id=? AND status='failed' AND failure_reason NOT LIKE ? AND lead_id IN (SELECT l.id FROM leads l WHERE ${BUILDER_ELIGIBLE_LEAD})`).bind(control.active_run_id,`${ELIGIBILITY_GUARD_PREFIX}%`).run();
    await c.env.DB.batch([c.env.DB.prepare(`UPDATE builder_control SET paused=0,worker_state='running',updated_at=datetime('now') WHERE id=1`),c.env.DB.prepare(`UPDATE builder_runs SET status='running',ended_at=NULL,error_reason=NULL WHERE id=?`).bind(control.active_run_id)]);
    return c.json({retried:result.meta.changes});
  }
  const prior=body.runId
    ? await c.env.DB.prepare(`SELECT id FROM builder_runs WHERE id=?`).bind(body.runId).first<{id:number}>()
    : await c.env.DB.prepare(`SELECT id FROM builder_runs ORDER BY id DESC LIMIT 1`).first<{id:number}>();
  if(!prior) return c.json({error:'No failed builds to retry'},409);
  const failed=await c.env.DB.prepare(`SELECT j.lead_id FROM builder_jobs j JOIN leads l ON l.id=j.lead_id WHERE j.run_id=? AND j.status='failed' AND j.failure_reason NOT LIKE ? AND ${BUILDER_ELIGIBLE_LEAD}`).bind(prior.id,`${ELIGIBILITY_GUARD_PREFIX}%`).all<{lead_id:number}>();
  if(!failed.results.length) return c.json({error:'No failed builds to retry'},409);
  const created=await c.env.DB.prepare(`INSERT INTO builder_runs(status,total_jobs) VALUES('starting',?) RETURNING id`).bind(failed.results.length).first<{id:number}>();
  if(!created) return c.json({error:'Could not create retry run'},500);
  await c.env.DB.batch(failed.results.map(row=>c.env.DB.prepare(`INSERT INTO builder_jobs(lead_id,run_id,status) VALUES(?,?,'waiting')`).bind(row.lead_id,created.id)));
  await c.env.DB.prepare(`UPDATE builder_control SET active_run_id=?,paused=0,stop_requested=0,worker_state='starting',current_step='Waiting for browser worker',updated_at=datetime('now') WHERE id=1`).bind(created.id).run();
  await writeBuilderEvent(c.env.DB,{runId:created.id,eventType:'retry_run_started',state:'starting',step:'Waiting for browser worker',message:`Retrying ${failed.results.length} failed build${failed.results.length===1?'':'s'} from run #${prior.id}.`,metadata:{sourceRunId:prior.id}});
  return c.json({retried:failed.results.length});
});
