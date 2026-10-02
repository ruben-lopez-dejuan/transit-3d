import fs from 'node:fs';
import path from 'node:path';

/** Import a reviewed Overpass response; never download infrastructure during app startup. */
const input = process.argv[2];
if (!input) throw new Error('Usage: npx tsx server/import-euskotren-tunnels.ts <overpass-response.json>');
const response = JSON.parse(fs.readFileSync(input, 'utf8')) as {
  remark?: string; osm3s?: { timestamp_osm_base?: string };
  elements?: { type: string; id: number; tags?: Record<string, string>; geometry?: { lon: number; lat: number }[] }[];
};
if (response.remark || !response.osm3s?.timestamp_osm_base || !Array.isArray(response.elements)) throw new Error('Incomplete Overpass response');
const ways = response.elements.filter((way) => {
  const tags = way.tags;
  return way.type === 'way' && tags?.railway === 'narrow_gauge' && tags.gauge === '1000'
    && tags.operator === 'Euskal Trenbide Sarea' && tags.tunnel === 'yes'
    && tags.electrified !== 'no' && tags.usage !== 'industrial'
    && (way.geometry?.length ?? 0) >= 2;
}).map((way) => {
  if (!way.geometry!.every((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat) && Math.abs(point.lon) <= 180 && Math.abs(point.lat) <= 90)) throw new Error('Invalid tunnel coordinates');
  return { id: way.id, coordinates: way.geometry!.map((point) => [point.lon, point.lat]) };
}).sort((a, b) => a.id - b.id);
if (!ways.length) throw new Error('No active ETS narrow-gauge tunnel geometry found');
const dataset = {
  source: 'OpenStreetMap contributors', license: 'ODbL-1.0',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  endpoint: 'https://overpass-api.de/api/interpreter',
  query: '[out:json][timeout:20];way["railway"~"^(rail|narrow_gauge|subway)$"]["tunnel"]["tunnel"!="no"](43.0,-3.05,43.46,-1.74);out tags geom;',
  sourceTimestamp: response.osm3s.timestamp_osm_base, ways,
};
const output = path.resolve('server/cities/es-bilbao/euskotren-tunnels.json');
// One line per source way keeps the checked-in geometry compact and reviewable.
const header = JSON.stringify({ ...dataset, ways: undefined }, null, 2).slice(0, -2);
fs.writeFileSync(output, header + ',\n  "ways": [\n' + ways.map((way) => '    ' + JSON.stringify(way)).join(',\n') + '\n  ]\n}\n');
console.log(JSON.stringify({ output, sourceTimestamp: dataset.sourceTimestamp, ways: ways.length, points: ways.reduce((sum, way) => sum + way.coordinates.length, 0) }));
