import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, log, serverError } from '../utils/errors';

/**
 * POST /api/recordings
 *
 * Accepts a single audio file (multipart) from the cockpit's RecordButton.
 * Uploads to R2 at `calls/{leadId}/{timestamp}-{random}.{ext}` and returns
 * the public r2.dev URL. The cockpit then stores the URL in local state
 * and attaches it to the next outcome submit, which persists it on the
 * call_log row.
 *
 * Multipart form fields:
 *   - file:   the audio Blob (typically audio/webm;codecs=opus)
 *   - leadId: the lead this recording belongs to
 *   - ext:    optional file extension override (default: webm)
 *
 * Returns: { url: string, key: string, bytes: number }
 */

const PUBLIC_BASE_DEFAULT = 'https://pub-80e0811bf1bd472a8ff972eb94b314e0.r2.dev';

// Generate an 8-character base36 random suffix — ~ 41 bits of entropy, plenty
// for "unguessable by humans" while keeping the URL short.
function randomSuffix(): string {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}

export const recordingsRouter = new Hono<{ Bindings: Env }>();

recordingsRouter.post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody({ all: false });
  } catch (err) {
    log('error', 'recordings', 'multipart parse failed', err);
    return c.json(badRequest('Expected multipart/form-data'), 400);
  }

  const file = body.file as File | undefined;
  const leadIdRaw = body.leadId as string | undefined;
  const extRaw = (body.ext as string | undefined) ?? 'webm';

  if (!file) return c.json(badRequest('file is required'), 400);
  if (!leadIdRaw) return c.json(badRequest('leadId is required'), 400);

  const leadId = Number(leadIdRaw);
  if (!Number.isInteger(leadId) || leadId <= 0) {
    return c.json(badRequest('leadId must be a positive integer'), 400);
  }

  // Sanitize extension — only allow simple alphanumerics, fall back to webm.
  const ext = /^[a-zA-Z0-9]{1,5}$/.test(extRaw) ? extRaw.toLowerCase() : 'webm';

  const timestamp = Date.now();
  const key = `calls/${leadId}/${timestamp}-${randomSuffix()}.${ext}`;

  try {
    await c.env.RECORDINGS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || `audio/${ext}` },
    });
  } catch (err) {
    log('error', 'recordings', `R2 put failed for ${key}`, err);
    return c.json(serverError(`Upload failed: ${(err as Error).message}`), 500);
  }

  const base = c.env.RECORDINGS_PUBLIC_URL || PUBLIC_BASE_DEFAULT;
  const url = `${base}/${key}`;

  // Create a placeholder call_log row immediately so the recording is never
  // orphaned. If the operator later submits an outcome (Voicemail / Booked /
  // etc.), the cockpit passes back this row's id and the outcome handler
  // UPDATEs the row in place (no duplicate). If the operator never picks an
  // outcome, the row stays with outcome='Recording' and the recording is
  // still visible in the lead's call log.
  const placeholderNotes = '(call recorded — outcome not yet logged)';
  const inserted = await c.env.DB
    .prepare(`INSERT INTO call_log (lead_id, outcome, notes, recording_url) VALUES (?, 'Recording', ?, ?)`)
    .bind(leadId, placeholderNotes, url)
    .run();
  const callId = inserted.meta.last_row_id;

  log('info', 'recordings', `Uploaded ${file.size} bytes → ${key} (call_log #${callId})`);
  return c.json({ url, key, bytes: file.size, call_id: callId });
});
