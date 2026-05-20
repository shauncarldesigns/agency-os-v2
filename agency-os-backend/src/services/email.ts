// Resend transactional email — minimal wrapper.
import { log } from '../utils/errors';

export interface EmailInput {
  to: string;
  from: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export async function sendEmail(apiKey: string, input: EmailInput): Promise<{ id: string }> {
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      reply_to: input.replyTo,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    log('error', 'email', `Resend send failed: ${res.status}`, { err: err.slice(0, 300) });
    throw new Error(`Resend API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as { id: string };
  log('info', 'email', `Sent to ${input.to}`, { id: data.id });
  return data;
}
