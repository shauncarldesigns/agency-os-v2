import type { Env } from '../types';

export type RetellMode = 'mock' | 'live';

export function retellMode(env: Env): RetellMode {
  return env.RETELL_MODE === 'live' ? 'live' : 'mock';
}

export function retellHealth(env: Env) {
  const mode = retellMode(env);
  return {
    mode,
    apiKeyConfigured: Boolean(env.RETELL_API_KEY),
    defaultAgentConfigured: Boolean(env.RETELL_DEFAULT_AGENT_ID),
    defaultAgentId: env.RETELL_DEFAULT_AGENT_ID ?? null,
    sharedNumberConfigured: Boolean(env.RETELL_SHARED_PHONE_NUMBER),
    readyForLiveCalls: mode === 'live' && Boolean(env.RETELL_API_KEY && env.RETELL_DEFAULT_AGENT_ID && env.RETELL_SHARED_PHONE_NUMBER),
  };
}

const RETELL_API_BASE = 'https://api.retellai.com';
const MAX_RETELL_RESPONSE_BYTES = 1_000_000;

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_RETELL_RESPONSE_BYTES) throw new Error('Retell returned an unexpectedly large response');
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RETELL_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Retell returned an unexpectedly large response'); }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(merged);
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

async function retellGet(apiKey: string, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${RETELL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body: Record<string, unknown> = await boundedJson(response).catch(() => ({}));
  if (!response.ok) {
    const providerMessage = typeof body.message === 'string' ? body.message : `HTTP ${response.status}`;
    throw new Error(`Retell connection failed: ${providerMessage.slice(0, 200)}`);
  }
  return body;
}

export async function validateRetellApiKey(env: Env): Promise<{ ok: true; reachable: true; agentSampleCount: number }> {
  if (!env.RETELL_API_KEY) throw new Error('RETELL_API_KEY is not configured');
  const result = await retellGet(env.RETELL_API_KEY, '/list-agents?limit=1&is_latest=true') as unknown;
  return { ok: true, reachable: true, agentSampleCount: Array.isArray(result) ? result.length : 0 };
}

export async function discoverRetellResources(env: Env) {
  if (!env.RETELL_API_KEY) throw new Error('RETELL_API_KEY is not configured');
  const [agentPayload, phonePayload] = await Promise.all([
    retellGet(env.RETELL_API_KEY, '/list-agents?limit=50&is_latest=true') as unknown,
    retellGet(env.RETELL_API_KEY, '/v2/list-phone-numbers?limit=50') as unknown,
  ]);
  const agents = Array.isArray(agentPayload) ? agentPayload : [];
  const phones = phonePayload && typeof phonePayload === 'object' && Array.isArray((phonePayload as { items?: unknown }).items) ? (phonePayload as { items: unknown[] }).items : [];
  return {
    agents: agents.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object').map((agent) => ({
      id: typeof agent.agent_id === 'string' ? agent.agent_id : '', name: typeof agent.agent_name === 'string' ? agent.agent_name : 'Unnamed agent',
      version: typeof agent.version === 'number' ? agent.version : null, published: typeof agent.is_published === 'boolean' ? agent.is_published : null,
      voiceId: typeof agent.voice_id === 'string' ? agent.voice_id : null, language: typeof agent.language === 'string' ? agent.language : null,
    })).filter((agent) => agent.id),
    phoneNumbers: phones.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object').map((phone) => ({
      number: typeof phone.phone_number === 'string' ? phone.phone_number : '', pretty: typeof phone.phone_number_pretty === 'string' ? phone.phone_number_pretty : null,
      nickname: typeof phone.nickname === 'string' ? phone.nickname : null, type: typeof phone.phone_number_type === 'string' ? phone.phone_number_type : null,
      inboundAgentIds: Array.isArray(phone.inbound_agents) ? phone.inbound_agents.map((entry) => entry && typeof entry === 'object' && typeof (entry as { agent_id?: unknown }).agent_id === 'string' ? (entry as { agent_id: string }).agent_id : '').filter(Boolean) : [],
    })).filter((phone) => phone.number),
  };
}

export async function validateRetellConnection(env: Env): Promise<{
  agent: { ok: boolean; id: string | null; version: number | null; published: boolean | null };
  phone: { ok: boolean; number: string | null; type: string | null; inboundAgentId: string | null };
}> {
  if (!env.RETELL_API_KEY) throw new Error('RETELL_API_KEY is not configured');
  if (!env.RETELL_DEFAULT_AGENT_ID) throw new Error('RETELL_DEFAULT_AGENT_ID is not configured');
  if (!env.RETELL_SHARED_PHONE_NUMBER) throw new Error('RETELL_SHARED_PHONE_NUMBER is not configured');
  const [agent, phone] = await Promise.all([
    retellGet(env.RETELL_API_KEY, `/get-agent/${encodeURIComponent(env.RETELL_DEFAULT_AGENT_ID)}`),
    retellGet(env.RETELL_API_KEY, `/get-phone-number/${encodeURIComponent(env.RETELL_SHARED_PHONE_NUMBER)}`),
  ]);
  const inboundAgentId = typeof phone.inbound_agent_id === 'string'
    ? phone.inbound_agent_id
    : Array.isArray(phone.inbound_agents)
      ? phone.inbound_agents.find((entry) => entry && typeof entry === 'object' && typeof (entry as { agent_id?: unknown }).agent_id === 'string')?.agent_id ?? null
      : null;
  return {
    agent: { ok: agent.agent_id === env.RETELL_DEFAULT_AGENT_ID, id: typeof agent.agent_id === 'string' ? agent.agent_id : null, version: typeof agent.version === 'number' ? agent.version : null, published: typeof agent.is_published === 'boolean' ? agent.is_published : null },
    phone: { ok: phone.phone_number === env.RETELL_SHARED_PHONE_NUMBER && inboundAgentId === env.RETELL_DEFAULT_AGENT_ID, number: typeof phone.phone_number === 'string' ? phone.phone_number : null, type: typeof phone.phone_number_type === 'string' ? phone.phone_number_type : null, inboundAgentId },
  };
}
