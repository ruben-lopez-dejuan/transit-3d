import fs from 'node:fs';
import { TRAM_TRACKS_FILE, type TrackWay } from './transit/trackMatching';

/**
 * Import the reviewed Euskotren tram tracks (Bilbao and Vitoria-Gasteiz) from an
 * Overpass response; the app never calls Overpass. Tram shapes are matched onto
 * them while the feed is prepared (server/transit/trackMatching.ts).
 *
 * Usage: npx tsx server/import-tram-tracks.ts <overpass-response.json>
 * Query: see QUERY below.
 */
const QUERY = '[out:json][timeout:60];(way["railway"="tram"](43.23,-2.98,43.28,-2.88);way["railway"="tram"](42.81,-2.75,42.89,-2.62););out tags geom;';

const input = process.argv[2];
if (!input) throw new Error('Usage: npx tsx server/import-tram-tracks.ts <overpass-response.json>');
const response = JSON.parse(fs.readFileSync(input, 'utf8')) as {
  remark?: string; osm3s?: { timestamp_osm_base?: string };
  elements?: { type: string; id: number; tags?: Record<string, string>; geometry?: { lon: number; lat: number }[] }[];
};
if (response.remark || !response.osm3s?.timestamp_osm_base || !Array.isArray(response.elements)) throw new Error('Incomplete Overpass response');

/** The direction trams run along the way, where OSM says (Vitoria-Gasteiz tags most of its tracks). */
const direction = (tags: Record<string, string>) => tags['railway:preferred_direction'] === 'forward' || tags.oneway === 'yes' ? 'forward' as const
  : tags['railway:preferred_direction'] === 'backward' || tags.oneway === '-1' ? 'backward' as const : undefined;
// Seven decimals keep the nodes two ways share identical, so the network stays connected.
const ways: TrackWay[] = response.elements
  .filter((way) => way.type === 'way' && way.tags?.railway === 'tram' && way.tags.operator === 'Euskal Trenbide Sarea' && (way.geometry?.length ?? 0) >= 2)
  .sort((a, b) => a.id - b.id)
  .map((way) => ({ id: way.id, ...(way.tags!.service ? { service: way.tags!.service } : {}), ...(direction(way.tags!) ? { direction: direction(way.tags!) } : {}), path: way.geometry!.map(({ lon, lat }) => [Number(lon.toFixed(7)), Number(lat.toFixed(7))] as [number, number]) }));

const dataset = {
  source: 'OpenStreetMap contributors', license: 'ODbL-1.0', attributionUrl: 'https://www.openstreetmap.org/copyright',
  endpoint: 'https://overpass-api.de/api/interpreter', query: QUERY, sourceTimestamp: response.osm3s.timestamp_osm_base,
};
const header = JSON.stringify(dataset, null, 2).slice(0, -2);
fs.writeFileSync(TRAM_TRACKS_FILE, header + ',\n  "ways": [\n' + ways.map((way) => '    ' + JSON.stringify(way)).join(',\n') + '\n  ]\n}\n');
console.log(JSON.stringify({ ways: ways.length, service: ways.filter((way) => way.service).length, points: ways.reduce((sum, way) => sum + way.path.length, 0) }));
