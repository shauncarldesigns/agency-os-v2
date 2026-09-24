import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const envPath = path.resolve(process.cwd(), '.env.production');
const required = ['VITE_API_URL', 'VITE_TRACKING_URL'];
const expected = new Map([
  ['VITE_API_URL', 'https://api.shauncarldesigns.com'],
  ['VITE_TRACKING_URL', 'https://try.shauncarldesigns.com'],
]);

function parseEnv(contents) {
  const values = new Map();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    values.set(key, value);
  }
  return values;
}

function fail(message) {
  console.error(`Production env check failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(envPath)) {
  fail('.env.production is missing. Production deploys must include the protected API URL and public tracking URL.');
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
const missing = required.filter((key) => !env.get(key));
if (missing.length > 0) {
  fail(`missing ${missing.join(', ')} in .env.production.`);
}

const mismatched = [...expected].filter(([key, value]) => env.get(key) !== value);
if (mismatched.length > 0) {
  fail(`${mismatched.map(([key, value]) => `${key} must be ${value}`).join('; ')}.`);
}

if (env.get('VITE_API_KEY')) {
  fail('VITE_API_KEY is forbidden in production. Authentication is provided by Cloudflare Access cookies.');
}

console.log('Production env check passed.');
