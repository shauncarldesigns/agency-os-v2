import type { Lead } from '../types';

export type MessagingIntent =
  | 'PRICE_QUESTION'
  | 'POSITIVE_INTEREST'
  | 'WANTS_CALL'
  | 'WANTS_MORE_INFO'
  | 'WHO_IS_THIS'
  | 'WHAT_IS_THIS'
  | 'ALREADY_HAS_WEBSITE'
  | 'NOT_INTERESTED'
  | 'FOLLOW_UP_LATER'
  | 'DID_NOT_RECEIVE_LINK'
  | 'TECHNICAL_QUESTION'
  | 'STOP_OR_OPTOUT'
  | 'UNKNOWN';

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw.trim();
}

export function classifyInbound(body: string): {
  intent: MessagingIntent;
  confidence: number;
  scriptKey: string | null;
  escalate: boolean;
} {
  const s = body.trim().toLowerCase();
  if (/^(stop|stopall|unsubscribe|cancel|end|quit)\b/.test(s)) return { intent:'STOP_OR_OPTOUT', confidence:1, scriptKey:null, escalate:false };
  if (/\b(how much|price|pricing|cost|rate)\b/.test(s)) return { intent:'PRICE_QUESTION', confidence:.96, scriptKey:'price_question', escalate:true };
  if (/\b(call me|give me a call|can you call|phone me)\b/.test(s)) return { intent:'WANTS_CALL', confidence:.97, scriptKey:'wants_call', escalate:true };
  if (/\b(who is this|who are you)\b/.test(s)) return { intent:'WHO_IS_THIS', confidence:.98, scriptKey:'who_is_this', escalate:false };
  if (/\b(what is this|what's this|why did you text)\b/.test(s)) return { intent:'WHAT_IS_THIS', confidence:.94, scriptKey:'what_is_this', escalate:false };
  if (/\b(already have|have a website|already got).*\b(site|website)\b/.test(s)) return { intent:'ALREADY_HAS_WEBSITE', confidence:.94, scriptKey:'already_has_website', escalate:false };
  if (/\b(not interested|no thanks|don't want|do not want)\b/.test(s)) return { intent:'NOT_INTERESTED', confidence:.98, scriptKey:'not_interested', escalate:false };
  if (/\b(next (week|month)|later|another time|follow up)\b/.test(s)) return { intent:'FOLLOW_UP_LATER', confidence:.88, scriptKey:'follow_up_later', escalate:false };
  if (/\b(didn't|did not|never|can't|cannot).*\b(link|receive|open)\b/.test(s)) return { intent:'DID_NOT_RECEIVE_LINK', confidence:.92, scriptKey:'did_not_receive_link', escalate:false };
  if (/\b(looks good|love it|interested|let's do|want it)\b/.test(s)) return { intent:'POSITIVE_INTEREST', confidence:.91, scriptKey:'positive_interest', escalate:true };
  if (/\b(more info|tell me more|details)\b/.test(s)) return { intent:'WANTS_MORE_INFO', confidence:.86, scriptKey:null, escalate:true };
  if (/\b(broken|error|not working|technical)\b/.test(s)) return { intent:'TECHNICAL_QUESTION', confidence:.82, scriptKey:null, escalate:true };
  return { intent:'UNKNOWN', confidence:.35, scriptKey:null, escalate:true };
}

export function personalize(template: string, lead: Lead | null, trackedDemoUrl?: string): string {
  return template
    .replaceAll('[Name]', lead?.contact?.split(/\s+/)[0] || 'there')
    .replaceAll('[Company]', lead?.company || 'your business')
    .replaceAll('[demo link]', trackedDemoUrl || lead?.site_url || '')
    .replaceAll('[pricing link]', 'https://shauncarldesigns.com/pricing');
}

export function isPermanentSmsFailure(code: string | null, description: string | null): boolean {
  const permanentCodes = new Set(['21211','21610','21612','21614','30003','30005','30006','30007','30008']);
  const text = (description || '').toLowerCase();
  return (!!code && permanentCodes.has(code)) || /invalid|not a mobile|landline|voip|unreachable|unknown destination/.test(text);
}

export async function twilioSignatureValid(request: Request, authToken: string, params: URLSearchParams): Promise<boolean> {
  const supplied=request.headers.get('X-Twilio-Signature');
  if(!supplied)return false;
  const sorted=[...params.entries()].sort(([a],[b])=>a.localeCompare(b));
  let data=request.url;
  for(const [key,value] of sorted)data+=key+value;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(authToken),{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data));
  const expected=btoa(String.fromCharCode(...new Uint8Array(signed)));
  if(expected.length!==supplied.length)return false;
  let diff=0;
  for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^supplied.charCodeAt(i);
  return diff===0;
}
