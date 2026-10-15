import fs from 'node:fs';
import path from 'node:path';

/**
 * Import reviewed OSM rail tunnels for one operator from an Overpass response;
 * never download infrastructure during app startup.
 *
 * Usage: npx tsx server/import-rail-tunnels.ts <euskotren|metro-bilbao|renfe> <overpass-response.json>
 */
type Tags = Record<string, string>;
const QUERY = '[out:json][timeout:60];way["railway"~"^(rail|narrow_gauge|subway)$"]["tunnel"]["tunnel"!="no"](43.0,-3.4,43.46,-1.74);out tags geom;';
const running = (tags: Tags) => !tags.service && tags.usage !== 'industrial' && tags.electrified !== 'no';
const OPERATORS: Record<string, { output: string; accept: (tags: Tags) => boolean }> = {
  euskotren: {
    output: 'server/cities/es-bilbao/euskotren-tunnels.json',
    accept: (tags) => tags.railway === 'narrow_gauge' && tags.gauge === '1000' && tags.operator === 'Euskal Trenbide Sarea' && tags.tunnel === 'yes' && tags.electrified !== 'no' && tags.usage !== 'industrial',
  },
  // Metro Bilbao (L1/L2): ETS-owned subway lines, mapped as railway=subway.
  'metro-bilbao': {
    output: 'server/cities/es-bilbao/metro-tunnels.json',
    accept: (tags) => running(tags) && tags.railway === 'subway' && tags.tunnel === 'yes' && tags.operator === 'Euskal Trenbide Sarea',
  },
  // Cercanías Bilbao and San Sebastián: Adif Iberian gauge (C1–C3, Donostia C1) and metre gauge (ex-FEVE C4/C5).
  // Some main-line tunnels have no operator tag; they are still Adif's, never ETS (narrow_gauge ETS is excluded).
  renfe: {
    output: 'server/cities/es-bilbao/renfe-tunnels.json',
    accept: (tags) => running(tags) && ((tags.railway === 'rail' && /(^|;)1668($|;)/.test(tags.gauge ?? '') && (tags.operator === 'Adif' || !tags.operator))
      || (tags.railway === 'narrow_gauge' && tags.gauge === '1000' && (tags.operator === 'Adif' || (!tags.operator && tags.usage === 'main')))),
  },
};

const [operator, input] = process.argv.slice(2);
const config = OPERATORS[operator];
if (!config || !input) throw new Error(`Usage: npx tsx server/import-rail-tunnels.ts <${Object.keys(OPERATORS).join('|')}> <overpass-response.json>`);
const response = JSON.parse(fs.readFileSync(input, 'utf8')) as {
  remark?: string; osm3s?: { timestamp_osm_base?: string };
  elements?: { type: string; id: number; tags?: Tags; geometry?: { lon: number; lat: number }[] }[];
};
if (response.remark || !response.osm3s?.timestamp_osm_base || !Array.isArray(response.elements)) throw new Error('Incomplete Overpass response');
const ways = response.elements.filter((way) => way.type === 'way' && config.accept(way.tags ?? {}) && (way.geometry?.length ?? 0) >= 2).map((way) => {
  if (!way.geometry!.every((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat) && Math.abs(point.lon) <= 180 && Math.abs(point.lat) <= 90)) throw new Error('Invalid tunnel coordinates');
  return { id: way.id, coordinates: way.geometry!.map((point) => [point.lon, point.lat]) };
}).sort((a, b) => a.id - b.id);
if (!ways.length) throw new Error(`No ${operator} tunnel geometry found`);
const dataset = {
  source: 'OpenStreetMap contributors', license: 'ODbL-1.0',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  endpoint: 'https://overpass-api.de/api/interpreter', query: QUERY,
  sourceTimestamp: response.osm3s.timestamp_osm_base, ways,
};
const output = path.resolve(config.output);
// One line per source way keeps the checked-in geometry compact and reviewable.
const header = JSON.stringify({ ...dataset, ways: undefined }, null, 2).slice(0, -2);
fs.writeFileSync(output, header + ',\n  "ways": [\n' + ways.map((way) => '    ' + JSON.stringify(way)).join(',\n') + '\n  ]\n}\n');
console.log(JSON.stringify({ output, sourceTimestamp: dataset.sourceTimestamp, ways: ways.length, points: ways.reduce((sum, way) => sum + way.coordinates.length, 0) }));
