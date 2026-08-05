export type ApplicationEventLevel = 'info' | 'warn' | 'error';

export interface ApplicationEventInput {
  level: ApplicationEventLevel;
  source: string;
  eventType: string;
  message: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  details?: Record<string, unknown>;
}

function safeDetails(details: Record<string, unknown> | undefined): string | null {
  if (!details) return null;
  try {
    const encoded = JSON.stringify(details);
    return encoded.length > 4_000 ? `${encoded.slice(0, 3_997)}...` : encoded;
  } catch {
    return JSON.stringify({ note: 'Details could not be serialized' });
  }
}

export async function recordApplicationEvent(
  db: D1Database,
  event: ApplicationEventInput,
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO application_events
        (level, source, event_type, message, method, path, status_code, duration_ms, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      event.level,
      event.source.slice(0, 80),
      event.eventType.slice(0, 80),
      event.message.slice(0, 500),
      event.method ?? null,
      event.path?.slice(0, 300) ?? null,
      event.statusCode ?? null,
      event.durationMs ?? null,
      safeDetails(event.details),
    ).run();
  } catch (error) {
    console.error('Could not persist application event', error);
  }
}
