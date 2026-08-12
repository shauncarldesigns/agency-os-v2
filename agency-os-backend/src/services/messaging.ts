import type { Env, Lead } from '../types';
import { scheduleEmailAutomation } from './emailAutomation';
import { isPermanentSmsFailure } from './messagingRules';
export { classifyInbound, isPermanentSmsFailure, normalizePhone, personalize, twilioSignatureValid } from './messagingRules';

export async function routeSmsFailureToEmail(env: Env, leadId: number, reason: string): Promise<boolean> {
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=? AND deleted_at IS NULL').bind(leadId).first<Lead>();
  if (!lead) return false;
  await env.DB.prepare(`UPDATE leads SET sms_suppressed=1,sms_suppressed_at=datetime('now'),sms_suppression_reason=?,phone_route=CASE WHEN phone_line_type IN ('landline','fixedVoip','nonFixedVoip') THEN 'call' ELSE 'review' END,updated_at=datetime('now') WHERE id=?`).bind(reason, leadId).run();
  await env.DB.prepare(`INSERT INTO lead_activity(lead_id,action,from_status,to_status,meta) VALUES(?, 'sms_routed_to_email', ?, ?, ?)`).bind(leadId, lead.pipeline_status, lead.pipeline_status, JSON.stringify({ reason })).run();
  if (!lead.email || !lead.site_url) return false;
  return Boolean(await scheduleEmailAutomation(env, leadId));
}

export async function applySmsDeliveryStatus(
  env: Env,
  sid: string,
  status: string,
  code: string | null,
  description: string | null,
): Promise<{matched:boolean;duplicate:boolean;routedToEmail:boolean}> {
  const message=await env.DB.prepare(`
    SELECT message.id,message.twilio_status,message.twilio_error_code,
           message.twilio_error_description,conversation.lead_id,conversation.is_test
      FROM messaging_messages message
      JOIN messaging_conversations conversation ON conversation.id=message.conversation_id
     WHERE message.twilio_sid=?
  `).bind(sid).first<{
    id:number;twilio_status:string;twilio_error_code:string|null;
    twilio_error_description:string|null;lead_id:number|null;is_test:number;
  }>();
  if(!message)return {matched:false,duplicate:false,routedToEmail:false};
  const updated=await env.DB.prepare(`
    UPDATE messaging_messages
       SET twilio_status=?,twilio_error_code=?,twilio_error_description=?,updated_at=datetime('now')
     WHERE id=?
       AND NOT (twilio_status IS ? AND twilio_error_code IS ? AND twilio_error_description IS ?)
  `).bind(status,code,description,message.id,status,code,description).run();
  if(updated.meta.changes===0)return {matched:true,duplicate:true,routedToEmail:false};
  let routedToEmail=false;
  if(message.is_test!==1&&message.lead_id&&(status==='failed'||status==='undelivered')&&isPermanentSmsFailure(code,description)){
    routedToEmail=await routeSmsFailureToEmail(env,message.lead_id,description||`Twilio error ${code}`);
  }
  return {matched:true,duplicate:false,routedToEmail};
}
