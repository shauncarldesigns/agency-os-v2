import type { Context } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../types';

interface AccessIdentity extends JWTPayload {
  email?: string;
}

const jwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function normalizedTeamDomain(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function getJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = jwksByTeamDomain.get(teamDomain);
  if (existing) return existing;
  const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  jwksByTeamDomain.set(teamDomain, jwks);
  return jwks;
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

async function validateApiKey(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const key = c.req.header('X-API-Key');
  if (!key || !c.env.DASHBOARD_API_KEY) return false;
  return constantTimeEqual(key, c.env.DASHBOARD_API_KEY);
}

async function validateAccessJwt(c: Context<{ Bindings: Env }>): Promise<AccessIdentity | null> {
  const teamDomainRaw = c.env.ACCESS_TEAM_DOMAIN;
  const audience = c.env.ACCESS_AUD;
  const allowedEmail = c.env.ACCESS_ALLOWED_EMAIL?.trim().toLowerCase();
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!teamDomainRaw || !audience || !allowedEmail || !token) return null;

  const teamDomain = normalizedTeamDomain(teamDomainRaw);
  try {
    const { payload } = await jwtVerify(token, getJwks(teamDomain), {
      issuer: teamDomain,
      audience,
      algorithms: ['RS256'],
    });
    const identity = payload as AccessIdentity;
    if (identity.email?.trim().toLowerCase() !== allowedEmail) return null;
    return identity;
  } catch {
    return null;
  }
}

export function authMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    const mode = c.env.AUTH_MODE ?? 'legacy';
    const accessIdentity = mode === 'legacy' ? null : await validateAccessJwt(c);
    const legacyKeyValid = mode === 'access' ? false : await validateApiKey(c);
    if (!accessIdentity && !legacyKeyValid) {
      return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }
    await next();
  };
}
