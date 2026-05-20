#!/usr/bin/env node
// Manual-trigger Cowork helper: polls the queue, shows pending briefs,
// and walks the operator through start → paste-into-Cowork → mark-done.
//
// Usage:
//   AGENCY_OS_API_URL=https://your-api.workers.dev \
//   AGENCY_OS_API_KEY=xxx \
//   node src/index.mjs
//
// Or with .env.local sourced in your shell.
//
// Commands at the prompt:
//   l  | list           — refresh + list active jobs
//   s  | start <id>     — mark job started (POST /webhook/cowork/started)
//   c  | copy <id>      — print the brief (clipboard copy via pbcopy/xclip if available)
//   o  | open           — open landingsite.ai in your browser
//   d  | done  <id> [url] — mark job complete (POST /webhook/cowork/manual-complete)
//   f  | fail  <id> <err> — mark job failed
//   q  | quit
//
// Notes:
// - This is the *manual-trigger* version per the spec — no automated landingsite.ai driving.
// - Auto-poll runs every COWORK_POLL_INTERVAL_SECONDS and prints any newly queued jobs.

import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

// --- Env loading (no dotenv dep; just .env.local in cwd if present) ---
import { readFileSync, existsSync } from 'node:fs';
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k] !== undefined) continue;
    let v = vRaw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}
loadDotEnv('.env.local');
loadDotEnv('.env');

const API_URL = process.env.AGENCY_OS_API_URL ?? 'http://localhost:8788';
const API_KEY = process.env.AGENCY_OS_API_KEY ?? '';
const POLL_SECONDS = parseInt(process.env.COWORK_POLL_INTERVAL_SECONDS ?? '30', 10);
const LANDINGSITE_URL = process.env.LANDINGSITE_URL ?? 'https://landingsite.ai';

if (!API_KEY) {
  console.error('AGENCY_OS_API_KEY is not set. See .env.example.');
  process.exit(1);
}

// --- Color helpers (no chalk dep) ---
const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

// --- API helpers ---
async function api(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getStatus() {
  return api('/api/briefs/queue/status');
}

async function getJob(id) {
  // We don't have a direct GET — pull from queue/status which includes brief_markdown for active jobs
  // Spec /queue/status excludes brief_markdown to keep payload small. Fall back to fetching project + page.
  const status = await getStatus();
  const found = status.active.find(j => j.id === id) ?? status.recent.find(j => j.id === id);
  return found ?? null;
}

async function fetchJobBrief(id) {
  // Hit a future endpoint OR re-fetch via queue/status. For now we expose the brief
  // by adding a tiny helper that asks the queue/status endpoint with `?include=markdown`
  // — but to avoid a backend change, we read it from the active list (where it isn't included yet).
  // Workaround: ask the operator to copy the brief from the dashboard's Build tab.
  return null;
}

async function notifyStarted(id) {
  return api('/api/webhook/cowork/started', {
    method: 'POST',
    body: JSON.stringify({ jobId: id }),
  });
}

async function notifyDone(id, pageUrl) {
  return api('/api/webhook/cowork/manual-complete', {
    method: 'POST',
    body: JSON.stringify({ jobId: id, pageUrl: pageUrl ?? undefined }),
  });
}

async function notifyFailed(id, error) {
  return api('/api/webhook/cowork/completed', {
    method: 'POST',
    body: JSON.stringify({ jobId: id, success: false, error }),
  });
}

// --- Cross-platform "open URL in browser" ---
function openUrl(url) {
  const p = platform();
  const cmd = p === 'darwin' ? 'open' : p === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
}

// --- Cross-platform clipboard copy (best-effort) ---
function copyToClipboard(text) {
  return new Promise((resolve) => {
    const p = platform();
    const cmd = p === 'darwin' ? 'pbcopy' : p === 'win32' ? 'clip' : 'xclip';
    const args = p === 'linux' ? ['-selection', 'clipboard'] : [];
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0));
    child.stdin.end(text);
  });
}

// --- Print active jobs ---
let lastSeen = new Set();
function printJob(j) {
  const status = j.status === 'queued' ? `${c.yellow}QUEUED${c.reset}`
    : j.status === 'processing' ? `${c.blue}PROCESSING${c.reset}`
    : j.status === 'done' ? `${c.green}DONE${c.reset}`
    : `${c.red}FAILED${c.reset}`;
  const tier = j.project_tier ? ` ${c.dim}T${j.project_tier}${c.reset}` : '';
  const name = j.project_name ?? `project ${j.project_id}`;
  console.log(`  #${j.id.toString().padStart(4)} ${status} ${c.bold}${name}${c.reset}${tier} ${c.dim}(${j.job_type})${c.reset}`);
  if (j.error_message) console.log(`        ${c.red}↳ ${j.error_message.slice(0, 100)}${c.reset}`);
}

