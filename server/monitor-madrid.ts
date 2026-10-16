import fs from 'node:fs';
import path from 'node:path';
import bindings from 'gtfs-realtime-bindings';
import { TransitRenderer } from '../src/map/transitRenderer';
import { positionAlong } from '../src/transit/motion';
import type { Shape, Vehicle } from '../shared/transit/network';
import { METRO_TELEINDICADORES_URL } from './providers/madrid/metroFeed';

/**
 * Measures what the app draws in Madrid, operator by operator.
 *
 * Every 15 s (as the app does) it reads /api/transit and records, per operator: vehicles,
 * where their position comes from, how old the source is, how long each identity lasts and
 * how often a vehicle steps back (> 20 m) or jumps (> 25 m/s) between snapshots.
 *
 * Cercanías: it runs the browser's own TransitRenderer on those snapshots and compares, for
 * every new Renfe GPS fix taken at t, where the map was drawing that train at t (along-track
 * error, + ahead / − behind, and distance on the map), as monitor-bus-accuracy does for Bilbao.
 * Renfe renews a train's timestamp every ~20 s but its position only every minute or two, so
 * only fixes where the position moved count as observations at t ("moved" in the summary).
 *
 * Options: --metro-captures saves each teleindicadores poll (30 s) for
 * replay-metro-madrid.ts; --emt-stops=72,73 asks the app for those EMT stops every 60 s,
 * as a person looking at them would, so their buses take EMT's estimates.
 *
 * Usage: npm run monitor:madrid -- <minutes> <output dir> [api] [--metro-captures] [--emt-stops=…]
 */
const [minutesArg, outputArg, apiArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const minutes = Number(minutesArg ?? 20), output = outputArg ?? 'madrid-monitor', api = apiArg ?? 'http://localhost:3001';
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`));
const emtStops = option('emt-stops')?.split('=')[1]?.split(',').filter(Boolean) ?? [];
const city = 'es-madrid', RENFE_GPS = 'https://gtfsrt.renfe.com/vehicle_positions.pb';
fs.mkdirSync(output, { recursive: true });
const captures = path.join(output, 'teleindicadores');
if (option('metro-captures')) fs.mkdirSync(captures, { recursive: true });

type Seen = { first: number; last: number; at: number; progress: number; shapeKey: string };
type Stats = { snapshots: number; vehicles: number[]; sources: Record<string, number>; ages: number[]; seen: Map<string, Seen>; steps: number; backwards: number; jumps: number };
const stats = new Map<string, Stats>();
const statsFor = (operator: string) => { let s = stats.get(operator); if (!s) { s = { snapshots: 0, vehicles: [], sources: {}, ages: [], seen: new Map(), steps: 0, backwards: 0, jumps: 0 }; stats.set(operator, s); } return s; };
let snapshots = 0;

const renderer = new TransitRenderer({} as never);
const renfe = new Map<string, Vehicle>(), samples = new Map<string, { at: number; progress: number; shapeKey: string }[]>(), seenFixes = new Set<string>();
const lastPosition = new Map<string, string>();
const fixes = fs.createWriteStream(path.join(output, 'renfe-fixes.jsonl'));
const R = 111_320;
const meters = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * R * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * R);
/** Nearest point of the shape to `point` within `window` metres of `around`. */
function project(shape: Shape, point: [number, number], around: number, window: number) {
  let best = { progress: around, distance: Infinity };
  const k = Math.cos(point[1] * Math.PI / 180);
  for (let i = 1; i < shape.coordinates.length; i++) {
    if (shape.cumulative[i] < around - window || shape.cumulative[i - 1] > around + window) continue;
    const a = shape.coordinates[i - 1], b = shape.coordinates[i];
    const bx = (b[0] - a[0]) * R * k, by = (b[1] - a[1]) * R, px = (point[0] - a[0]) * R * k, py = (point[1] - a[1]) * R;
    const length = bx * bx + by * by, t = length ? Math.max(0, Math.min(1, (px * bx + py * by) / length)) : 0;
    const distance = Math.hypot(px - t * bx, py - t * by);
    if (distance < best.distance) best = { progress: shape.cumulative[i - 1] + t * (shape.cumulative[i] - shape.cumulative[i - 1]), distance };
  }
  return best;
}

async function snapshot() {
  const body = await (await fetch(`${api}/api/transit?cityId=${city}`)).json() as { vehicles: Vehicle[]; fetchedAt: number; serverTime: number };
  snapshots++;
  const byOperator = new Map<string, Vehicle[]>();
  for (const v of body.vehicles) byOperator.set(v.operatorId, [...byOperator.get(v.operatorId) ?? [], v]);
  for (const [operator, vehicles] of byOperator) {
    const s = statsFor(operator);
    s.snapshots++; s.vehicles.push(vehicles.length);
    for (const v of vehicles) {
      s.sources[v.positionSource] = (s.sources[v.positionSource] ?? 0) + 1;
      if (v.sourceTimestamp !== null) s.ages.push((body.serverTime - v.sourceTimestamp) / 1000);
      const previous = s.seen.get(v.id), progress = v.progressMetersAlongShape;
      if (previous && previous.shapeKey === v.shapeKey) {
        const advance = progress - previous.progress, seconds = (body.serverTime - previous.at) / 1000;
        s.steps++; if (advance < -20) s.backwards++; if (seconds > 0 && advance / seconds > 25) s.jumps++;
      }
      s.seen.set(v.id, { first: previous?.first ?? body.serverTime, last: body.serverTime, at: body.serverTime, progress, shapeKey: v.shapeKey });
    }
  }
  // Cercanías: draw them as the browser does.
  const trains = body.vehicles.filter((v) => v.operatorId === 'cercanias-renfe');
  const missing = [...new Set(trains.map((v) => v.shapeKey))].filter((key) => !renderer.shapes.has(key));
  for (let i = 0; i < missing.length; i += 100) {
    const shapes = await (await fetch(`${api}/api/geometries?cityId=${city}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: missing.slice(i, i + 100) }) })).json() as Shape[];
    for (const shape of shapes) renderer.shapes.set(shape.key, shape);
  }
  renderer.update(trains, body.fetchedAt, body.serverTime);
  renfe.clear(); for (const v of trains) renfe.set(v.id, v);
}

