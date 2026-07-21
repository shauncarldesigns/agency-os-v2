import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const envPath = path.resolve(process.cwd(), '.env.production');
const required = ['VITE_API_URL', 'VITE_TRACKING_URL', 'VITE_API_KEY'];

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
  fail('.env.production is missing. Production deploys must include the dashboard API URL, tracking URL, and API key.');
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
const missing = required.filter((key) => !env.get(key));
if (missing.length > 0) {
  fail(`missing ${missing.join(', ')} in .env.production.`);
}

const apiUrl = env.get('VITE_API_URL');
const trackingUrl = env.get('VITE_TRACKING_URL');
const unsafeValues = [
  ['VITE_API_URL', apiUrl],
  ['VITE_TRACKING_URL', trackingUrl],
].filter(([, value]) => /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(value));

if (unsafeValues.length > 0) {
  fail(`${unsafeValues.map(([key]) => key).join(', ')} cannot point at localhost for production deploys.`);
}

console.log('Production env check passed.');
