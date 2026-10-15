import { TransitRenderer } from '../src/map/transitRenderer';
import { positionAlong } from '../src/transit/motion';
import type { Network, Shape, Vehicle } from '../shared/transit/network';

/**
 * Checks that "Llegando" means what it says: whenever the operator's passing times say a bus
 * is due at a stop, how far from that stop is the map drawing it? Also counts buses whose own
 * timeline is already due at the next stop ahead of where they are drawn.
 *
 * Runs the browser's TransitRenderer on /api/transit (every 15 s, as the app does) and,
 * every 5 s, measures the distance from each drawn bus to the next stop the app shows.
 *
 * Usage: node --use-system-ca --import tsx server/monitor-arriving.ts <minutes> [operator] [api]
 */
const minutes = Number(process.argv[2] ?? 10), operator = process.argv[3] ?? 'bizkaibus', api = process.argv[4] ?? 'http://localhost:3001';
const city = 'es-bilbao';
const renderer = new TransitRenderer({} as never);
const network = await (await fetch(`${api}/api/network?cityId=${city}`)).json() as Network;
const stops = new Map(network.stops.map((stop) => [stop.key, stop]));
let vehicles: Vehicle[] = [];
const R = 111_320;
const meters = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * R * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * R);

async function refresh() {
  const body = await (await fetch(`${api}/api/transit?cityId=${city}`)).json() as { vehicles: Vehicle[]; fetchedAt: number; serverTime: number };
  vehicles = body.vehicles.filter((v) => v.operatorId === operator);
  const missing = [...new Set(vehicles.map((v) => v.shapeKey))].filter((key) => !renderer.shapes.has(key));
  for (let i = 0; i < missing.length; i += 100) {
    const shapes = await (await fetch(`${api}/api/geometries?cityId=${city}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: missing.slice(i, i + 100) }) })).json() as Shape[];
    for (const shape of shapes) renderer.shapes.set(shape.key, shape);
  }
  renderer.update(vehicles, body.fetchedAt, body.serverTime);
}

const arriving: number[] = [], labelled: number[] = [], examples: string[] = [];
const end = Date.now() + minutes * 60_000;
await refresh();
let nextRefresh = Date.now() + 15_000, nextSample = Date.now() + 5_000;
while (Date.now() < end) {
  if (Date.now() >= nextRefresh) { nextRefresh += 15_000; await refresh().catch(() => {}); }
  if (Date.now() >= nextSample) {
    nextSample += 5_000;
    const now = Date.now() + renderer.clockOffset;
    for (const v of vehicles) {
      const shape = renderer.shapes.get(v.shapeKey), progress = renderer.progressMeters(v.id);
      if (!shape || progress === null) continue;
      // What the operator says: the first stop ahead of the drawn bus whose official arrival is due.
      const official = (v.arrivalPredictions ?? []).find((p) => p.progress > progress - 30);
      if (official && official.at <= now + 30_000) {
        const distance = official.progress - progress;
        arriving.push(Math.abs(distance));
        if (Math.abs(distance) > 800 && examples.length < 15) examples.push(`${v.label}: la Diputación lo da llegando y se dibuja a ${Math.round(distance)} m de la parada (GPS ${v.observationTimestamp ? Math.round((now - v.observationTimestamp) / 1000) + ' s' : 'no'})`);
      }
      // What the app labels: the next stop ahead of the drawn bus with its time already due.
      const due = v.timeline.find((a) => a.progress > progress + 10);
      if (due && due.at <= now) labelled.push(due.progress - progress);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
arriving.sort((a, b) => a - b);
const q = (p: number) => Math.round(arriving[Math.floor(p * (arriving.length - 1))] ?? NaN);
console.log(JSON.stringify({ operator, officialArriving: { samples: arriving.length, median: q(.5), p90: q(.9), max: q(1), over500: arriving.filter((d) => d > 500).length, over1000: arriving.filter((d) => d > 1000).length } }));
labelled.sort((a, b) => a - b);
console.log(JSON.stringify({ timelineDue: { samples: labelled.length, median: Math.round(labelled[Math.floor(labelled.length / 2)] ?? NaN), p90: Math.round(labelled[Math.floor(labelled.length * .9)] ?? NaN), over500: labelled.filter((d) => d > 500).length } }));
for (const line of examples) console.log(line);
process.exit(0);
