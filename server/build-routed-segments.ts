import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { bearing, rejectRoute, segmentKey, simplifyPath, straightMeters, MAX_DETOUR_RATIO, MAX_SNAP_METERS, ROUTED_SEGMENTS_FILE, type RoutedSegments } from './transit/routedSegments';

/**
 * Some bus feeds draw their shapes as straight lines between stops (La Unión,
 * Oñati) or skip kilometres between two points (Alavabus, PESA). This routes
 * each long straight segment along roads once, offline, with the public OSRM
 * demo (OpenStreetMap data, at most one request per second), and keeps the
 * result in a reviewed dataset. The app never calls a router at runtime.
 *
 * Usage: node --use-system-ca --import tsx server/build-routed-segments.ts [--retry-rejected]
 * Reads the GTFS already cached under server/cache; reruns only route new segments,
 * or also the rejected ones again with --retry-rejected.
 */
const ENDPOINT = 'https://router.project-osrm.org/route/v1/driving';
/** Feeds whose shapes are stop-to-stop straight lines: every segment longer than this is routed. */
const STOP_TO_STOP_FEEDS: Record<string, number> = { 'la-union': 300, onati: 300 };
/** Elsewhere a road shape rarely has two points more than a kilometre apart. */
const LONG_SEGMENT_METERS = 1000;
const RAIL_FEEDS = new Set(['euskotren', 'metro-bilbao', 'renfe', 'funicular-artxanda', 'pte-colgante']);
/** Above this the plain route may have snapped onto the wrong carriageway: ask again with the direction of travel. */
const RETRY_WITH_BEARINGS_RATIO = 2.2;

const cache = path.resolve('server/cache');
const rows = (file: string) => parse(fs.readFileSync(file), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
const existing: RoutedSegments = fs.existsSync(ROUTED_SEGMENTS_FILE) ? JSON.parse(fs.readFileSync(ROUTED_SEGMENTS_FILE, 'utf8')) : { segments: {}, rejected: {} } as unknown as RoutedSegments;
const segments = new Map(Object.entries(existing.segments));
const rejected = new Map(Object.entries(existing.rejected ?? {}));

const wanted = new Map<string, { from: [number, number]; to: [number, number]; feeds: Set<string> }>();
for (const feed of fs.readdirSync(cache).sort()) {
  if (RAIL_FEEDS.has(feed)) continue;
  const directory = fs.existsSync(path.join(cache, feed, 'gtfs', 'shapes.txt')) ? path.join(cache, feed, 'gtfs') : path.join(cache, feed);
  if (!fs.existsSync(path.join(directory, 'shapes.txt'))) continue;
  const minimum = STOP_TO_STOP_FEEDS[feed] ?? LONG_SEGMENT_METERS;
  const shapes = new Map<string, { sequence: number; point: [number, number] }[]>();
  for (const row of rows(path.join(directory, 'shapes.txt'))) {
    const point: [number, number] = [Number(row.shape_pt_lon), Number(row.shape_pt_lat)];
    if (!point.every(Number.isFinite)) continue;
    if (!shapes.has(row.shape_id)) shapes.set(row.shape_id, []);
    shapes.get(row.shape_id)!.push({ sequence: Number(row.shape_pt_sequence), point });
  }
  for (const points of shapes.values()) {
    points.sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1].point, to = points[i].point;
      if (straightMeters(from, to) <= minimum) continue;
      const key = segmentKey(from, to);
      if (!wanted.has(key)) wanted.set(key, { from, to, feeds: new Set() });
      wanted.get(key)!.feeds.add(feed);
    }
  }
}

const retryRejected = process.argv.includes('--retry-rejected');
const pending = [...wanted].filter(([key]) => !segments.has(key) && (retryRejected || !rejected.has(key)));
console.log(JSON.stringify({ segments: wanted.size, alreadyRouted: segments.size, alreadyRejected: rejected.size, pending: pending.length }));

const save = () => {
  const dataset = {
    source: 'OpenStreetMap contributors, routed with OSRM', license: 'ODbL-1.0', attributionUrl: 'https://www.openstreetmap.org/copyright',
    endpoint: ENDPOINT, generatedAt: new Date().toISOString(), maxDetourRatio: MAX_DETOUR_RATIO, maxSnapMeters: MAX_SNAP_METERS,
  };
  const header = JSON.stringify(dataset, null, 2).slice(0, -2);
  const sortedSegments = [...segments].sort(([a], [b]) => a.localeCompare(b));
  const sortedRejected = [...rejected].sort(([a], [b]) => a.localeCompare(b));
  // One line per segment keeps the checked-in geometry reviewable.
  fs.writeFileSync(ROUTED_SEGMENTS_FILE, header + ',\n  "segments": {\n' + sortedSegments.map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n') + '\n  },\n  "rejected": {\n' + sortedRejected.map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n') + '\n  }\n}\n');
};
type OsrmResponse = { code?: string; routes?: { distance: number; geometry: { coordinates: [number, number][] } }[]; waypoints?: { distance: number }[] };
let done = 0;
async function osrm(url: string) {
  let body = null as OsrmResponse | null;
  for (let attempt = 0; attempt < 4 && !body; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'transit-3d shape repair (offline, one request per second)' }, signal: AbortSignal.timeout(20_000) });
      if (response.status === 429 || response.status >= 500) { await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1))); continue; }
      body = await response.json() as OsrmResponse;
    } catch { await new Promise((resolve) => setTimeout(resolve, 3000)); }
  }
  const route = body?.code === 'Ok' ? body.routes?.[0] : undefined;
  return { body, route, snap: Math.max(...(body?.waypoints ?? [{ distance: Infinity }]).map((w) => w.distance)) };
}
for (const [key, { from, to }] of pending) {
  const straight = straightMeters(from, to);
  let { body, route, snap } = await osrm(`${ENDPOINT}/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`);
  if (!route || route.distance > straight * RETRY_WITH_BEARINGS_RATIO) {
    // A stop on a dual carriageway snapped to the opposite side makes the route loop at the next junction.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const direction = bearing(from, to);
    const retry = await osrm(`${ENDPOINT}/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&bearings=${direction},60;${direction},60&radiuses=${MAX_SNAP_METERS};${MAX_SNAP_METERS}`);
    if (retry.route && (!route || retry.route.distance < route.distance)) ({ body, route, snap } = retry);
  }
  const reason = body?.code !== 'Ok' || !route ? `sin ruta (${body?.code ?? 'error'})`
    : rejectRoute({ straight, route: route.distance, snap });
  if (reason) rejected.set(key, reason);
  else { rejected.delete(key); segments.set(key, simplifyPath(route!.geometry.coordinates, 3).map(([lon, lat]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))])); }
  if (++done % 25 === 0) { save(); console.log(JSON.stringify({ done, of: pending.length, routed: segments.size, rejected: rejected.size })); }
  await new Promise((resolve) => setTimeout(resolve, 1100));
}
save();
console.log(JSON.stringify({ output: ROUTED_SEGMENTS_FILE, routed: segments.size, rejected: rejected.size }));
