import fs from 'node:fs';
import { TransitRenderer } from '../src/map/transitRenderer';
import { positionAlong } from '../src/transit/motion';
import type { Shape, Vehicle } from '../shared/transit/network';
import { decodeBizkaibusRealtime } from './providers/bizkaibus/realtime';
import { BIZKAIBUS_REALTIME_URL } from './providers/bizkaibus/config';
import { BILBOBUS_POSITIONS, bilbobusPositionTimestamp, ed50ToWgs84, type BilbobusPosition } from './providers/bilbobus';

/**
 * Measures how far the map draws buses from where they really are.
 *
 * It runs the browser's own TransitRenderer on the app's /api/transit snapshots
 * (every 15 s, as the app does) and samples where each bus is drawn. Independently
 * it polls the operators' raw GPS (Bizkaibus every 5 s, Bilbobus every 15 s). For
 * every new raw fix taken at time t it compares the fix with where the map was
 * drawing that bus at t: along-track error (+ ahead, − behind), distance on the
 * map and the fix's lateral distance to the shape.
 *
 * Usage: node --use-system-ca --import tsx server/monitor-bus-accuracy.ts <minutes> <output.jsonl> [api]
 */
const minutes = Number(process.argv[2] ?? 20);
const output = process.argv[3] ?? 'bus-accuracy.jsonl';
const api = process.argv[4] ?? 'http://localhost:3001';
const city = 'es-bilbao';

const renderer = new TransitRenderer({} as never);
const vehicles = new Map<string, Vehicle>();
const samples = new Map<string, { at: number; progress: number; shapeKey: string }[]>();
const seenFixes = new Set<string>();
const out = fs.createWriteStream(output);

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

