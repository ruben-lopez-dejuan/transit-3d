import fs from 'node:fs';
import { RAIL_TRACKS_FILE, TrackNetwork, TRAM_TRACKS_FILE, type TrackStation, type TrackWay } from './transit/trackMatching';

/**
 * Import reviewed OSM tracks from an Overpass response; the app never calls Overpass.
 * Shapes are matched onto them while the feed is prepared (server/transit/trackMatching.ts).
 *
 * - tram: the Euskotren tram tracks of Bilbao and Vitoria-Gasteiz.
 * - euskotren: the Euskotren tunnel Matiko – Kukullaga (L3, and E1, E3 and E4 through it),
 *   from the Artxanda tunnel to the surface south of Kukullaga, with its platforms: the
 *   feed puts its underground stations at the street entrances, up to 170 m off the track.
 *
 * Usage: npx tsx server/import-tracks.ts <tram|euskotren> <overpass-response.json>
 * Query: see DATASETS below.
 */
type Tags = Record<string, string>;
const DATASETS: Record<string, { query: string; output: string; accept: (tags: Tags) => boolean; connected?: boolean; stations?: boolean }> = {
  tram: {
    query: '[out:json][timeout:60];(way["railway"="tram"](43.23,-2.98,43.28,-2.88);way["railway"="tram"](42.81,-2.75,42.89,-2.62););out tags geom;',
    output: TRAM_TRACKS_FILE,
    accept: (tags) => tags.railway === 'tram' && tags.operator === 'Euskal Trenbide Sarea',
  },
  // ETS also owns Metro Bilbao (railway=subway, "L1-L2 Metro Bilbao", unnamed crossovers):
  // only the network joined to the Euskotren line is kept.
  euskotren: {
    query: '[out:json][timeout:60];(way["railway"~"^(rail|narrow_gauge|subway)$"](43.2485,-2.935,43.275,-2.885);node["railway"~"^(stop|station|halt)$"](43.2485,-2.935,43.275,-2.885););out tags geom;',
    output: RAIL_TRACKS_FILE,
    accept: (tags) => tags.operator === 'Euskal Trenbide Sarea' && !/Metro/i.test(tags.name ?? '') && tags.electrified !== 'no',
    connected: true,
    stations: true,
  },
};

const [name, input] = process.argv.slice(2);
const dataset = DATASETS[name];
if (!dataset || !input) throw new Error(`Usage: npx tsx server/import-tracks.ts <${Object.keys(DATASETS).join('|')}> <overpass-response.json>`);
const response = JSON.parse(fs.readFileSync(input, 'utf8')) as {
  remark?: string; osm3s?: { timestamp_osm_base?: string };
  elements?: { type: string; id: number; tags?: Tags; geometry?: { lon: number; lat: number }[]; lon?: number; lat?: number }[];
};
if (response.remark || !response.osm3s?.timestamp_osm_base || !Array.isArray(response.elements)) throw new Error('Incomplete Overpass response');

/** The direction trains run along the way, where OSM says (Vitoria-Gasteiz tags most of its tram tracks). */
const direction = (tags: Tags) => tags['railway:preferred_direction'] === 'forward' || tags.oneway === 'yes' ? 'forward' as const
  : tags['railway:preferred_direction'] === 'backward' || tags.oneway === '-1' ? 'backward' as const : undefined;
// Seven decimals keep the nodes two ways share identical, so the network stays connected.
let ways: TrackWay[] = response.elements
  .filter((way) => way.type === 'way' && dataset.accept(way.tags ?? {}) && (way.geometry?.length ?? 0) >= 2)
  .sort((a, b) => a.id - b.id)
  .map((way) => ({ id: way.id, ...(way.tags!.service ? { service: way.tags!.service } : {}), ...(direction(way.tags!) ? { direction: direction(way.tags!) } : {}), path: way.geometry!.map(({ lon, lat }) => [Number(lon.toFixed(7)), Number(lat.toFixed(7))] as [number, number]) }));
if (dataset.connected) {
  // The largest set of ways joined by shared nodes.
  const parent = ways.map((_, i) => i), owner = new Map<string, number>();
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]));
  ways.forEach((way, i) => way.path.forEach((point) => { const key = point.join(','), other = owner.get(key); if (other !== undefined) parent[root(i)] = root(other); owner.set(key, i); }));
  const sizes = new Map<number, number>();
  ways.forEach((way, i) => sizes.set(root(i), (sizes.get(root(i)) ?? 0) + way.path.length));
  const largest = [...sizes].reduce((best, entry) => entry[1] > best[1] ? entry : best)[0];
  ways = ways.filter((_, i) => root(i) === largest);
}
if (!ways.length) throw new Error(`No ${name} tracks found`);

// Platforms: the stop positions OSM puts on these tracks (Metro Bilbao and tram stops nearby are
// on other tracks), or the station node where a station has none (Zurbaranbarri).
let stations: TrackStation[] = [];
if (dataset.stations) {
  const network = new TrackNetwork(ways);
  const nodes = response.elements.filter((node) => node.type === 'node' && node.tags?.name && Number.isFinite(node.lon) && Number.isFinite(node.lat) && network.onTrack([node.lon!, node.lat!], 2));
  const names = [...new Set(nodes.map((node) => node.tags!.name))].sort();
  stations = names.map((station) => {
    const named = nodes.filter((node) => node.tags!.name === station);
    const stops = named.filter((node) => node.tags!.public_transport === 'stop_position' || node.tags!.railway === 'stop');
    const chosen = (stops.length ? stops : named).sort((a, b) => a.id - b.id);
    const mean = (key: 'lon' | 'lat') => Number((chosen.reduce((sum, node) => sum + node[key]!, 0) / chosen.length).toFixed(7));
    return { name: station, ids: chosen.map((node) => node.id), point: [mean('lon'), mean('lat')] as [number, number] };
  });
}

const header = JSON.stringify({
  source: 'OpenStreetMap contributors', license: 'ODbL-1.0', attributionUrl: 'https://www.openstreetmap.org/copyright',
  endpoint: 'https://overpass-api.de/api/interpreter', query: dataset.query, sourceTimestamp: response.osm3s.timestamp_osm_base,
}, null, 2).slice(0, -2);
const list = (items: unknown[]) => '[\n' + items.map((item) => '    ' + JSON.stringify(item)).join(',\n') + '\n  ]';
fs.writeFileSync(dataset.output, header + (dataset.stations ? ',\n  "stations": ' + list(stations) : '') + ',\n  "ways": ' + list(ways) + '\n}\n');
console.log(JSON.stringify({ ways: ways.length, service: ways.filter((way) => way.service).length, points: ways.reduce((sum, way) => sum + way.path.length, 0), stations: stations.map((station) => station.name) }));
