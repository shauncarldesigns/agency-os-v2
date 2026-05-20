export interface ApiError {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

export function badRequest(message: string, code = 'BAD_REQUEST', details?: Record<string, unknown>): ApiError {
  return { error: message, code, details };
}

export function notFound(resource: string): ApiError {
  return { error: `${resource} not found`, code: 'NOT_FOUND' };
}

export function conflict(message: string): ApiError {
  return { error: message, code: 'CONFLICT' };
}

export function serverError(message = 'Internal server error'): ApiError {
  return { error: message, code: 'SERVER_ERROR' };
}

export function upstreamError(service: string, detail?: string): ApiError {
  return {
    error: `Upstream API error from ${service}`,
    code: 'UPSTREAM_ERROR',
    details: detail ? { detail } : undefined,
  };
}

export function log(level: 'info' | 'warn' | 'error', service: string, message: string, context?: unknown): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] [${service}] ${message}`;
  if (context !== undefined) {
    const ctx = context instanceof Error
      ? { message: context.message }
      : context;
    if (level === 'error') console.error(line, JSON.stringify(ctx));
    else console.log(line, JSON.stringify(ctx));
  } else {
    if (level === 'error') console.error(line);
    else console.log(line);
  }
}
