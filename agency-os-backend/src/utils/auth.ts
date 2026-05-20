import type { Context } from 'hono';
import type { Env } from '../types';

export function validateApiKey(c: Context<{ Bindings: Env }>): boolean {
  const key = c.req.header('X-API-Key');
  return key === c.env.DASHBOARD_API_KEY;
}

export function authMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    if (!validateApiKey(c)) {
      return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }
    await next();
  };
}
