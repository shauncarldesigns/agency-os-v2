import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentInstructions, VOICE_AGENT_PROMPT_VERSION } from '../src/services/voiceAgent.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(scriptDir, '../.dev.vars');
const apiBase = 'https://api.retellai.com';
const agentName = 'Agency OS Service Business Receptionist';
const inboundWebhookUrl = 'https://agency-os-v2-api.lively-morning-d9de.workers.dev/webhooks/retell/inbound';
const eventsWebhookUrl = 'https://agency-os-v2-api.lively-morning-d9de.workers.dev/webhooks/retell/events';
const demoCodeWebhookUrl = 'https://agency-os-v2-api.lively-morning-d9de.workers.dev/webhooks/retell/demo-code';
const postCallAnalysisData = [
  ['caller_classification', 'Classify from explicit transcript evidence. Use existing_customer only when the caller clearly says they are already a customer or refers to prior work, an invoice, warranty, appointment, or ongoing job. A caller requesting service, asking about services, or describing a problem without that evidence is new_customer. Never infer existing_customer merely because the caller sounds familiar with the business. Other values: emergency, personal_vip, vendor, applicant, cold_sales, spam, or unknown.'],
  ['caller_name', 'Caller name, or an empty string if it was not provided.'],
  ['callback_number', 'Best callback number, or an empty string if it was not provided.'],
  ['caller_email', 'Caller email address, or an empty string if it was not provided.'],
  ['service_requested', 'The service or reason for the call.'],
  ['location', 'Service city, address, or ZIP supplied by the caller.'],
  ['urgency', 'Emergency, urgent, normal, or unknown.'],
  ['preferred_timing', 'When the caller wants contact or service.'],
  ['final_outcome', 'Conclude as callback_requested, screened, message_taken, or incomplete.'],
].map(([name, description]) => ({ type: 'string', name, description, examples: [''], required: false }));

function readDevVars() {
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) return [];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[match[1], value]];
  }));
}

const apiKey = process.env.RETELL_API_KEY || readDevVars().RETELL_API_KEY;
const sharedPhoneNumber = process.env.RETELL_SHARED_PHONE_NUMBER || readDevVars().RETELL_SHARED_PHONE_NUMBER;
if (!apiKey) throw new Error('RETELL_API_KEY is not configured in the environment or agency-os-backend/.dev.vars');

async function request(method, route, body) {
  const response = await fetch(`${apiBase}${route}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${route} failed (${response.status}): ${String(payload.message || 'Unknown Retell error').slice(0, 500)}`);
  return payload;
}

const defaultDynamicVariables = {
  business_id: 'internal-plumber-demo',
  business_name: 'Lakeside Plumbing & Drain',
  business_phone: '',
  business_timezone: 'America/Chicago',
  operating_mode: 'intake_only',
  current_hours_status: 'unknown',
  transfer_destination: '',
  transfer_enabled: 'false',
  emergency_transfer_enabled: 'false',
  demo_session_id: '',
  prospect_id: '',
  caller_type_if_known: 'unknown',
  access_code_required: 'false',
  receptionist_name: 'Claire',
  conference_demo_mode: 'false',
  greeting: 'Thanks for calling Lakeside Plumbing & Drain. This is Claire. How can I help you today?',
  services: 'Residential plumbing repairs, drain cleaning, water heater service, fixture installation, leak diagnosis, and emergency plumbing intake.',
  service_area: 'The greater Green Bay, Wisconsin area. Do not promise coverage until the caller provides a location.',
  business_hours: 'Monday through Friday, 7:30 AM to 5:00 PM Central. After-hours calls are recorded for follow-up.',
  business_rules: JSON.stringify({ requiredIntakeFields: ['callerName', 'callbackNumber', 'requestedService', 'location', 'urgency', 'preferredTiming'], solicitationMessages: false }),
};

const generalPrompt = buildAgentInstructions({
  businessName: '{{business_name}}',
  services: '{{services}}',
  serviceArea: '{{service_area}}',
  hours: '{{business_hours}}',
  businessRules: '{{business_rules}}',
}, { dynamicPolicy: true });

