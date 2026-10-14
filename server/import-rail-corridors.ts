import fs from 'node:fs';
import { CORRIDORS_FILE, simplifyPath, straightMeters, type Corridor } from './transit/routedSegments';

/**
 * Import reviewed rail corridors from an Overpass response; the app never calls Overpass.
 *
 * Euskotren's GTFS sends E3 from Sondika west to Lutxana (the shuttle's dead end) and
 * then straight 4 km back to Ola. The real line runs Sondika → Ola → Artxanda tunnel → Matiko.
 *
 * Usage: npx tsx server/import-rail-corridors.ts <overpass-response.json>
 * Query: see QUERY below (bbox around Sondika and Matiko).
 */
const QUERY = '[out:json][timeout:30];way["railway"~"^(rail|narrow_gauge|subway)$"](43.262,-2.95,43.305,-2.915);out tags geom;';
type Lonlat = [number, number];
const DEFINITIONS: { operatorId: string; name: string; from: Lonlat; to: Lonlat; excludeNames: RegExp }[] = [
  // Ends at the station platforms of the Euskotren GTFS (Sondika Q1, Matiko Q1).
  { operatorId: 'euskotren', name: 'Sondika – Ola – Matiko (túnel de Artxanda)', from: [-2.928255, 43.298278], to: [-2.92555, 43.268994], excludeNames: /Lutxana/i },
];

const input = process.argv[2];
if (!input) throw new Error('Usage: npx tsx server/import-rail-corridors.ts <overpass-response.json>');
const response = JSON.parse(fs.readFileSync(input, 'utf8')) as {
  remark?: string; osm3s?: { timestamp_osm_base?: string };
  elements?: { type: string; id: number; tags?: Record<string, string>; geometry?: { lon: number; lat: number }[] }[];
};
if (response.remark || !response.osm3s?.timestamp_osm_base || !Array.isArray(response.elements)) throw new Error('Incomplete Overpass response');

const corridors: (Corridor & { wayIds: number[]; meters: number })[] = DEFINITIONS.map((definition) => {
  // Running lines only: sidings, crossovers and spurs would offer shortcuts trains never take.
  const ways = response.elements!.filter((way) => way.type === 'way' && (way.geometry?.length ?? 0) >= 2
    && !['siding', 'crossover', 'spur', 'yard'].includes(way.tags?.service ?? '') && !definition.excludeNames.test(way.tags?.name ?? ''));
  const key = ([lon, lat]: Lonlat) => `${lon.toFixed(7)},${lat.toFixed(7)}`;
  const nodes = new Map<string, Lonlat>(), edges = new Map<string, { to: string; meters: number; way: number }[]>();
  for (const way of ways) {
    const points = way.geometry!.map((p) => [p.lon, p.lat] as Lonlat);
    for (let i = 1; i < points.length; i++) {
      const a = key(points[i - 1]), b = key(points[i]), meters = straightMeters(points[i - 1], points[i]);
      nodes.set(a, points[i - 1]); nodes.set(b, points[i]);
      for (const [from, to] of [[a, b], [b, a]]) { if (!edges.has(from)) edges.set(from, []); edges.get(from)!.push({ to, meters, way: way.id }); }
    }
  }
  const nearest = (target: Lonlat) => [...nodes].reduce((best, [id, point]) => straightMeters(point, target) < straightMeters(nodes.get(best)!, target) ? id : best, nodes.keys().next().value!);
  const start = nearest(definition.from), goal = nearest(definition.to);
  // Dijkstra; the graph has a few hundred nodes.
  const distance = new Map([[start, 0]]), previous = new Map<string, { node: string; way: number }>(), open = new Set([start]);
  while (open.size) {
    const node = [...open].reduce((a, b) => distance.get(a)! <= distance.get(b)! ? a : b);
    open.delete(node);
    if (node === goal) break;
    for (const edge of edges.get(node) ?? []) {
      const candidate = distance.get(node)! + edge.meters;
      if (candidate < (distance.get(edge.to) ?? Infinity)) { distance.set(edge.to, candidate); previous.set(edge.to, { node, way: edge.way }); open.add(edge.to); }
    }
  }
  if (!distance.has(goal)) throw new Error(`No rail path for ${definition.name}`);
  const path: Lonlat[] = [], wayIds = new Set<number>();
  for (let node: string | undefined = goal; node; node = previous.get(node)?.node) { path.unshift(nodes.get(node)!); const step = previous.get(node); if (step) wayIds.add(step.way); }
  const ends = [straightMeters(path[0], definition.from), straightMeters(path.at(-1)!, definition.to)];
  if (Math.max(...ends) > 100) throw new Error(`${definition.name}: corridor ends ${ends.map(Math.round).join(' / ')} m from the stations`);
  return { operatorId: definition.operatorId, name: definition.name, meters: Math.round(distance.get(goal)!), wayIds: [...wayIds].sort((a, b) => a - b), path: simplifyPath(path, 1).map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))] as Lonlat) };
});

const dataset = {
  source: 'OpenStreetMap contributors', license: 'ODbL-1.0', attributionUrl: 'https://www.openstreetmap.org/copyright',
  endpoint: 'https://overpass-api.de/api/interpreter', query: QUERY, sourceTimestamp: response.osm3s.timestamp_osm_base,
};
const header = JSON.stringify(dataset, null, 2).slice(0, -2);
fs.writeFileSync(CORRIDORS_FILE, header + ',\n  "corridors": [\n' + corridors.map((corridor) => '    ' + JSON.stringify(corridor)).join(',\n') + '\n  ]\n}\n');
console.log(JSON.stringify(corridors.map(({ name, meters, wayIds, path }) => ({ name, meters, ways: wayIds.length, points: path.length }))));
