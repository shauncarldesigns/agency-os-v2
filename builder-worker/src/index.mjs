#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync, existsSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnv('.env.local');
loadEnv('.env');

const API_URL = (process.env.AGENCY_OS_API_URL ?? 'http://localhost:8788').replace(/\/$/, '');
const TOKEN = process.env.BUILDER_API_TOKEN ?? '';
const LANDINGSITE_URL = process.env.LANDINGSITE_URL ?? 'https://app.landingsite.ai';
const POLL_MS = Number(process.env.BUILDER_POLL_INTERVAL_MS ?? 15000);
const PROFILE_DIR = resolve(process.env.BUILDER_PROFILE_DIR ?? './profile');
const ARTIFACT_DIR = resolve(process.env.BUILDER_ARTIFACT_DIR ?? './artifacts');
const TRACE_ON_FAILURE = process.env.BUILDER_TRACE_ON_FAILURE === 'true';
const ARTIFACT_RETENTION_DAYS = Number(process.env.BUILDER_ARTIFACT_RETENTION_DAYS ?? 30);
const LOCK_PATH = join(PROFILE_DIR, '.builder-worker.lock');
let resumeEditorUrl = process.env.LANDINGSITE_RESUME_URL ?? '';
if (!TOKEN) throw new Error('BUILDER_API_TOKEN is required');
mkdirSync(PROFILE_DIR, { recursive: true });
mkdirSync(ARTIFACT_DIR, { recursive: true });

function cleanExpiredArtifacts() {
  if (!Number.isFinite(ARTIFACT_RETENTION_DAYS) || ARTIFACT_RETENTION_DAYS < 1) return;
  const cutoff = Date.now() - ARTIFACT_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  let removed = 0;
  for (const name of readdirSync(ARTIFACT_DIR)) {
    const path = join(ARTIFACT_DIR, name);
    try {
      const details = statSync(path);
      if (details.isFile() && details.mtimeMs < cutoff) {
        unlinkSync(path);
        removed++;
      }
    } catch {
      // A concurrent cleanup or operator action may already have removed it.
    }
  }
  if (removed) console.log(`Removed ${removed} Builder artifact${removed === 1 ? '' : 's'} older than ${ARTIFACT_RETENTION_DAYS} days.`);
}

cleanExpiredArtifacts();

function acquireProcessLock() {
  if (existsSync(LOCK_PATH)) {
    const existingPid = Number.parseInt(readFileSync(LOCK_PATH, 'utf8').trim(), 10);
    if (Number.isFinite(existingPid)) {
      let processExists = true;
      try {
        process.kill(existingPid, 0);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') processExists = false;
        else throw new Error(`Builder Employee is already running (PID ${existingPid}).`);
      }
      if (processExists) throw new Error(`Builder Employee is already running (PID ${existingPid}).`);
    }
    unlinkSync(LOCK_PATH);
  }
  const descriptor = openSync(LOCK_PATH, 'wx');
  writeFileSync(descriptor, `${process.pid}\n`);
  return () => {
    try {
      if (readFileSync(LOCK_PATH, 'utf8').trim() === String(process.pid)) unlinkSync(LOCK_PATH);
    } catch {
      // The lock may already be gone during shutdown or service uninstall.
    }
  };
}

const releaseProcessLock = acquireProcessLock();

async function api(path, body, retries = 20) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${API_URL}/api/builder-worker${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`${response.status}: ${payload.error ?? response.statusText}`);
      return payload;
    } catch (error) {
      if (attempt >= retries || !/fetch failed|ECONNREFUSED|network/i.test(String(error))) throw error;
      if (attempt === 0) console.error('Agency OS API unavailable; waiting to reconnect…');
      await new Promise(resolvePromise => setTimeout(resolvePromise, 3000));
    }
  }
}

const waitForPoll = () => new Promise(resolvePromise => setTimeout(resolvePromise, POLL_MS));

let context;
async function browserContext() {
  if (context) return context;
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    chromiumSandbox: true,
    viewport: { width: 1440, height: 1000 },
  });
  context.on('close', () => { context = undefined; });
  return context;
}