const llmConfig = {
  model: 'gpt-4.1',
  model_temperature: 0.2,
  start_speaker: 'agent',
  begin_message: '{{greeting}}',
  general_prompt: generalPrompt,
  default_dynamic_variables: defaultDynamicVariables,
  general_tools: [
    { type: 'end_call', name: 'end_call', description: 'End the call after the caller confirms there is nothing else they need or after a sales or spam call has been politely screened.' },
    {
      type: 'custom',
      name: 'lookup_demo_access_code',
      description: 'Validate a six-digit Agency OS demo access code. Call this immediately after a demo-line caller provides their code. Use the returned frozen business facts for the personalized receptionist demonstration.',
      url: demoCodeWebhookUrl,
      method: 'POST',
      parameters: {
        type: 'object',
        properties: { access_code: { type: 'string', description: 'The six-digit access code supplied by the caller, digits only.' } },
        required: ['access_code'],
      },
    },
  ],
};

const agents = await request('GET', '/list-agents?limit=100&is_latest=true');
const existing = Array.isArray(agents) ? agents.find((agent) => agent?.agent_name === agentName) : null;
if (existing) {
  const llmId = existing.response_engine?.type === 'retell-llm' ? existing.response_engine.llm_id : null;
  if (!llmId) throw new Error('Existing receptionist is not attached to a Retell LLM response engine');
  await request('PATCH', `/update-retell-llm/${encodeURIComponent(llmId)}`, llmConfig);
  const updated = await request('PATCH', `/update-agent/${encodeURIComponent(existing.agent_id)}`, {
    version_description: `MVP draft using ${VOICE_AGENT_PROMPT_VERSION}; generic plumber defaults; transfers disabled`,
    voice_speed: 1,
    enable_dynamic_voice_speed: false,
    responsiveness: 0.82,
    enable_dynamic_responsiveness: true,
    interruption_sensitivity: 0.65,
    denoising_mode: 'noise-and-background-speech-cancellation',
    guardrail_config: {
      output_topics: existing.guardrail_config?.output_topics ?? [],
      input_topics: [...new Set([...(existing.guardrail_config?.input_topics ?? []), 'platform_integrity_jailbreaking'])],
    },
    handbook_config: { ...(existing.handbook_config ?? {}), default_personality: true, ai_disclosure: true, scope_boundaries: true },
    enable_backchannel: true,
    backchannel_frequency: 0.25,
    data_storage_retention_days: 30,
    post_call_analysis_data: postCallAnalysisData,
    post_call_analysis_model: 'gpt-4.1-mini',
    webhook_url: eventsWebhookUrl,
  });
  if (sharedPhoneNumber) await request('PATCH', `/update-phone-number/${encodeURIComponent(sharedPhoneNumber)}`, { inbound_webhook_url: inboundWebhookUrl });
  console.log(JSON.stringify({ created: false, synchronized: true, phone_configured: Boolean(sharedPhoneNumber), agent_id: updated.agent_id, version: updated.version, llm_id: llmId, agent_name: updated.agent_name, is_published: updated.is_published }, null, 2));
  process.exit(0);
}

const llm = await request('POST', '/create-retell-llm', llmConfig);

const agent = await request('POST', '/create-agent', {
  response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
  voice_id: 'retell-Cimo',
  agent_name: agentName,
  version_description: `MVP draft using ${VOICE_AGENT_PROMPT_VERSION}; generic plumber defaults; transfers disabled`,
  language: 'en-US',
  voice_speed: 1,
  enable_dynamic_voice_speed: false,
  responsiveness: 0.82,
  enable_dynamic_responsiveness: true,
  interruption_sensitivity: 0.65,
  denoising_mode: 'noise-and-background-speech-cancellation',
  guardrail_config: { output_topics: [], input_topics: ['platform_integrity_jailbreaking'] },
  handbook_config: { default_personality: true, ai_disclosure: true, scope_boundaries: true },
  enable_backchannel: true,
  backchannel_frequency: 0.25,
  data_storage_retention_days: 30,
  post_call_analysis_data: postCallAnalysisData,
  post_call_analysis_model: 'gpt-4.1-mini',
  webhook_url: eventsWebhookUrl,
});

if (sharedPhoneNumber) await request('PATCH', `/update-phone-number/${encodeURIComponent(sharedPhoneNumber)}`, { inbound_webhook_url: inboundWebhookUrl });
console.log(JSON.stringify({ created: true, phone_configured: Boolean(sharedPhoneNumber), agent_id: agent.agent_id, version: agent.version, llm_id: llm.llm_id, agent_name: agent.agent_name, is_published: agent.is_published }, null, 2));
