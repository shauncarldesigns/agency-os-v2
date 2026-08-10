import { Hono } from 'hono';
import type { Env, Lead } from '../types';
import { applySmsDeliveryStatus, classifyInbound, isPermanentSmsFailure, normalizePhone, personalize, routeSmsFailureToEmail, twilioSignatureValid } from '../services/messaging';
import { badRequest, log, notFound, serverError } from '../utils/errors';
import { outreachLeadSql } from '../services/outreachEligibility';

type Control = { status:string; mode:'test'|'production'; transport:'mock'|'twilio'; send_rate_seconds:number; stop_requested:number; last_error:string|null; updated_at:string };
type Conversation = { id:number; lead_id:number|null; phone_number:string; ai_mode:'auto'|'human'|'paused'; status:'open'|'closed'; needs_human:number; is_test:number };

export const messagingRouter = new Hono<{ Bindings: Env }>();
export const publicMessagingRouter = new Hono<{ Bindings: Env }>();
const TEXT_OUTREACH_ELIGIBLE_SQL=outreachLeadSql('leads','text');

async function control(env: Env) { return env.DB.prepare('SELECT * FROM messaging_control WHERE id=1').first<Control>(); }
async function conversationFor(env: Env, phone: string, isTest: boolean, leadId?: number|null) {
  const normalized = normalizePhone(phone);
  let row = await env.DB.prepare('SELECT * FROM messaging_conversations WHERE phone_number=? AND is_test=?').bind(normalized,isTest?1:0).first<Conversation>();
  if (!row) {
    const out = await env.DB.prepare(`INSERT INTO messaging_conversations(lead_id,phone_number,is_test) VALUES(?,?,?)`).bind(leadId??null,normalized,isTest?1:0).run();
    row = await env.DB.prepare('SELECT * FROM messaging_conversations WHERE id=?').bind(out.meta.last_row_id).first<Conversation>();
  } else if (!row.lead_id && leadId) {
    await env.DB.prepare('UPDATE messaging_conversations SET lead_id=?,updated_at=datetime(\'now\') WHERE id=?').bind(leadId,row.id).run(); row.lead_id=leadId;
  }
  return row!;
}