async function waitForAuthentication(page) {
  void api('/heartbeat', { state: 'running', step: 'Checking login' }, 0).catch(() => undefined);
  await page.goto(LANDINGSITE_URL, { waitUntil: 'domcontentloaded' });
  const authenticated = page.getByRole('button', { name: /new website/i });
  if (await authenticated.isVisible().catch(() => false)) return;
  console.log('\nLandingSite.ai login required.\nPlease sign in to continue.\n');
  void api('/heartbeat', { state: 'login_required', message: 'LandingSite.ai login required. Please sign in to continue.' }, 0).catch(() => undefined);
  await authenticated.waitFor({ state: 'visible', timeout: 0 });
  console.log('LandingSite.ai session restored. Resuming Builder.');
  void api('/heartbeat', { state: 'idle' }, 0).catch(() => undefined);
}

async function captureDemoUrl(page, buildStartedUrl, onEditorReady) {
  console.log('LandingSite: waiting for editor route');
  await page.waitForURL(url => url.href !== buildStartedUrl, { timeout: 2 * 60_000 });
  console.log(`LandingSite: editor loaded at ${page.url()}; frames=${page.frames().map(frame => frame.url()).join(', ')}`);
  await onEditorReady?.(page.url());
  let preview;
  const previewDeadline = Date.now() + 15 * 60_000;
  while (!preview && Date.now() < previewDeadline) {
    for (const frame of page.frames()) {
      const candidate = frame.getByRole('link', { name: /preview website/i }).first();
      if (await candidate.isVisible().catch(() => false)) {
        preview = candidate;
        break;
      }
    }
    if (!preview) await page.waitForTimeout(500);
  }
  if (!preview) throw new Error('LandingSite Preview Website control did not appear.');
  const demoUrl = await preview.getAttribute('href');
  if (!demoUrl) throw new Error('LandingSite Preview Website link has no URL.');
  const parsed = new URL(demoUrl);
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.agcy.dev')) {
    throw new Error(`Unexpected LandingSite preview URL: ${demoUrl}`);
  }
  console.log(`LandingSite: preview URL captured from link: ${demoUrl}`);
  return parsed.href;
}

