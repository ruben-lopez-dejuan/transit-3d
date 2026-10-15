import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * README screenshots of the running app, with a headless Chrome driven over the DevTools
 * protocol (no extra dependencies).
 *
 * Usage: node --import tsx server/capture-screenshots.ts [app-url] [scene.jpg,…]
 * Needs the app running (npm run dev → http://localhost:5173) with live data loaded.
 * CHROME may point to another Chrome/Edge executable.
 */
const app = process.argv[2] ?? 'http://localhost:5173';
const chrome = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((file) => fs.existsSync(file));
if (!chrome) throw new Error('Chrome/Edge not found; set CHROME');
const output = path.resolve('docs/screenshots');
fs.mkdirSync(output, { recursive: true });

type Camera = { center: [number, number]; zoom: number; bearing: number; pitch: number };
type Scene = { file: string; width: number; height: number; mobile?: boolean; theme: 'light' | 'dark'; camera: Camera; mode?: string; wait?: number; then?: string[] };
// `then`: page scripts run one after another, a few seconds apart (search, choose a line, open a vehicle).
const search = (text: string) => `(() => { const input = document.querySelector('#search'); input.focus(); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`;
/** Choose the search result that is a line of this operator. */
const chooseLine = (operator: string) => `[...document.querySelectorAll('[data-result]')].find((row) => row.textContent.includes('Línea') && row.textContent.includes(${JSON.stringify(operator)}))?.click()`;
/** Open a vehicle of the shown line that is in real time and heading through central Bilbao, if any. */
const chooseVehicle = `(() => { const rows = [...document.querySelectorAll('.vehicle-row')]; const live = rows.filter((row) => row.textContent.includes('Tiempo real')); (live.find((row) => /Gran V|Moyua|Abando|Indautxu|Plaza|Zabalburu|Arriaga|Casco|Bailén|Sabino|Hurtado|Autonom|San Mam|Deusto|Uribitarte/i.test(row.textContent)) ?? live[0] ?? rows[0])?.click(); })()`;
const scenes: Scene[] = [
  { file: 'hero-3d.jpg', width: 1440, height: 900, theme: 'dark', camera: { center: [-2.9349, 43.2629], zoom: 16.5, bearing: 38, pitch: 62 } },
  { file: 'abando-3d.jpg', width: 1440, height: 900, theme: 'light', camera: { center: [-2.9262, 43.2611], zoom: 16.3, bearing: -35, pitch: 58 } },
  { file: 'bilbao-map.jpg', width: 1440, height: 900, theme: 'light', camera: { center: [-2.935, 43.268], zoom: 13.2, bearing: 0, pitch: 0 } },
  { file: 'line-metro.jpg', width: 1440, height: 900, theme: 'light', camera: { center: [-2.96, 43.29], zoom: 11.6, bearing: 0, pitch: 0 }, then: [search('MB'), chooseLine('Metro Bilbao')] },
  { file: 'vehicle-detail.jpg', width: 1440, height: 900, theme: 'light', camera: { center: [-2.935, 43.262], zoom: 15.5, bearing: 0, pitch: 45 }, then: [search('56'), chooseLine('Bilbobus'), chooseVehicle] },
  { file: 'mobile-card.jpg', width: 390, height: 844, mobile: true, theme: 'light', camera: { center: [-2.935, 43.262], zoom: 15.5, bearing: 0, pitch: 45 }, then: [search('28'), chooseLine('Bilbobus'), chooseVehicle] },
  { file: 'mobile-map.jpg', width: 390, height: 844, mobile: true, theme: 'dark', camera: { center: [-2.932, 43.258], zoom: 14.6, bearing: 20, pitch: 50 } },
];

// Only the scenes named on the command line, if any (file names, comma-separated).
const only = process.argv[3]?.split(',');
// The fleet must be loaded: right after a restart the API answers with only a few providers.
for (let attempt = 0; ; attempt++) {
  const vehicles = await fetch(`${app}/api/transit?cityId=es-bilbao`).then((r) => r.json() as Promise<{ vehicles: unknown[] }>).then((b) => b.vehicles.length).catch(() => 0);
  if (vehicles > 500) break;
  if (attempt > 60) throw new Error(`Only ${vehicles} vehicles after 5 minutes`);
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-screens-'));
const port = 9333;
const browser = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let target: { webSocketDebuggerUrl: string } | undefined;
for (let i = 0; i < 50 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === 'page'); } catch { await sleep(200); }
}
if (!target) throw new Error('Chrome did not start');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map<number, (value: { result?: Record<string, unknown>; error?: { message: string } }) => void>();
socket.addEventListener('message', (event) => { const message = JSON.parse(String(event.data)); pending.get(message.id)?.(message); pending.delete(message.id); });
const send = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, unknown>>((resolve, reject) => {
  const messageId = ++id;
  pending.set(messageId, (message) => message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result ?? {}));
  socket.send(JSON.stringify({ id: messageId, method, params }));
});
await send('Page.enable'); await send('Runtime.enable');
const evaluate = (expression: string) => send('Runtime.evaluate', { expression, awaitPromise: true });

for (const scene of scenes.filter((item) => !only || only.includes(item.file))) {
  // README size: 1600 px wide on desktop, 600 px on a phone.
  await send('Emulation.setDeviceMetricsOverride', { width: scene.width, height: scene.height, deviceScaleFactor: (scene.mobile ? 600 : 1600) / scene.width, mobile: !!scene.mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: !!scene.mobile });
  // Preferences live in localStorage: open the origin, set them, then load the city.
  await send('Page.navigate', { url: `${app}/?city=es-bilbao` }); await sleep(1500);
  await evaluate(`localStorage.setItem('transit:theme', '${scene.theme}'); localStorage.setItem('transit:city:es-bilbao:preferences:v1', ${JSON.stringify(JSON.stringify({ mode: scene.mode ?? 'all', camera: scene.camera }))})`);
  await send('Page.navigate', { url: `${app}/?city=es-bilbao` });
  await sleep(scene.wait ?? 25_000);
  for (const step of scene.then ?? []) { await evaluate(step); await sleep(4000); }
  if (scene.then?.length) await sleep(4000);
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }) as { data: string };
  fs.writeFileSync(path.join(output, scene.file), Buffer.from(shot.data, 'base64'));
  console.log('saved', scene.file);
}
socket.close(); browser.kill();
await sleep(1000);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold the profile for a moment. */ }
process.exit(0);