function sample() {
  const now = Date.now() + renderer.clockOffset;
  for (const [id, v] of renfe) {
    const progress = renderer.progressMeters(id); if (progress === null) continue;
    const list = samples.get(id) ?? []; samples.set(id, list);
    list.push({ at: now, progress, shapeKey: v.shapeKey });
    while (list.length && list[0].at < now - 180_000) list.shift();
  }
}

async function pollRenfe() {
  const feed = bindings.transit_realtime.FeedMessage.toObject(bindings.transit_realtime.FeedMessage.decode(new Uint8Array(await (await fetch(RENFE_GPS, { signal: AbortSignal.timeout(10_000) })).arrayBuffer())), { longs: Number }) as { entity?: { vehicle?: { trip?: { tripId?: string }; vehicle?: { id?: string }; timestamp?: number; position?: { latitude: number; longitude: number } } }[] };
  const byTrip = new Map([...renfe.values()].map((v) => [v.externalTripId, v]));
  const seenAt = Date.now() + renderer.clockOffset;
  for (const entity of feed.entity ?? []) {
    const raw = entity.vehicle, tripId = raw?.trip?.tripId;
    if (!raw?.timestamp || !raw.position || !tripId) continue;
    const key = `${tripId}:${raw.timestamp}`, at = raw.timestamp * 1000; if (seenFixes.has(key)) continue;
    const vehicle = byTrip.get(tripId);
    if (!vehicle) { if (raw.position.latitude > 39.8 && raw.position.latitude < 41.2 && raw.position.longitude > -4.6 && raw.position.longitude < -3) { seenFixes.add(key); fixes.write(JSON.stringify({ kind: 'unmatched', tripId, at }) + '\n'); } continue; }
    seenFixes.add(key);
    const drawn = (samples.get(vehicle.id) ?? []).find((s) => Math.abs(s.at - at) <= 250), shape = renderer.shapes.get(vehicle.shapeKey);
    if (!drawn || !shape || drawn.shapeKey !== vehicle.shapeKey) { fixes.write(JSON.stringify({ kind: 'not-drawn-at-fix', id: vehicle.id, at, latency: seenAt - at }) + '\n'); continue; }
    const point: [number, number] = [raw.position.longitude, raw.position.latitude], truth = project(shape, point, drawn.progress, 3000), drawnPoint = positionAlong(shape, drawn.progress)?.coordinate;
    const where = point.map((c) => c.toFixed(5)).join(','), moved = lastPosition.has(tripId) && lastPosition.get(tripId) !== where; lastPosition.set(tripId, where);
    fixes.write(JSON.stringify({ kind: 'fix', id: vehicle.id, line: vehicle.label, at, latency: seenAt - at, moved, along: Math.round(drawn.progress - truth.progress), lateral: Math.round(truth.distance), map: drawnPoint ? Math.round(meters(drawnPoint, point)) : null, source: vehicle.positionSource }) + '\n');
  }
}

