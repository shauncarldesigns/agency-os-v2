#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.agencyos.builder-employee';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(scriptDir, '..');
const entrypoint = resolve(workerDir, 'src/index.mjs');
const logDir = resolve(workerDir, 'logs');
const profileDir = resolve(workerDir, 'profile');
const plistPath = resolve(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const serviceTarget = `gui/${process.getuid()}/${LABEL}`;
const serviceDomain = `gui/${process.getuid()}`;
const action = process.argv[2] ?? 'status';

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function launchctl(args, options = {}) {
  return execFileSync('/bin/launchctl', args, { encoding: 'utf8', stdio: options.quiet ? 'pipe' : 'inherit' });
}

function installed() {
  return existsSync(plistPath);
}

function running() {
  try {
    const output = launchctl(['print', serviceTarget], { quiet: true });
    return /\bstate = running\b/.test(output);
  } catch {
    return false;
  }
}

function requireConfig() {
  const envPath = resolve(workerDir, '.env.local');
  if (!existsSync(envPath) || !/^BUILDER_API_TOKEN=.+/m.test(readFileSync(envPath, 'utf8'))) {
    throw new Error(`Create ${envPath} with BUILDER_API_TOKEN before installing the service.`);
  }
}

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(entrypoint)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(workerDir)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xml(resolve(logDir, 'builder.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(resolve(logDir, 'builder-error.log'))}</string>
</dict>
</plist>
`;
}

function install() {
  if (process.platform !== 'darwin') throw new Error('The automatic Builder service currently supports macOS only.');
  requireConfig();
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(logDir, { recursive: true });
  mkdirSync(profileDir, { recursive: true });
  if (installed()) {
    try { launchctl(['bootout', serviceTarget], { quiet: true }); } catch { /* Already unloaded. */ }
  }
  // Clear only a stale lock. A live manually-started worker must be stopped so
  // the LaunchAgent cannot create a second concurrent browser employee.
  const lockPath = resolve(profileDir, '.builder-worker.lock');
  if (existsSync(lockPath)) {
    const pid = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
    let processExists = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') processExists = false;
      else throw new Error(`A manually-started Builder is still running (PID ${pid}). Stop it before installing the service.`);
    }
    if (processExists) throw new Error(`A manually-started Builder is still running (PID ${pid}). Stop it before installing the service.`);
    unlinkSync(lockPath);
  }
  writeFileSync(plistPath, plist(), { mode: 0o644 });
  launchctl(['bootstrap', serviceDomain, plistPath]);
  launchctl(['kickstart', '-k', serviceTarget]);
  console.log(`Builder Employee service installed and started.\nLogs: ${logDir}`);
}

function status() {
  console.log(`Installed: ${installed() ? 'yes' : 'no'}\nRunning: ${running() ? 'yes' : 'no'}\nService: ${LABEL}\nLogs: ${logDir}`);
  if (!installed()) process.exitCode = 1;
}

function restart() {
  if (!installed()) throw new Error('Builder service is not installed. Run npm run service:install first.');
  launchctl(['kickstart', '-k', serviceTarget]);
  console.log('Builder Employee service restarted.');
}

function logs() {
  mkdirSync(logDir, { recursive: true });
  const result = spawnSync('/usr/bin/tail', ['-n', '100', '-F', resolve(logDir, 'builder.log'), resolve(logDir, 'builder-error.log')], { stdio: 'inherit' });
  if (result.error) throw result.error;
}

function uninstall() {
  if (installed()) {
    try { launchctl(['bootout', serviceTarget]); } catch { /* Already unloaded. */ }
    unlinkSync(plistPath);
  }
  console.log('Builder Employee service removed. The Chrome profile and logs were preserved.');
}

const actions = { install, status, restart, logs, uninstall };
if (!(action in actions)) throw new Error(`Unknown action "${action}".`);
actions[action]();