async function refreshSnapshot() {
  const body = await (await fetch(`${api}/api/transit?cityId=${city}`)).json() as { vehicles: Vehicle[]; fetchedAt: number; serverTime: number };
  const buses = body.vehicles.filter((v) => (v.operatorId === 'bizkaibus' || v.operatorId === 'bilbobus') && v.observationTimestamp !== null);
  const missing = [...new Set(buses.map((v) => v.shapeKey))].filter((key) => !renderer.shapes.has(key));
  for (let i = 0; i < missing.length; i += 100) {
    const shapes = await (await fetch(`${api}/api/geometries?cityId=${city}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: missing.slice(i, i + 100) }) })).json() as Shape[];
    for (const shape of shapes) renderer.shapes.set(shape.key, shape);
  }
  renderer.update(buses, body.fetchedAt, body.serverTime);
  vehicles.clear();
  for (const v of buses) vehicles.set(v.id, v);
}

function sample() {
  const now = Date.now() + renderer.clockOffset;
  for (const [id, v] of vehicles) {
    const progress = renderer.progressMeters(id); if (progress === null) continue;
    if (!samples.has(id)) samples.set(id, []);
    const list = samples.get(id)!;
    list.push({ at: now, progress, shapeKey: v.shapeKey });
    while (list.length && list[0].at < now - 180_000) list.shift();
  }
}

function evaluate(operatorId: string, vehicle: Vehicle | undefined, at: number, point: [number, number], key: string) {
  if (seenFixes.has(key)) return; seenFixes.add(key);
  const seenAt = Date.now() + renderer.clockOffset;
  if (!vehicle) { out.write(JSON.stringify({ operatorId, kind: 'unmatched', at, seenAt }) + '\n'); return; }
  const list = samples.get(vehicle.id) ?? [];
  const drawn = list.find((s) => Math.abs(s.at - at) <= 250);
  const shape = renderer.shapes.get(vehicle.shapeKey);
  if (!drawn || !shape || drawn.shapeKey !== vehicle.shapeKey) { out.write(JSON.stringify({ operatorId, kind: 'not-drawn-at-fix', id: vehicle.id, at, seenAt, latency: seenAt - at }) + '\n'); return; }
  const truth = project(shape, point, drawn.progress, 2500);
  const drawnPoint = positionAlong(shape, drawn.progress)?.coordinate;
  const diagnostics = renderer.diagnostics(vehicle.id);
  out.write(JSON.stringify({
    operatorId, kind: 'fix', id: vehicle.id, line: vehicle.label, at, seenAt, latency: seenAt - at,
    along: Math.round(drawn.progress - truth.progress), lateral: Math.round(truth.distance), map: drawnPoint ? Math.round(meters(drawnPoint, point)) : null,
    drawn: Math.round(drawn.progress), truth: Math.round(truth.progress), snapshotObservedAt: vehicle.observationTimestamp, snapshotProgress: Math.round(vehicle.observationProgressMeters ?? vehicle.progressMetersAlongShape),
    timelineSource: vehicle.timelineSource, speed: diagnostics ? +diagnostics.renderedSpeed.toFixed(1) : null, pace: diagnostics ? +diagnostics.predictionPace.toFixed(1) : null, cadence: diagnostics?.cadenceSeconds, targetGap: diagnostics ? Math.round(diagnostics.correctionErrorMeters) : null,
  }) + '\n');
}

async function pollBizkaibus() {
  const response = await fetch(BIZKAIBUS_REALTIME_URL, { signal: AbortSignal.timeout(10_000) });
  const snapshot = decodeBizkaibusRealtime(Buffer.from(await response.arrayBuffer()), Date.now(), Date.now());
  const byTrip = new Map([...vehicles.values()].filter((v) => v.operatorId === 'bizkaibus').map((v) => [v.externalTripId, v]));
  for (const raw of snapshot.vehicles) {
    if (!raw.tripId || !raw.timestamp) continue;
    evaluate('bizkaibus', byTrip.get(raw.tripId), raw.timestamp * 1000, [raw.rawLongitude, raw.rawLatitude], `bz:${raw.tripId}:${raw.timestamp}`);
  }
}

async function pollBilbobus() {
  const fleet = [...vehicles.values()].filter((v) => v.operatorId === 'bilbobus');
  const byVehicle = new Map(fleet.map((v) => [String(v.externalVehicleId ?? v.vehicleId?.split(':').pop()), v]));
  const queue = [...new Set(fleet.map((v) => v.label))].flatMap((line) => ['IDA', 'VLT'].map((direction) => `${BILBOBUS_POSITIONS}/${encodeURIComponent(line)}/${direction}`));
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const url = queue.shift()!;
      try {
        const body = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json() as { rows?: BilbobusPosition[] };
        for (const row of body.rows ?? []) {
          const at = bilbobusPositionTimestamp(row.Instante), point = ed50ToWgs84(Number(row.CoordX), Number(row.CoordY));
          if (at === null || !point) continue;
          evaluate('bilbobus', byVehicle.get(String(row.Vehiculo)), at, point, `bb:${row.Vehiculo}:${at}`);
        }
      } catch { /* A failed line is simply not measured this round. */ }
    }
  }));
}

const end = Date.now() + minutes * 60_000;
await refreshSnapshot();
let nextSnapshot = Date.now() + 15_000, nextBizkaibus = Date.now(), nextBilbobus = Date.now() + 2000;
const timer = setInterval(sample, 200);
while (Date.now() < end) {
  const now = Date.now();
  if (now >= nextSnapshot) { nextSnapshot += 15_000; refreshSnapshot().catch((e) => console.warn('snapshot', e.message)); }
  if (now >= nextBizkaibus) { nextBizkaibus += 5_000; pollBizkaibus().catch((e) => console.warn('bizkaibus', e.message)); }
  if (now >= nextBilbobus) { nextBilbobus += 15_000; pollBilbobus().catch((e) => console.warn('bilbobus', e.message)); }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
clearInterval(timer);
out.end();
console.log(JSON.stringify({ output, fixes: seenFixes.size }));
process.exit(0);