async function captureMetro() {
  const text = await (await fetch(METRO_TELEINDICADORES_URL, { signal: AbortSignal.timeout(15_000) })).text();
  fs.writeFileSync(path.join(captures, `${Math.round(Date.now() / 1000)}.xml`), text);
}
async function askEmt() {
  for (const stop of emtStops) await fetch(`${api}/api/stops/emt-madrid/${encodeURIComponent(stop)}?cityId=${city}`).catch(() => undefined);
}

const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]) : null; };
function summary() {
  const operators = Object.fromEntries([...stats].map(([operator, s]) => {
    const lifetimes = [...s.seen.values()].map((v) => (v.last - v.first) / 1000), mean = s.vehicles.reduce((a, b) => a + b, 0) / Math.max(1, s.vehicles.length);
    return [operator, { meanVehicles: +mean.toFixed(1), maxVehicles: Math.max(0, ...s.vehicles), positionSources: s.sources, sourceAgeSeconds: { median: percentile(s.ages, .5), p90: percentile(s.ages, .9) }, distinctIds: s.seen.size, idsPerVehicle: +(s.seen.size / Math.max(1, mean)).toFixed(2), medianIdLifetimeSeconds: percentile(lifetimes, .5), steps: s.steps, backwards: s.backwards, jumps: s.jumps }];
  }));
  const rows = fs.existsSync(path.join(output, 'renfe-fixes.jsonl')) ? fs.readFileSync(path.join(output, 'renfe-fixes.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const fixed = rows.filter((r) => r.kind === 'fix'), along = fixed.map((r) => Math.abs(r.along)), map = fixed.flatMap((r) => r.map === null ? [] : [r.map]);
  const moved = fixed.filter((r) => r.moved), movedAlong = moved.map((r) => Math.abs(r.along)), movedMap = moved.flatMap((r) => r.map === null ? [] : [r.map]);
  const renfeGps = { fixes: fixed.length, moved: { fixes: moved.length, absAlongMeters: { median: percentile(movedAlong, .5), p90: percentile(movedAlong, .9) }, signedAlongMedian: percentile(moved.map((r) => r.along), .5), mapMeters: { median: percentile(movedMap, .5), p90: percentile(movedMap, .9) } }, unmatched: rows.filter((r) => r.kind === 'unmatched').length, notDrawn: rows.filter((r) => r.kind === 'not-drawn-at-fix').length, absAlongMeters: { median: percentile(along, .5), p90: percentile(along, .9) }, mapMeters: { median: percentile(map, .5), p90: percentile(map, .9) }, latencySeconds: { median: percentile(fixed.map((r) => r.latency / 1000), .5) } };
  return { startedAt: new Date(started).toISOString(), minutes, snapshots, operators, renfeGps };
}

const started = Date.now(), end = started + minutes * 60_000;
await snapshot();
let nextSnapshot = Date.now() + 15_000, nextRenfe = Date.now(), nextMetro = option('metro-captures') ? Date.now() : Infinity, nextEmt = emtStops.length ? Date.now() : Infinity;
const timer = setInterval(sample, 200);
while (Date.now() < end) {
  const now = Date.now();
  if (now >= nextSnapshot) { nextSnapshot += 15_000; snapshot().catch((e) => console.warn('snapshot', e.message)); }
  if (now >= nextRenfe) { nextRenfe += 15_000; pollRenfe().catch((e) => console.warn('renfe', e.message)); }
  if (now >= nextMetro) { nextMetro += 30_000; captureMetro().catch((e) => console.warn('metro', e.message)); }
  if (now >= nextEmt) { nextEmt += 60_000; askEmt().catch((e) => console.warn('emt', e.message)); }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
clearInterval(timer);
await new Promise((resolve) => fixes.end(resolve));
const result = summary();
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(0);