async function sendProvider(env: Env, to: string, body: string, ctl: Control) {
  if (ctl.transport === 'mock') return { sid:`MOCK-${crypto.randomUUID()}`, status:'delivered' };
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_MESSAGING_SERVICE_SID) throw new Error('Twilio Messaging Service is not configured');
  const form = new URLSearchParams({ To:to, Body:body, MessagingServiceSid:env.TWILIO_MESSAGING_SERVICE_SID, StatusCallback:`${env.OUTREACH_PUBLIC_URL || 'https://api.shauncarldesigns.com'}/webhooks/twilio/sms/status` });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, { method:'POST', headers:{ Authorization:`Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'Content-Type':'application/x-www-form-urlencoded' }, body:form });
  const json = await res.json() as { sid?:string; status?:string; message?:string; code?:number };
  if (!res.ok || !json.sid) throw new Error(`${json.code || res.status}: ${json.message || `Twilio HTTP ${res.status}`}`);
  return { sid:json.sid, status:json.status || 'queued' };
}

async function persistOutbound(env: Env, conversation: Conversation, recipient:string, body:string, sentBy:'ai'|'shaun'|'system', idempotencyKey?:string, outreachAction?:string) {
  const ctl = await control(env); if (!ctl) throw new Error('Messaging migration has not been applied');
  if (ctl.status === 'paused' && sentBy !== 'shaun') throw new Error('Messaging Employee is paused');
  if (conversation.status === 'closed') throw new Error('This conversation is SMS opted out');
  if (ctl.mode === 'production' && conversation.lead_id) {
    const suppression=await env.DB.prepare('SELECT sms_suppressed FROM leads WHERE id=?').bind(conversation.lead_id).first<{sms_suppressed:number}>();
    if(suppression?.sms_suppressed===1) throw new Error('SMS is suppressed for this lead');
  }
  let actualRecipient = recipient;
  if (ctl.mode === 'test') {
    actualRecipient = env.TEST_SMS_NUMBER_1 || env.TEST_SMS_NUMBER_2 || '';
    if (!actualRecipient && ctl.transport === 'twilio') throw new Error('Test mode requires TEST_SMS_NUMBER_1 or TEST_SMS_NUMBER_2');
    if (!actualRecipient) actualRecipient = recipient;
  }
  if (idempotencyKey) {
    const existing = await env.DB.prepare('SELECT * FROM messaging_messages WHERE idempotency_key=?').bind(idempotencyKey).first();
    if (existing) return existing;
  }
  const out = await env.DB.prepare(`INSERT INTO messaging_messages(conversation_id,direction,sender,recipient,body,twilio_status,sent_by,idempotency_key,outreach_action) VALUES(?,'outbound',?,?,?,'sending',?,?,?)`).bind(conversation.id,env.TWILIO_PHONE_NUMBER||env.TWILIO_MESSAGING_SERVICE_SID||'Messaging Service',actualRecipient,body,sentBy,idempotencyKey||null,outreachAction||null).run();
  try {
    const sent = await sendProvider(env, actualRecipient, body, ctl);
    await env.DB.prepare(`UPDATE messaging_messages SET twilio_sid=?,twilio_status=?,updated_at=datetime('now') WHERE id=?`).bind(sent.sid,sent.status,out.meta.last_row_id).run();
    await env.DB.prepare(`UPDATE messaging_conversations SET last_message_at=datetime('now'),updated_at=datetime('now') WHERE id=?`).bind(conversation.id).run();
    return env.DB.prepare('SELECT * FROM messaging_messages WHERE id=?').bind(out.meta.last_row_id).first();
  } catch (error) {
    const detail=(error as Error).message.slice(0,1000);
    const code=detail.match(/^(\d+):/)?.[1]||null;
    await env.DB.prepare(`UPDATE messaging_messages SET twilio_status='failed',twilio_error_code=?,twilio_error_description=?,updated_at=datetime('now') WHERE id=?`).bind(code,detail,out.meta.last_row_id).run();
    await env.DB.prepare(`UPDATE messaging_conversations SET last_message_at=datetime('now'),updated_at=datetime('now') WHERE id=?`).bind(conversation.id).run();
    throw error;
  }
}

messagingRouter.get('/status', async c => {
  try {
    const [ctl, ready, metrics, setup] = await Promise.all([
      control(c.env),
      c.env.DB.prepare(`SELECT COUNT(*) count FROM leads WHERE ${TEXT_OUTREACH_ELIGIBLE_SQL} AND pipeline_status='ready_to_send' AND COALESCE(sms_suppressed,0)=0 AND site_url IS NOT NULL`).first<{count:number}>(),
      c.env.DB.prepare(`SELECT COUNT(CASE WHEN direction='outbound' AND date(created_at)=date('now') THEN 1 END) sent_today,COUNT(CASE WHEN direction='inbound' AND date(created_at)=date('now') THEN 1 END) replies_today,COUNT(CASE WHEN sent_by='ai' AND date(created_at)=date('now') THEN 1 END) ai_responded,COUNT(CASE WHEN twilio_status IN ('failed','undelivered') THEN 1 END) failed FROM messaging_messages`).first(),
      Promise.resolve({ accountSid:!!c.env.TWILIO_ACCOUNT_SID, authToken:!!c.env.TWILIO_AUTH_TOKEN, messagingService:!!c.env.TWILIO_MESSAGING_SERVICE_SID, phoneNumber:!!c.env.TWILIO_PHONE_NUMBER, testNumber:!!(c.env.TEST_SMS_NUMBER_1||c.env.TEST_SMS_NUMBER_2), a2pRegistered:c.env.TWILIO_A2P_REGISTERED==='true', inboundUrl:`${(c.env.OUTREACH_PUBLIC_URL||new URL(c.req.url).origin).replace(/\/$/,'')}/webhooks/twilio/sms/inbound`, statusUrl:`${(c.env.OUTREACH_PUBLIC_URL||new URL(c.req.url).origin).replace(/\/$/,'')}/webhooks/twilio/sms/status` }),
    ]);
    const needs = await c.env.DB.prepare('SELECT COUNT(*) count FROM messaging_conversations WHERE needs_human=1').first<{count:number}>();
    return c.json({ control:ctl, readyToSend:ready?.count||0, metrics:{...(metrics||{}),needs_shaun:needs?.count||0}, setup, productionReady:setup.accountSid&&setup.authToken&&setup.messagingService&&setup.phoneNumber&&setup.a2pRegistered });
  } catch (err) { return c.json(serverError((err as Error).message),500); }
});

messagingRouter.post('/control', async c => {
  const body = await c.req.json().catch(()=>({})) as { action?:string; mode?:string; transport?:string; sendRateSeconds?:number };
  const ctl = await control(c.env); if (!ctl) return c.json(serverError('Messaging migration has not been applied'),500);
  const nextMode=body.mode||ctl.mode;
  const nextTransport=body.transport||ctl.transport;
  if (nextMode === 'production') {
    if (!c.env.TWILIO_ACCOUNT_SID||!c.env.TWILIO_AUTH_TOKEN||!c.env.TWILIO_MESSAGING_SERVICE_SID||!c.env.TWILIO_PHONE_NUMBER||c.env.TWILIO_A2P_REGISTERED!=='true') return c.json(badRequest('Production is locked until Twilio sender, Messaging Service, and A2P registration are confirmed'),400);
    if(nextTransport!=='twilio')return c.json(badRequest('Production mode requires Live Twilio transport'),400);
  }
  const status = body.action==='start'||body.action==='resume'?'active':body.action==='pause'?'paused':body.action==='stop'?'off':ctl.status;
  await c.env.DB.prepare(`UPDATE messaging_control SET status=?,mode=COALESCE(?,mode),transport=COALESCE(?,transport),send_rate_seconds=COALESCE(?,send_rate_seconds),stop_requested=0,last_error=NULL,updated_at=datetime('now') WHERE id=1`).bind(status,body.mode||null,body.transport||null,body.sendRateSeconds||null).run();
  return c.json({ control:await control(c.env) });
});

messagingRouter.get('/conversations', async c => {
  const filter = c.req.query('filter')||'all';
  const where = filter==='unread'?'AND conversation.unread_count>0':filter==='needs_shaun'?'AND conversation.needs_human=1':filter==='ai' ? "AND conversation.ai_mode='auto'" : filter==='human'?"AND conversation.ai_mode='human'":filter==='failed'?"AND EXISTS(SELECT 1 FROM messaging_messages m WHERE m.conversation_id=conversation.id AND m.twilio_status IN ('failed','undelivered'))":filter==='opted_out'?"AND (conversation.status='closed' OR COALESCE(lead.sms_suppressed,0)=1)":'';
  const rows=await c.env.DB.prepare(`SELECT conversation.*,lead.company,lead.contact,lead.pipeline_status,lead.engagement_score,lead.site_url,lead.email,lead.sms_suppressed,(SELECT body FROM messaging_messages m WHERE m.conversation_id=conversation.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) last_body,EXISTS(SELECT 1 FROM messaging_messages failed_message WHERE failed_message.conversation_id=conversation.id AND failed_message.twilio_status IN ('failed','undelivered')) has_failed FROM messaging_conversations conversation LEFT JOIN leads lead ON lead.id=conversation.lead_id WHERE 1=1 ${where} ORDER BY conversation.last_message_at DESC,conversation.id DESC LIMIT 300`).all();
  return c.json({ conversations:rows.results||[] });
});

messagingRouter.get('/conversations/:id', async c => {
  const id=Number(c.req.param('id')); const conversation=await c.env.DB.prepare(`SELECT conversation.*,lead.company,lead.contact,lead.pipeline_status,lead.engagement_score,lead.engagement_grade,lead.site_url,lead.site_url_raw,lead.email,lead.sms_suppressed,lead.sms_suppression_reason FROM messaging_conversations conversation LEFT JOIN leads lead ON lead.id=conversation.lead_id WHERE conversation.id=?`).bind(id).first();
  if(!conversation)return c.json(notFound('Conversation'),404);
  const messages=await c.env.DB.prepare('SELECT * FROM messaging_messages WHERE conversation_id=? ORDER BY created_at,id').bind(id).all();
  await c.env.DB.prepare('UPDATE messaging_conversations SET unread_count=0 WHERE id=?').bind(id).run();
  return c.json({conversation,messages:messages.results||[]});
});

messagingRouter.post('/conversations/:id/send', async c => {
  try { const id=Number(c.req.param('id')); const body=await c.req.json() as {body?:string}; const conv=await c.env.DB.prepare('SELECT * FROM messaging_conversations WHERE id=?').bind(id).first<Conversation>(); if(!conv)return c.json(notFound('Conversation'),404); if(!body.body?.trim())return c.json(badRequest('Message body is required'),400); const message=await persistOutbound(c.env,conv,conv.phone_number,body.body.trim(),'shaun'); return c.json({message}); } catch(err){const message=(err as Error).message;if(/opted out|SMS is suppressed|Test mode requires/i.test(message))return c.json(badRequest(message),400);return c.json(serverError(message),500);}
});

messagingRouter.post('/messages/:id/retry',async c=>{
  try{
    const id=Number(c.req.param('id'));
    const row=await c.env.DB.prepare(`SELECT message.*,conversation.lead_id,conversation.phone_number,conversation.ai_mode,conversation.status conversation_status,conversation.needs_human,conversation.is_test FROM messaging_messages message JOIN messaging_conversations conversation ON conversation.id=message.conversation_id WHERE message.id=?`).bind(id).first<any>();
    if(!row)return c.json(notFound('Message'),404);
    if(row.direction!=='outbound'||!['failed','undelivered'].includes(row.twilio_status))return c.json(badRequest('Only failed outbound messages can be retried'),400);
    if(isPermanentSmsFailure(row.twilio_error_code,row.twilio_error_description))return c.json(badRequest('This is a permanent SMS failure. Keep the lead suppressed and use Email Outreach when eligible.'),400);
    const conv:Conversation={id:row.conversation_id,lead_id:row.lead_id,phone_number:row.phone_number,ai_mode:row.ai_mode,status:row.conversation_status,needs_human:row.needs_human,is_test:row.is_test};
    const message=await persistOutbound(c.env,conv,conv.phone_number,row.body,'shaun',`${c.env.ENV||'local'}:retry:${id}:${crypto.randomUUID()}`,row.outreach_action||'manual_retry');
    await c.env.DB.prepare("UPDATE messaging_messages SET twilio_status='retried',updated_at=datetime('now') WHERE id=?").bind(id).run();
    return c.json({message});
  }catch(err){return c.json(serverError((err as Error).message),500);}
});

messagingRouter.post('/conversations/:id/action', async c => { const id=Number(c.req.param('id'));const body=await c.req.json() as {action?:string};const conv=await c.env.DB.prepare('SELECT * FROM messaging_conversations WHERE id=?').bind(id).first<Conversation>();if(!conv)return c.json(notFound('Conversation'),404);if(body.action==='suppress_sms'){await c.env.DB.prepare("UPDATE messaging_conversations SET status='closed',needs_human=0,needs_human_reason=NULL,updated_at=datetime('now') WHERE id=?").bind(id).run();if(!conv.is_test&&conv.lead_id)await c.env.DB.prepare("UPDATE leads SET sms_suppressed=1,sms_suppressed_at=datetime('now'),sms_suppression_reason='Suppressed manually',updated_at=datetime('now') WHERE id=?").bind(conv.lead_id).run();return c.json({ok:true});}const sets=body.action==='take_over'?"ai_mode='human'":body.action==='return_to_ai'?"ai_mode='auto'":body.action==='mark_needs_shaun'?"needs_human=1,needs_human_reason='Marked manually'":body.action==='clear_needs_shaun'?"needs_human=0,needs_human_reason=NULL":null;if(!sets)return c.json(badRequest('Invalid action'),400);await c.env.DB.prepare(`UPDATE messaging_conversations SET ${sets},updated_at=datetime('now') WHERE id=?`).bind(id).run();return c.json({ok:true}); });

messagingRouter.get('/scripts',async c=>c.json({scripts:(await c.env.DB.prepare('SELECT * FROM messaging_scripts ORDER BY label').all()).results||[]}));
messagingRouter.put('/scripts/:key',async c=>{const body=await c.req.json() as {body?:string;approved?:boolean};await c.env.DB.prepare('UPDATE messaging_scripts SET body=?,approved=?,updated_at=datetime(\'now\') WHERE script_key=?').bind(body.body?.trim()||null,body.approved?1:0,c.req.param('key')).run();return c.json({ok:true});});

messagingRouter.post('/simulate',async c=>{
  const body=await c.req.json() as {body?:string;leadId?:number;testPhone?:string;scenario?:'inbound'|'optout'|'duplicate'|'delivered'|'failed'|'network_error'|'status_duplicate'};
  const scenario=body.scenario||'inbound';
  let lead:Lead|null=null;
  if(body.leadId)lead=await c.env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(body.leadId).first<Lead>();
  const phone=lead?.phone_e164||lead?.phone||normalizePhone(body.testPhone||'+15555550100');
  const conv=await conversationFor(c.env,phone,true,lead?.id);
  if(scenario==='inbound'||scenario==='optout'||scenario==='duplicate'){
    const reply=scenario==='optout'?'STOP':body.body?.trim();
    if(!reply)return c.json(badRequest('Reply is required'),400);
    const sid=`SIM-${crypto.randomUUID()}`;
    const first=await processInbound(c.env,conv,reply,sid,phone,c.env.TWILIO_PHONE_NUMBER||'test');
    const second=scenario==='duplicate'?await processInbound(c.env,conv,reply,sid,phone,c.env.TWILIO_PHONE_NUMBER||'test'):null;
    return c.json({conversationId:conv.id,scenario,first,second,duplicatePrevented:second==='duplicate'});
  }
  if(scenario==='status_duplicate'){
    const sid=`SIM-${crypto.randomUUID()}`;
    await c.env.DB.prepare(`INSERT INTO messaging_messages(conversation_id,direction,sender,recipient,body,twilio_sid,twilio_status,sent_by,idempotency_key,outreach_action) VALUES(?,'outbound',?,?,?,?,'sent','system',?,'simulated')`).bind(conv.id,c.env.TWILIO_PHONE_NUMBER||'Messaging Service',phone,'[Simulated duplicate status callback]',sid,`test:scenario:${crypto.randomUUID()}`).run();
    const first=await applySmsDeliveryStatus(c.env,sid,'delivered',null,null);
    const second=await applySmsDeliveryStatus(c.env,sid,'delivered',null,null);
    await c.env.DB.prepare(`UPDATE messaging_conversations SET last_message_at=datetime('now'),updated_at=datetime('now') WHERE id=?`).bind(conv.id).run();
    return c.json({conversationId:conv.id,scenario,first,second,duplicatePrevented:second.duplicate});
  }
  const status=scenario==='delivered'?'delivered':'failed';
  const errorCode=scenario==='failed'?'30006':null;
  const errorDescription=scenario==='failed'?'30006: Landline or unreachable destination (simulated)':scenario==='network_error'?'Simulated Twilio network error':null;
  const inserted=await c.env.DB.prepare(`INSERT INTO messaging_messages(conversation_id,direction,sender,recipient,body,twilio_sid,twilio_status,twilio_error_code,twilio_error_description,sent_by,idempotency_key,outreach_action) VALUES(?,'outbound',?,?,?,?,?,?,?,?,?,?)`).bind(conv.id,c.env.TWILIO_PHONE_NUMBER||'Messaging Service',phone,`[Simulated ${scenario.replace('_',' ')}]`,scenario==='network_error'?null:`SIM-${crypto.randomUUID()}`,status,errorCode,errorDescription,'system',`test:scenario:${crypto.randomUUID()}`,'simulated').run();
  await c.env.DB.prepare(`UPDATE messaging_conversations SET last_message_at=datetime('now'),updated_at=datetime('now') WHERE id=?`).bind(conv.id).run();
  return c.json({conversationId:conv.id,scenario,messageId:inserted.meta.last_row_id});
});

messagingRouter.post('/test-send',async c=>{try{const ctl=await control(c.env);if(!ctl)return c.json(serverError('Messaging migration has not been applied'),500);const number=c.env.TEST_SMS_NUMBER_1||c.env.TEST_SMS_NUMBER_2;if(!number)return c.json(badRequest('Configure TEST_SMS_NUMBER_1 first'),400);const conv=await conversationFor(c.env,number,true,null);const message=await persistOutbound(c.env,conv,number,'Agency OS Messaging test. Reply to confirm the inbound webhook is connected.','shaun');return c.json({conversationId:conv.id,message});}catch(err){return c.json(serverError((err as Error).message),500);}});

messagingRouter.delete('/test-data',async c=>{
  const ctl=await control(c.env);
  const body=await c.req.json().catch(()=>({})) as {confirm?:string};
  if(!ctl||ctl.mode!=='test'||ctl.transport!=='mock')return c.json(badRequest('Test data can only be reset in Test mode with Mock transport'),400);
  if(body.confirm!=='RESET_TEST_MESSAGING')return c.json(badRequest('Explicit test reset confirmation is required'),400);
  const count=await c.env.DB.prepare('SELECT COUNT(*) count FROM messaging_conversations WHERE is_test=1').first<{count:number}>();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM messaging_ai_audit WHERE conversation_id IN (SELECT id FROM messaging_conversations WHERE is_test=1)'),
    c.env.DB.prepare('DELETE FROM messaging_messages WHERE conversation_id IN (SELECT id FROM messaging_conversations WHERE is_test=1)'),
    c.env.DB.prepare('DELETE FROM messaging_conversations WHERE is_test=1'),
  ]);
  return c.json({ok:true,deletedConversations:count?.count||0});
});

messagingRouter.delete('/conversations/:id/test-data',async c=>{
  const ctl=await control(c.env);
  const body=await c.req.json().catch(()=>({})) as {confirm?:string};
  const conversationId=Number(c.req.param('id'));
  if(!Number.isInteger(conversationId)||conversationId<=0)return c.json(badRequest('A valid conversation ID is required'),400);
  if(!ctl||ctl.mode!=='test'||ctl.transport!=='mock')return c.json(badRequest('Test conversations can only be reset in Test mode with Mock transport'),400);
  if(body.confirm!=='RESET_TEST_CONVERSATION')return c.json(badRequest('Explicit conversation reset confirmation is required'),400);
  const conversation=await c.env.DB.prepare('SELECT id,is_test FROM messaging_conversations WHERE id=?').bind(conversationId).first<{id:number;is_test:number}>();
  if(!conversation)return c.json({error:'Conversation not found'},404);
  if(conversation.is_test!==1)return c.json(badRequest('Production conversations cannot be reset'),400);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM messaging_ai_audit WHERE conversation_id=?').bind(conversationId),
    c.env.DB.prepare('DELETE FROM messaging_messages WHERE conversation_id=?').bind(conversationId),
    c.env.DB.prepare('DELETE FROM messaging_conversations WHERE id=? AND is_test=1').bind(conversationId),
  ]);
  return c.json({ok:true,deletedConversationId:conversationId});
});

messagingRouter.post('/run',async c=>{const ctl=await control(c.env);if(!ctl||ctl.status!=='active')return c.json(badRequest('Start or resume the Messaging Employee first'),400);const leads=await c.env.DB.prepare(`SELECT * FROM leads WHERE ${TEXT_OUTREACH_ELIGIBLE_SQL} AND pipeline_status='ready_to_send' AND site_url IS NOT NULL AND COALESCE(sms_suppressed,0)=0 ORDER BY opportunity_score DESC NULLS LAST,id LIMIT 25`).all<Lead>();let sent=0,failed=0,skipped=0;for(const [index,lead] of (leads.results||[]).entries()){try{const outboundKey=`${ctl.mode}:lead:${lead.id}:intro_sent`;const existing=await c.env.DB.prepare('SELECT id FROM messaging_messages WHERE idempotency_key=?').bind(outboundKey).first();if(existing){skipped++;continue;}const conv=await conversationFor(c.env,lead.phone_e164||lead.phone||'',ctl.mode==='test',lead.id);const script=await c.env.DB.prepare("SELECT body FROM messaging_scripts WHERE script_key='initial' AND approved=1").first<{body:string}>();const trackingOrigin=(c.env.OUTREACH_PUBLIC_URL||new URL(c.req.url).origin).replace(/\/$/,'');const message=personalize(script!.body,lead,`${trackingOrigin}/r/${lead.id}`);await persistOutbound(c.env,conv,conv.phone_number,message,'system',outboundKey,'intro_sent');if(ctl.mode==='production'){await c.env.DB.batch([c.env.DB.prepare("UPDATE leads SET pipeline_status='sent_no_reply',pipeline_last_action_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND pipeline_status='ready_to_send'").bind(lead.id),c.env.DB.prepare("INSERT INTO lead_activity(lead_id,action,from_status,to_status,meta) VALUES(?,'intro_sent','ready_to_send','sent_no_reply',?)").bind(lead.id,JSON.stringify({channel:'sms',source:'messaging_employee'}))]);}sent++;}catch(err){failed++;const detail=(err as Error).message;log('error','messaging',`Lead ${lead.id} send failed`,err);const match=detail.match(/^(\d+):/);if(isPermanentSmsFailure(match?.[1]||null,detail))await routeSmsFailureToEmail(c.env,lead.id,detail);}if(ctl.transport==='twilio'&&index<(leads.results||[]).length-1)await new Promise(resolve=>setTimeout(resolve,Math.max(1,ctl.send_rate_seconds)*1000));}return c.json({processed:(leads.results||[]).length,sent,failed,skipped});});

async function processInbound(env:Env,conv:Conversation,body:string,sid:string,from:string,to:string):Promise<'processed'|'duplicate'>{
  const existing=await env.DB.prepare('SELECT id FROM messaging_messages WHERE twilio_sid=?').bind(sid).first();if(existing)return 'duplicate';
  const intent=classifyInbound(body);const inserted=await env.DB.prepare(`INSERT INTO messaging_messages(conversation_id,direction,sender,recipient,body,twilio_sid,twilio_status,sent_by,intent) VALUES(?,'inbound',?,?,?,?,'received','system',?)`).bind(conv.id,from,to,body,sid,intent.intent).run();
  if(conv.status==='closed'){
    await env.DB.prepare(`UPDATE messaging_conversations SET unread_count=unread_count+1,last_message_at=datetime('now'),needs_human=0,needs_human_reason=NULL,updated_at=datetime('now') WHERE id=?`).bind(conv.id).run();
    await env.DB.prepare(`INSERT INTO messaging_ai_audit(conversation_id,inbound_message_id,intent,confidence,generated_response,auto_sent,escalated) VALUES(?,?,'STOP_OR_OPTOUT',1,NULL,0,0)`).bind(conv.id,inserted.meta.last_row_id).run();
    return 'processed';
  }
  if(intent.intent==='STOP_OR_OPTOUT'||intent.intent==='NOT_INTERESTED'){
    await env.DB.prepare("UPDATE messaging_conversations SET status='closed',needs_human=0,needs_human_reason=NULL,updated_at=datetime('now') WHERE id=?").bind(conv.id).run();
    if(intent.intent==='STOP_OR_OPTOUT'&&!conv.is_test&&conv.lead_id)await env.DB.prepare(`UPDATE leads SET sms_suppressed=1,sms_suppressed_at=datetime('now'),sms_suppression_reason='Recipient opt-out',updated_at=datetime('now') WHERE id=?`).bind(conv.lead_id).run();
  }
  let script:{body:string}|null=null;if(intent.scriptKey)script=await env.DB.prepare('SELECT body FROM messaging_scripts WHERE script_key=? AND approved=1 AND body IS NOT NULL').bind(intent.scriptKey).first<{body:string}>();
  const terminalIntent=intent.intent==='STOP_OR_OPTOUT'||intent.intent==='NOT_INTERESTED';
  const escalate=terminalIntent?false:intent.escalate||!script;await env.DB.prepare(`UPDATE messaging_conversations SET unread_count=unread_count+1,last_message_at=datetime('now'),needs_human=?,needs_human_reason=?,updated_at=datetime('now') WHERE id=?`).bind(escalate?1:0,escalate?`${intent.intent} requires review`:null,conv.id).run();
  const audit = await env.DB.prepare(`INSERT INTO messaging_ai_audit(conversation_id,inbound_message_id,intent,confidence,script_key,generated_response,auto_sent,escalated) VALUES(?,?,?,?,?,?,0,?)`).bind(conv.id,inserted.meta.last_row_id,intent.intent,intent.confidence,intent.scriptKey,script?.body||null,escalate?1:0).run();
  if(!conv.is_test&&conv.lead_id&&intent.intent==='NOT_INTERESTED')await env.DB.prepare("UPDATE leads SET pipeline_status='archived',pipeline_last_action_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND pipeline_status IN ('sent_no_reply','engaged')").bind(conv.lead_id).run();
  // The public handler has already returned this work through waitUntil. Only
  // approved scripts, active automation, and AUTO conversations can send.
  const ctl=await control(env);
  if(!escalate&&script&&intent.intent!=='STOP_OR_OPTOUT'&&ctl?.status==='active'&&conv.ai_mode==='auto'){
    const lead=conv.lead_id?await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(conv.lead_id).first<Lead>():null;
    const trackingOrigin=(env.OUTREACH_PUBLIC_URL||'https://try.shauncarldesigns.com').replace(/\/$/,'');
    const response=personalize(script.body,lead,lead?`${trackingOrigin}/r/${lead.id}`:undefined);
    await persistOutbound(env,conv,conv.phone_number,response,'ai',`reply:${sid}:${intent.scriptKey}`);
    await env.DB.prepare('UPDATE messaging_ai_audit SET generated_response=?,auto_sent=1 WHERE id=?').bind(response,audit.meta.last_row_id).run();
  }
  return 'processed';
}

publicMessagingRouter.post('/webhooks/twilio/sms/inbound',async c=>{const raw=await c.req.text();const params=new URLSearchParams(raw);if(!c.env.TWILIO_AUTH_TOKEN||!await twilioSignatureValid(c.req.raw,c.env.TWILIO_AUTH_TOKEN,params))return c.text('Forbidden',403);const from=normalizePhone(params.get('From')||'');const sid=params.get('MessageSid')||'';const body=params.get('Body')||'';const lead=await c.env.DB.prepare('SELECT * FROM leads WHERE phone_e164=? OR phone=? LIMIT 1').bind(from,params.get('From')).first<Lead>();const conv=await conversationFor(c.env,from,false,lead?.id);c.executionCtx.waitUntil(processInbound(c.env,conv,body,sid,from,params.get('To')||''));return c.text('<Response></Response>',200,{'Content-Type':'text/xml'});});

publicMessagingRouter.post('/webhooks/twilio/sms/status',async c=>{const raw=await c.req.text();const params=new URLSearchParams(raw);if(!c.env.TWILIO_AUTH_TOKEN||!await twilioSignatureValid(c.req.raw,c.env.TWILIO_AUTH_TOKEN,params))return c.text('Forbidden',403);await applySmsDeliveryStatus(c.env,params.get('MessageSid')||'',params.get('MessageStatus')||'unknown',params.get('ErrorCode'),params.get('ErrorMessage'));return c.text('<Response></Response>',200,{'Content-Type':'text/xml'});});