async function build(job) {
  const browser = await browserContext();
  const existingPages = browser.pages();
  const page = (job.resumeExisting
    ? existingPages.find(candidate => candidate.url().startsWith(`${LANDINGSITE_URL}/chat/`))
    : existingPages.find(candidate => candidate.url().startsWith(LANDINGSITE_URL))) ?? existingPages[0] ?? await browser.newPage();
  await Promise.all(existingPages.filter(candidate => candidate !== page).map(candidate => candidate.close().catch(() => undefined)));
  const artifactBase = join(ARTIFACT_DIR, `job-${job.id}-attempt-${job.attempt}`);
  let currentStep = 'Opening LandingSite.ai';
  let activeEditorUrl = '';
  const step = async (value) => {
    currentStep = value;
    console.log(`Step: ${value}`);
    void api('/heartbeat', { jobId: job.id, lockToken: job.lockToken, state: 'building', step: value, message: activeEditorUrl ? `LandingSite editor: ${activeEditorUrl}` : undefined }, 0).catch(() => undefined);
  };
  const heartbeat = setInterval(() => {
    void api('/heartbeat', { jobId: job.id, lockToken: job.lockToken, state: 'building', step: currentStep, message: activeEditorUrl ? `LandingSite editor: ${activeEditorUrl}` : undefined }, 0).catch(() => undefined);
  }, 60_000);
  try {
    if (TRACE_ON_FAILURE) await browser.tracing.start({ screenshots: true, snapshots: true, sources: true });
    let demoUrl;
    const openEditorUrl = page.url().startsWith(`${LANDINGSITE_URL}/chat/`) ? page.url() : '';
    if (resumeEditorUrl || job.resumeExisting) {
      const editorUrl = resumeEditorUrl || job.resumeEditorUrl || openEditorUrl;
      resumeEditorUrl = '';
      if (!editorUrl) {
        throw new Error('Resume requested, but no existing LandingSite editor is open. Open the existing project in the Builder browser and retry Resume build.');
      }
      console.log(`LandingSite: resuming existing editor for lead ${job.leadId}`);
      await step('Resuming existing website');
      if (page.url() !== editorUrl) await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
      await step('Waiting for website');
      demoUrl = await captureDemoUrl(page, LANDINGSITE_URL, editorUrlValue => {
        activeEditorUrl = editorUrlValue;
        return api('/heartbeat', { jobId: job.id, lockToken: job.lockToken, state: 'building', step: currentStep, message: `LandingSite editor: ${editorUrlValue}` }, 0).catch(() => undefined);
      });
    } else {
      await waitForAuthentication(page);
      await step('Creating new project');
      await page.getByRole('button', { name: /new website/i }).click();
      const nameField = page.getByLabel(/business name/i);
      const descriptionField = page.getByLabel(/business description/i);
      await nameField.waitFor({ state: 'visible' });
      await step('Pasting brief');
      await nameField.fill(job.businessName);
      await descriptionField.fill(job.prompt);
      const buildStartedUrl = page.url();
      await step('Starting generation');
      await page.getByRole('button', { name: /create your website/i }).click();
      await step('Waiting for website');
      demoUrl = await captureDemoUrl(page, buildStartedUrl, editorUrlValue => {
        activeEditorUrl = editorUrlValue;
        return api('/heartbeat', { jobId: job.id, lockToken: job.lockToken, state: 'building', step: currentStep, message: `LandingSite editor: ${editorUrlValue}` }, 0).catch(() => undefined);
      });
    }
    await step('Capturing demo URL');
    if (TRACE_ON_FAILURE) await browser.tracing.stop();
    await step('Saving URL');
    console.log('Agency OS: delivering completed site URL');
    await api('/result', {
      jobId: job.id, lockToken: job.lockToken, success: true, demoUrl,
    }, Number.MAX_SAFE_INTEGER);
    currentStep = 'Completing job';
    console.log(`Completed lead ${job.leadId}: ${demoUrl}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const screenshot = `${artifactBase}.png`;
    const trace = TRACE_ON_FAILURE ? `${artifactBase}.zip` : null;
    const errorLog = `${artifactBase}.json`;
    let artifactPath = screenshot;
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
    if (trace) await browser.tracing.stop({ path: trace }).catch(() => undefined);
    try {
      writeFileSync(errorLog, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        jobId: job.id,
        leadId: job.leadId,
        businessName: job.businessName,
        attempt: job.attempt,
        step: currentStep,
        error: message,
        pageUrl: page.url(),
        screenshot,
        trace,
      }, null, 2)}\n`);
      artifactPath = errorLog;
    } catch (logError) {
      console.error('Could not write Builder error log:', logError instanceof Error ? logError.message : logError);
    }
    const recoverable = /timeout|network|connection|browser|page crashed|target closed/i.test(message);
    const systemError = /LandingSite.*(?:unavailable|UI may have changed)|ERR_NAME_NOT_RESOLVED|\b50[234]\b/i.test(message);
    await api('/result', {
      jobId: job.id, lockToken: job.lockToken, success: false,
      reason: message, recoverable, systemError, artifactPath,
    }, Number.MAX_SAFE_INTEGER);
    console.error(`${recoverable ? 'Retrying' : 'Failed'} lead ${job.leadId}: ${message}`);
    if (/browser|page crashed|target closed/i.test(message)) {
      await context?.close().catch(() => undefined);
      context = undefined;
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function main() {
  console.log(`Builder Employee online. Profile: ${PROFILE_DIR}`);
  const browser = await browserContext();
  const editorPage = browser.pages().find(page => page.url().startsWith(`${LANDINGSITE_URL}/chat/`));
  const authPage = editorPage ? await browser.newPage() : browser.pages()[0] ?? await browser.newPage();
  await waitForAuthentication(authPage);
  if (editorPage) await authPage.close().catch(() => undefined);
  while (true) {
    try {
      const { paused, job } = await api('/claim');
      if (paused) await api('/heartbeat', { state: 'paused', message: 'Paused by operator' });
      else if (job) await build(job);
    } catch (error) {
      console.error('Queue error:', error instanceof Error ? error.message : error);
    }
    await waitForPoll();
  }
}

process.on('exit', releaseProcessLock);
process.on('SIGINT', async () => { await context?.close(); releaseProcessLock(); process.exit(0); });
process.on('SIGTERM', async () => { await context?.close(); releaseProcessLock(); process.exit(0); });
await main();
