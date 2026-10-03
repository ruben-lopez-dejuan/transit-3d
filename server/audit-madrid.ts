import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import bindings from 'gtfs-realtime-bindings';
import { downloadFile } from './lib/download';
import { parseGtfsDirectory } from './providers/bizkaibus/gtfs';
import { orientTripShapes } from './transit/shapeOrientation';
import { RenfeAddedTrips } from './providers/madrid/renfeAddedTrips';
import { parseMetroBoards, METRO_TELEINDICADORES_URL } from './providers/madrid/metroFeed';
import { MetroEstimates } from './providers/madrid/metroEstimates';
import { normalizeTripUpdates, type RealtimeMessage } from './transit/realtime';
import { applyRealtime } from './transit/applyRealtime';
import { generateScheduledVehicles } from './transit/scheduled';
import { parseCityPackage } from './cities/packageConfig';
import { installMetroTopology, L3_TOPOLOGY_LAYERS, METRO_TOPOLOGY_SERVICE, type TopologyDocument } from './providers/madrid/metroTopology';

// Backend/data inspection only. Does not import or start the HTTP application.
const directory = path.resolve('server/cache/audit/madrid');
const config = parseCityPackage(JSON.parse(fs.readFileSync('city-packages/es-madrid/city.json', 'utf8')));
const urls: Record<string, string> = { 'metro.zip': config.providers.find((p) => p.id === 'metro-madrid')!.sources.gtfs, 'renfe.zip': config.providers.find((p) => p.id === 'cercanias-renfe')!.sources.gtfs, 'light-rail.zip': config.providers.find((p) => p.id === 'metro-ligero-crtm')!.sources.gtfs, 'vp.pb': 'https://gtfsrt.renfe.com/vehicle_positions.pb', 'tu.pb': 'https://gtfsrt.renfe.com/trip_updates.pb', 'teleindicadores.txt': METRO_TELEINDICADORES_URL };
for (const layer of L3_TOPOLOGY_LAYERS) urls[`l3-${layer}.json`] = `${METRO_TOPOLOGY_SERVICE}/${layer}/query?f=json&where=1%3D1&outFields=*&outSR=4326&returnGeometry=true`;
const downloadFailures: string[] = [];
if (!process.argv.includes('--cached')) await Promise.all(Object.entries(urls).map(async ([name, url]) => { try { await downloadFile(url, path.join(directory, name)); } catch { downloadFailures.push(name); console.error(name, 'No descargado; solo se puede inspeccionar la copia previa si existe.'); } }));
const loadStatic = (name: string, filter?: (id: string) => boolean) => {
  const zip = new AdmZip(path.join(directory, name + '.zip')), extracted = path.join(directory, name + '-tables');
  fs.mkdirSync(extracted, { recursive: true });
  for (const table of ['routes', 'trips', 'stops', 'stop_times', 'shapes', 'calendar', 'calendar_dates', 'frequencies']) {
    const entry = zip.getEntry(table + '.txt'); if (entry) fs.writeFileSync(path.join(extracted, table + '.txt'), entry.getData()); else fs.rmSync(path.join(extracted, table + '.txt'), { force: true });
  }
  return parseGtfsDirectory(extracted, filter ? (route) => filter(route.routeId) : undefined);
};
const renfe = loadStatic('renfe', (id) => config.providers.find((p) => p.id === 'cercanias-renfe')!.routeIds!.includes(id));
const orientation = orientTripShapes(renfe);
const decode = (file: string) => bindings.transit_realtime.FeedMessage.toObject(bindings.transit_realtime.FeedMessage.decode(fs.readFileSync(path.join(directory, file))), { longs: Number, enums: String }) as RealtimeMessage;
const gps = decode('vp.pb'), tu = decode('tu.pb');
const sourceAt = Math.max(gps.header?.timestamp ?? 0, tu.header?.timestamp ?? 0) * 1000;
const replay = process.argv.includes('--cached');
const sampledAt = new Date(replay ? sourceAt : Date.now());
const added = new RenfeAddedTrips(new Set(renfe.routes.keys()));
const prepared = added.prepare(renfe, tu, gps, sampledAt), updates = normalizeTripUpdates(renfe, prepared, sampledAt);
const vehicles = applyRealtime(renfe, generateScheduledVehicles(renfe, sampledAt, 'cercanias-renfe'), 'cercanias-renfe', updates, gps, sampledAt, 40);
const boards = parseMetroBoards(fs.readFileSync(path.join(directory, 'teleindicadores.txt'), 'utf8'));
const metroSourceAt = boards.length ? Math.max(...boards.map((b) => b.sourceTimestamp)) : null;
const metroAt = replay && metroSourceAt !== null ? metroSourceAt : Date.now();
const metro = loadStatic('metro'), lightRail = loadStatic('light-rail');
const topology = L3_TOPOLOGY_LAYERS.map((layer) => JSON.parse(fs.readFileSync(path.join(directory, `l3-${layer}.json`), 'utf8')) as TopologyDocument);
installMetroTopology(metro, topology[0], topology[1]); installMetroTopology(metro, topology[2], topology[3]);
const metroEstimator = new MetroEstimates(new Map([['0', 'R'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string])]));
const lightEstimator = new MetroEstimates(new Map([['51', 'ML1']]));
const metroEvents = metroEstimator.events(metro, boards, metroAt), metroVehicles = metroEstimator.vehicles(metro, boards, metroAt, 'metro-madrid');
const report = {
  inspectedAt: new Date().toISOString(), cachedReplay: replay || downloadFailures.length > 0, evaluation: replay ? 'sample-source-time' : 'wall-clock', downloadFailures,
  renfe: { sourceTimestamp: new Date(sourceAt).toISOString(), evaluatedAt: sampledAt.toISOString(), routes: renfe.routes.size, ...orientation, staticTrips: renfe.trips.size, rawGps: gps.entity?.length ?? 0, rawUpdates: tu.entity?.length ?? 0, normalizedUpdates: updates.size, acceptedGps: vehicles.filter((v) => v.observationTimestamp !== null).length, rejectedAdded: added.rejected, addedTripIds: [...renfe.trips.keys()].filter((id) => id.startsWith('SPECIAL_')), nonMadridRoutes: [...renfe.routes.keys()].filter((id) => !id.startsWith('10T')) },
  metro: { sourceTimestamp: metroSourceAt === null ? null : new Date(metroSourceAt).toISOString(), evaluatedAt: new Date(metroAt).toISOString(), boards: boards.length, mappedEvents: metroEvents.length, estimatedVehicles: metroVehicles.length, currentScheduledVehicles: generateScheduledVehicles(metro, new Date(metroAt), 'metro-madrid').length, mappedByLine: Object.fromEntries([...metro.routes].map(([id, r]) => [r.shortName, metroEvents.filter((e) => e.pattern.routeId === id).length])), vehiclesByLine: Object.fromEntries([...metro.routes].map(([id, r]) => [r.shortName, metroVehicles.filter((v) => v.routeId === id).length])), gpsVehicles: metroVehicles.filter((v) => v.observationTimestamp !== null).length },
  lightRail: { routes: [...lightRail.routes.values()].map((r) => r.shortName), events: lightEstimator.events(lightRail, boards, metroAt).length, estimatedVehicles: lightEstimator.vehicles(lightRail, boards, metroAt, 'metro-ligero-crtm').length },
};
console.log(JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(directory, 'runtime-report.json'), JSON.stringify(report, null, 2));
