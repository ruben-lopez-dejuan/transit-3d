import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const roots = ['server', 'shared', 'city-packages'];
const watchers = [];
let child = null;
let shuttingDown = false;
let restartRequested = false;
let startTimer = null;
let changeTimer = null;

function scheduleStart(delay) {
  if (shuttingDown || startTimer) return;
  startTimer = setTimeout(() => {
    startTimer = null;
    start();
  }, delay);
}

function start() {
  if (shuttingDown || child) return;
  child = spawn(process.execPath, ['--use-system-ca', '--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  child.once('exit', (code, signal) => {
    child = null;
    if (shuttingDown) return;
    const planned = restartRequested;
    restartRequested = false;
    if (!planned) console.warn(`[dev:api] La API terminó (${signal ?? code ?? 'sin código'}); reintento en 1 s.`);
    scheduleStart(planned ? 100 : 1000);
  });
}

function requestRestart() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    if (shuttingDown) return;
    restartRequested = true;
    if (child) child.kill();
    else scheduleStart(0);
  }, 120);
}

for (const root of roots) {
  const absolute = path.resolve(root);
  if (!fs.existsSync(absolute)) continue;
  watchers.push(fs.watch(absolute, { recursive: true }, (_event, filename) => {
    const relative = String(filename ?? '').replaceAll('\\', '/');
    if (!relative || relative.startsWith('cache/') || !/\.(?:ts|mjs|json)$/.test(relative)) return;
    requestRestart();
  }));
}

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(startTimer);
  clearTimeout(changeTimer);
  for (const watcher of watchers) watcher.close();
  if (child) child.kill();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
start();
