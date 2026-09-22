import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, log, serverError } from '../utils/errors';
import { authenticatedRecordingUrl, recordingStorageRef } from '../utils/recordings';

/**
 * POST /api/recordings
 *
 * Accepts a single audio file (multipart) from the cockpit's RecordButton.
 * Uploads to R2 at `calls/{leadId}/{timestamp}-{random}.{ext}` and returns
 * an authenticated API URL. The cockpit then stores the URL in local state
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
  if (!file.type.startsWith('audio/')) return c.json(badRequest('file must be audio'), 400);
  if (file.size > 25 * 1024 * 1024) return c.json(badRequest('file must be 25 MB or smaller'), 413);
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

  const url = authenticatedRecordingUrl(c.req.url, key);
  const storageRef = recordingStorageRef(key);

  // Create a placeholder call_log row immediately so the recording is never
  // orphaned. If the operator later submits an outcome (Voicemail / Booked /
  // etc.), the cockpit passes back this row's id and the outcome handler
  // UPDATEs the row in place (no duplicate). If the operator never picks an
  // outcome, the row stays with outcome='Recording' and the recording is
  // still visible in the lead's call log.
  const placeholderNotes = '(call recorded — outcome not yet logged)';
  const inserted = await c.env.DB
    .prepare(`INSERT INTO call_log (lead_id, outcome, notes, recording_url) VALUES (?, 'Recording', ?, ?)`)
    .bind(leadId, placeholderNotes, storageRef)
    .run();
  const callId = inserted.meta.last_row_id;

  log('info', 'recordings', `Uploaded ${file.size} bytes → ${key} (call_log #${callId})`);
  return c.json({ url, key, bytes: file.size, call_id: callId });
});

// Authenticated R2 proxy. Once deployed and verified, the bucket's public
// r2.dev endpoint can be disabled without breaking call playback.
recordingsRouter.get('/file/*', async (c) => {
  // Hono's wildcard parameter can be empty behind some local adapters. Parse
  // the already-decoded request path as the stable source of truth.
  const marker = '/api/recordings/file/';
  const pathKey = c.req.path.includes(marker) ? c.req.path.slice(c.req.path.indexOf(marker) + marker.length) : '';
  const key = decodeURIComponent(pathKey || c.req.param('*') || '').replace(/^\/+/, '');
  if (!key.startsWith('calls/') || key.includes('..') || key.includes('\\')) {
    return c.json(badRequest('Invalid recording key'), 400);
  }
  const object = await c.env.RECORDINGS.get(key);
  if (!object) return c.json({ error: 'Recording not found', code: 'NOT_FOUND' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Disposition', `inline; filename="${key.split('/').pop() ?? 'recording'}"`);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
});