async function refreshAndPrint(announceNew = true) {
  try {
    const status = await getStatus();
    const all = [...status.active];
    const queued = all.filter(j => j.status === 'queued');
    const processing = all.filter(j => j.status === 'processing');

    console.log('');
    console.log(`${c.cyan}═══ Queue ─ ${queued.length} queued · ${processing.length} processing ═══${c.reset}`);
    if (all.length === 0) {
      console.log(`  ${c.dim}(empty)${c.reset}`);
    } else {
      for (const j of all) printJob(j);
    }

    if (announceNew) {
      const newOnes = all.filter(j => !lastSeen.has(j.id) && j.status === 'queued');
      if (newOnes.length > 0 && lastSeen.size > 0) {
        console.log('');
        console.log(`${c.green}🔔 ${newOnes.length} new job${newOnes.length === 1 ? '' : 's'} appeared since last poll${c.reset}`);
      }
    }
    lastSeen = new Set(all.map(j => j.id));
    return status;
  } catch (err) {
    console.error(`${c.red}Status fetch failed: ${err.message}${c.reset}`);
    return null;
  }
}

// --- REPL ---
function help() {
  console.log('');
  console.log(`${c.bold}Commands:${c.reset}`);
  console.log(`  ${c.cyan}l${c.reset}, list                  refresh + list active jobs`);
  console.log(`  ${c.cyan}s${c.reset}, start <id>            mark job started`);
  console.log(`  ${c.cyan}o${c.reset}, open                  open ${LANDINGSITE_URL} in browser`);
  console.log(`  ${c.cyan}d${c.reset}, done <id> [url]       mark job complete (with optional page URL)`);
  console.log(`  ${c.cyan}f${c.reset}, fail <id> <reason>    mark job failed`);
  console.log(`  ${c.cyan}h${c.reset}, help                  show this help`);
  console.log(`  ${c.cyan}q${c.reset}, quit                  exit`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function prompt() { rl.setPrompt(`${c.cyan}cowork> ${c.reset}`); rl.prompt(); }

console.log(`${c.bold}${c.magenta}Agency OS Cowork helper${c.reset} ${c.dim}— manual handoff mode${c.reset}`);
console.log(`${c.dim}API: ${API_URL}${c.reset}`);
console.log(`${c.dim}Poll: every ${POLL_SECONDS}s · Type 'h' for help${c.reset}`);

await refreshAndPrint(false);
prompt();

const pollTimer = setInterval(() => refreshAndPrint(true).then(() => prompt()), POLL_SECONDS * 1000);

rl.on('line', async (raw) => {
  const line = raw.trim();
  if (!line) { prompt(); return; }
  const [cmd, ...args] = line.split(/\s+/);
  try {
    switch (cmd.toLowerCase()) {
      case 'l': case 'list':
        await refreshAndPrint(false);
        break;
      case 's': case 'start': {
        const id = parseInt(args[0], 10);
        if (!id) { console.log(`${c.red}usage: start <id>${c.reset}`); break; }
        await notifyStarted(id);
        console.log(`${c.green}✓ Job ${id} marked started${c.reset}`);
        break;
      }
      case 'o': case 'open':
        openUrl(LANDINGSITE_URL);
        console.log(`${c.dim}Opening ${LANDINGSITE_URL}…${c.reset}`);
        break;
      case 'd': case 'done': {
        const id = parseInt(args[0], 10);
        if (!id) { console.log(`${c.red}usage: done <id> [url]${c.reset}`); break; }
        const url = args[1];
        await notifyDone(id, url);
        console.log(`${c.green}✓ Job ${id} marked complete${url ? ` (${url})` : ''}${c.reset}`);
        break;
      }
      case 'f': case 'fail': {
        const id = parseInt(args[0], 10);
        const reason = args.slice(1).join(' ').trim();
        if (!id || !reason) { console.log(`${c.red}usage: fail <id> <reason>${c.reset}`); break; }
        await notifyFailed(id, reason);
        console.log(`${c.yellow}✓ Job ${id} marked failed${c.reset}`);
        break;
      }
      case 'h': case 'help':
        help();
        break;
      case 'q': case 'quit': case 'exit':
        clearInterval(pollTimer);
        rl.close();
        return;
      default:
        console.log(`${c.red}Unknown command: ${cmd}. Type 'h' for help.${c.reset}`);
    }
  } catch (err) {
    console.error(`${c.red}Error: ${err.message}${c.reset}`);
  }
  prompt();
});

rl.on('close', () => {
  console.log(`\n${c.dim}Bye.${c.reset}`);
  process.exit(0);
});

// Suppress an unused warning for the placeholder fetchJobBrief / copyToClipboard
void fetchJobBrief;
void copyToClipboard;
