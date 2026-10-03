import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BizkaibusGtfs } from '../bizkaibus/gtfs';
import { orientTripShapes } from '../../transit/shapeOrientation';
import { tripPlan } from '../../transit/plans';
import { RenfeAddedTrips } from './renfeAddedTrips';
import { normalizeTripUpdates, type RealtimeMessage } from '../../transit/realtime';
import { applyRealtime } from '../../transit/applyRealtime';
import { generateScheduledVehicles } from '../../transit/scheduled';
import { parseMetroBoards, MetroFeedClient, type MetroBoard } from './metroFeed';
import { MetroEstimates } from './metroEstimates';
import { MetroArrivalProvider } from './metroProvider';
import { installMetroTopology, type TopologyDocument } from './metroTopology';
import { emtTimestamp, parseEmtArrivals, EmtClient, EmtArrivalProvider } from './emt';
import { normalizeVehicle } from '../../transit/normalization';
import { createCityNetwork } from '../../transit/network';
import { RegisteredProvider } from '../../transit/registeredProvider';
import type { ProviderRuntime, RuntimeCityPackage } from '../../transit/cityPackage';
import type { CityManifest } from '../../../shared/transit/contracts';
import { madridExtensions } from '../../cities/es-madrid';
import { createFolderCity } from '../../cities/folderPackage';
import { parseCityPackage } from '../../cities/packageConfig';

const at = Date.parse('2026-10-03T10:00:00Z');
function fixture(): BizkaibusGtfs {
  const ids = ['a', 'b', 'c', 'd'];
  return {
    routes: new Map([['10T1', { routeId: '10T1', shortName: '1', longName: 'A - D', routeType: 1, color: '0000FF', textColor: 'FFFFFF' }]]),
    trips: new Map([['forward', { tripId: 'forward', routeId: '10T1', serviceId: 'expired', shapeId: 'forward', directionId: 0, headsign: 'D' }]]),
    stops: new Map(ids.map((id, i) => [id, { stopId: id, stopCode: String(i + 1), name: id.toUpperCase(), latitude: 40.4, longitude: -3.7 + i * .01 }])),
    shapes: new Map([['forward', ids.map((_, i) => ({ sequence: i, latitude: 40.4, longitude: -3.7 + i * .01 }))]]),
    tripStops: new Map([['forward', ids.map((id, i) => ({ stopId: id, sequence: i + 1, arrivalTime: `12:0${i * 2}:00`, departureTime: `12:0${i * 2}:00` }))]]),
    routeTripIds: new Map([['10T1', ['forward']]]), calendars: new Map([['expired', { serviceId: 'expired', weekdays: [true, true, true, true, true, true, true], startDate: '20250101', endDate: '20250501' }]]), calendarDates: new Map(),
  };
}
const boards = (source = at, shift = 0): MetroBoard[] => ['b', 'c'].map((id, i) => ({ line: '1', station: id.toUpperCase(), stationId: id, platform: '2', destination: 'D', sourceTimestamp: source, recordTimestamp: source + 2000, arrivals: [at + 60_000 + i * 120_000 + shift] }));
function addedFeed(now = at): RealtimeMessage {
  return { header: { timestamp: now / 1000 }, entity: [{ tripUpdate: { trip: { tripId: 'SPECIAL_10_test', routeId: '10T1', scheduleRelationship: 'ADDED' }, stopTimeUpdate: ['a', 'b', 'c', 'd'].map((stopId, i) => ({ stopId, stopSequence: i + 1, arrival: { time: (at - 60_000 + i * 120_000) / 1000 }, departure: { time: (at - 40_000 + i * 120_000) / 1000 } })) } }] };
}
const gpsFeed = (now = at): RealtimeMessage => ({ header: { timestamp: now / 1000 }, entity: [{ vehicle: { trip: { tripId: 'SPECIAL_10_test' }, vehicle: { id: 'physical-7' }, timestamp: now / 1000, position: { latitude: 40.4, longitude: -3.695 }, currentStatus: 'IN_TRANSIT_TO', stopId: 'b' } }] });

test('orientation copies shared reverse shapes per trip, supports partial journeys and is idempotent', () => {
  const g = fixture(), original = JSON.stringify(g.shapes.get('forward'));
  g.trips.set('reverse', { ...g.trips.get('forward')!, tripId: 'reverse', directionId: null });
  g.tripStops.set('reverse', [...g.tripStops.get('forward')!].reverse().map((s, i) => ({ ...s, sequence: i + 1, arrivalTime: `12:0${i}:00`, departureTime: `12:0${i}:00` })));
  g.trips.set('partial', { ...g.trips.get('forward')!, tripId: 'partial' });
  g.tripStops.set('partial', g.tripStops.get('reverse')!.slice(1, 3));
  assert.equal(orientTripShapes(g).reversedTrips, 2);
  assert.equal(JSON.stringify(g.shapes.get('forward')), original);
  for (const id of ['forward', 'reverse', 'partial']) { const plan = tripPlan(g, id)!; assert.ok(plan.stops.at(-1)!.progress > plan.stops[0].progress); }
  assert.equal(orientTripShapes(g).derivedShapes, 1);
});
test('official ADDED station times enable its service without extending expired static calendars; GPS wins', () => {
  const g = fixture(), raw = addedFeed(), saved = JSON.stringify(raw), adapter = new RenfeAddedTrips(new Set(['10T1']));
  const prepared = adapter.prepare(g, raw, gpsFeed(), new Date(at));
  assert.equal(JSON.stringify(raw), saved);
  const updates = normalizeTripUpdates(g, prepared, new Date(at));
  assert.equal(updates.size, 1); assert.equal(adapter.rejected, 0);
  const vehicles = applyRealtime(g, generateScheduledVehicles(g, new Date(at), 'renfe'), 'renfe', updates, gpsFeed(), new Date(at), 40);
  assert.equal(vehicles.length, 1); assert.equal(vehicles[0].vehicleId, 'physical-7'); assert.equal(vehicles[0].observationTimestamp, at);
  assert.equal(vehicles[0].positionSource, 'gps'); assert.equal(g.calendars.get('expired')!.endDate, '20250501');
  assert.equal(vehicles[0].timetableTimestamp, at);
});
test('Renfe joins a live variant to verified station geometry of the same line, preserving its official route', () => {
  const g = fixture(); g.routes.set('10T2', { ...g.routes.get('10T1')!, routeId: '10T2' }); g.routeTripIds.set('10T2', []);
  const feed = addedFeed(); feed.entity![0].tripUpdate!.trip.routeId = '10T2';
  new RenfeAddedTrips(new Set(['10T1', '10T2'])).prepare(g, feed, null, new Date(at));
  assert.equal(g.trips.get('SPECIAL_10_test')!.routeId, '10T2'); assert.equal(g.trips.get('SPECIAL_10_test')!.shapeId, 'forward');
});
test('Renfe rejects other nuclei, wrong stop order and impossible times; expired dynamic journeys lose their plan', () => {
  for (const change of [(f: RealtimeMessage) => { f.entity![0].tripUpdate!.trip.routeId = '60T1'; }, (f: RealtimeMessage) => { f.entity![0].tripUpdate!.stopTimeUpdate![1].stopId = 'd'; }, (f: RealtimeMessage) => { f.entity![0].tripUpdate!.stopTimeUpdate![1].arrival!.time = 1; }]) {
    const g = fixture(), feed = addedFeed(); change(feed); const adapter = new RenfeAddedTrips(new Set(['10T1'])); adapter.prepare(g, feed, null, new Date(at)); assert.equal(adapter.rejected, 1); assert.equal(g.trips.has('SPECIAL_10_test'), false);
  }
  const g = fixture(), adapter = new RenfeAddedTrips(new Set(['10T1'])); adapter.prepare(g, addedFeed(), null, new Date(at)); assert.ok(tripPlan(g, 'SPECIAL_10_test'));
  adapter.prepare(g, null, null, new Date(at + 181_000)); assert.equal(g.trips.has('SPECIAL_10_test'), false); assert.equal(tripPlan(g, 'SPECIAL_10_test'), null); assert.equal(g.calendarDates.size, 0);
});
test('fresh GPS retains an already verified ADDED mapping while timetable ages; receipt never revives it', () => {
  const g = fixture(), adapter = new RenfeAddedTrips(new Set(['10T1'])); adapter.prepare(g, addedFeed(), null, new Date(at));
  adapter.prepare(g, addedFeed(), gpsFeed(at + 170_000), new Date(at + 190_000)); assert.ok(g.trips.has('SPECIAL_10_test'));
  adapter.prepare(g, addedFeed(), gpsFeed(), new Date(at + 351_000)); assert.equal(g.trips.has('SPECIAL_10_test'), false);
});
test('two fresh full datasets removing an ADDED journey cannot leave a simulated ghost', () => {
  const g = fixture(), adapter = new RenfeAddedTrips(new Set(['10T1'])); adapter.prepare(g, addedFeed(), gpsFeed(), new Date(at));
  assert.ok(g.trips.has('SPECIAL_10_test'));
  const empty = { header: { timestamp: (at + 30_000) / 1000 }, entity: [] };
  adapter.prepare(g, empty, empty, new Date(at + 30_000)); assert.equal(g.trips.has('SPECIAL_10_test'), false); assert.equal(g.calendarDates.size, 0);
});
const xml = (minutes = '2') => `<VtelindicadoresCollection><Vtelindicadores><linea>1</linea><nombreest>B</nombreest><sentido>D</sentido><anden>2</anden><proximo>${minutes}</proximo><siguiente></siguiente><FECHAHORAEMISIONPREVISION>2026-10-03T12:00:00.000+02:00</FECHAHORAEMISIONPREVISION><FECHAHORAREGISTRO>2026-10-03T12:00:10.000+02:00</FECHAHORAREGISTRO></Vtelindicadores></VtelindicadoresCollection>`;
test('Metro parses official XML minutes and source offset, independently of record and receipt; blanks are unknown', () => {
  const b = parseMetroBoards(xml())[0]; assert.equal(b.sourceTimestamp, at); assert.equal(b.recordTimestamp, at + 10_000); assert.deepEqual(b.arrivals, [at + 120_000]);
  assert.deepEqual(parseMetroBoards(xml(''))[0].arrivals, []); assert.deepEqual(parseMetroBoards(xml('-1'))[0].arrivals, []);
  assert.throws(() => parseMetroBoards('<html>Request Rejected</html>'));
  assert.equal(parseMetroBoards(xml().replace('+02:00', '')) .length, 0);
});
test('Metro needs corroborated adjacent station ETAs, not one icon per board; synthetic IDs persist without fake GPS', () => {
  const g = fixture(), estimator = new MetroEstimates(new Map([['1', '1']]));
  assert.equal(estimator.vehicles(g, boards().slice(0, 1), at, 'metro').length, 0);
  const one = estimator.vehicles(g, [...boards(), ...boards()], at, 'metro'); assert.equal(one.length, 1);
  const two = estimator.vehicles(g, boards(at + 30_000, 5000), at + 30_000, 'metro'); assert.equal(two[0].id, one[0].id);
  assert.equal(two[0].observationTimestamp, null); assert.equal(two[0].tripIdentityQuality, 'estimated'); assert.equal(two[0].timetableTimestamp, at + 30_000);
  const normalized = normalizeVehicle(two[0], { cityId: 'es-test', providerId: 'metro', timezone: 'Europe/Madrid' }, at + 31_000, at + 30_000)!;
  assert.equal(normalized.positionSource, 'PROVIDER_ESTIMATED'); assert.equal(normalized.sourceTimestamp, at + 30_000); assert.notEqual(normalized.id, normalized.tripId);
});
test('Metro dwell anchors stop at a station, speeds stay bounded and stale/ambiguous forecasts produce no fake service', () => {
  const g = fixture(), estimator = new MetroEstimates(new Map([['1', '1']]));
  const v = estimator.vehicles(g, boards(), at + 65_000, 'metro')[0]; assert.ok(v);
  const b = tripPlan(g, 'forward')!.stops[1].progress; assert.equal(v.progressMetersAlongShape, b);
  const anchors = v.motionTimeline!; for (let i = 1; i < anchors.length; i++) if (anchors[i].at > anchors[i - 1].at) assert.ok((anchors[i].progress - anchors[i - 1].progress) / ((anchors[i].at - anchors[i - 1].at) / 1000) <= 30);
  assert.equal(estimator.vehicles(g, boards(), at + 181_000, 'metro').length, 0);
  assert.equal(estimator.vehicles(g, boards().map((b) => ({ ...b, destination: 'unknown' })), at, 'metro').length, 0);
  assert.equal(generateScheduledVehicles(g, new Date(at), 'metro').length, 0);
});
test('native topology install uses official IDs, order and geometry but cannot activate a scheduled service', () => {
  const g = fixture(), stations: TopologyDocument = { features: ['a', 'b', 'c'].map((code, i) => ({ attributes: { CODIGOESTACION: code, DENOMINACION: code.toUpperCase() }, geometry: { x: -3.7 + .01 * i, y: 40.4 } })) };
  const segments: TopologyDocument = { features: ['b', 'c'].map((code, i) => ({ attributes: { CODIGOESTACION: code, NUMEROORDEN: i + 2, SENTIDO: '1', IDFLINEA: '10T1' }, geometry: { paths: [[[-3.7 + .01 * i, 40.4], [-3.695 + .01 * i, 40.401], [-3.69 + .01 * i, 40.4]]] } })) };
  installMetroTopology(g, stations, segments); const plan = tripPlan(g, 'topology:10T1:1')!; assert.equal(plan.metric.coordinates.length, 5); assert.equal(plan.stops.length, 3);
  assert.equal(generateScheduledVehicles(g, new Date(at), 'metro').length, 0);
  const broken = structuredClone(segments); (broken.features[1] as any).attributes.NUMEROORDEN = 5;
  assert.throws(() => installMetroTopology(fixture(), stations, broken));
  assert.throws(() => installMetroTopology(fixture(), { ...stations, exceededTransferLimit: true }, segments));
});
test('Metro native snapshot ignores expired timetables and ML fallbacks cannot duplicate a covered line', async () => {
  const g = fixture(), client = { get: () => ({ boards: boards(), receivedTimestamp: at + 1000 }) } as unknown as MetroFeedClient;
  const baseVehicle = generateScheduledVehicles({ ...g, calendarDates: new Map([['expired', new Map([['20261003', 1]])]]) }, new Date(at + 60_000), 'light')[0];
  const base = { operatorId: 'light', getSnapshot: async () => ({ operatorId: 'light', fetchedAt: at, sourceTimestamp: null, vehicles: [baseVehicle], status: 'ok' as const }) };
  const provider = new MetroArrivalProvider('light', async () => g, client, new Map([['1', '1']]), 'es-test', base);
  const snapshot = await provider.getSnapshot(new Date(at)); assert.equal(snapshot.vehicles.length, 1); assert.equal(snapshot.vehicles[0].positionQuality, 'predicted'); assert.equal(snapshot.realtimeArrivalCount, 2);
  const metro = new MetroArrivalProvider('metro', async () => g, { get: () => ({ boards: [], receivedTimestamp: null, error: 'network failure' }) } as unknown as MetroFeedClient, new Map([['1', '1']]), 'es-test');
  assert.equal((await metro.getSnapshot(new Date(at))).vehicles.length, 0); assert.equal((await metro.getSnapshot(new Date(at))).status, 'degraded');
});
test('Metro disk cache restores immediately; rejected HTML cannot replace or rejuvenate original source data', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-metro-')), file = path.join(directory, 'boards.xml'); fs.writeFileSync(file, xml());
  let done!: () => void; const finished = new Promise<void>((r) => { done = r; }); let requests = 0;
  const client = new MetroFeedClient(file, async (_url, destination) => { requests++; fs.writeFileSync(destination, '<html>Rejected</html>'); done(); return 20; });
  const restored = client.get(); assert.equal(restored.boards[0].sourceTimestamp, at); assert.equal(restored.receivedTimestamp, null); client.get();
  await finished; await new Promise((r) => setImmediate(r)); assert.equal(requests, 1); assert.equal(fs.readFileSync(file, 'utf8'), xml()); assert.ok(client.get().error); assert.equal(client.get().boards[0].sourceTimestamp, at);
  // Only this freshly created test directory is removed.
  fs.rmSync(directory, { recursive: true, force: true });
});
test('EMT datetime respects Madrid summer/winter/DST and never replaces an absent generation time with receipt', () => {
  assert.equal(emtTimestamp('2026-10-03T12:00:00.125', at), at + 125);
  assert.equal(emtTimestamp('2026-01-03T12:00:00', at), Date.parse('2026-01-03T11:00:00Z'));
  assert.equal(emtTimestamp('2026-03-29T02:30:00', at), null); assert.equal(emtTimestamp('', at), null);
  assert.equal(emtTimestamp('2026-10-25T02:30:00', Date.parse('2026-10-25T01:40:00Z')), Date.parse('2026-10-25T01:30:00Z'));
  const sample = { code: '00', datetime: '2026-10-03T12:00:00', data: [{ Arrive: [{ line: '1', stop: '62', bus: '7', destination: 'D', estimateArrive: 120 }, { line: '1', stop: '62', bus: '8', estimateArrive: 999999 }] }] };
  assert.equal(parseEmtArrivals(sample, '62', at)[0].at, at + 120_000); assert.equal(parseEmtArrivals(sample, '62', at).length, 1);
  assert.deepEqual(parseEmtArrivals({ ...sample, datetime: undefined }, '62', at), []);
  assert.deepEqual(parseEmtArrivals(sample, '62', at + 181_000), []); assert.throws(() => parseEmtArrivals({ code: '80' }, '62', at));
});
test('EMT credentials remain server-side; token and concurrent selected-stop calls are cached and errors isolated', async () => {
  let clock = at, logins = 0, arrivals = 0, fail = false;
  const request: typeof fetch = async (url, init) => {
    if (String(url).includes('/login/')) { logins++; assert.equal((init!.headers as any)['X-ClientId'], 'test-client'); return new Response(JSON.stringify({ code: '00', data: [{ accessToken: 'test-token', tokenSecExpiration: 300 }] })); }
    arrivals++; assert.equal((init!.headers as any).accessToken, 'test-token'); assert.equal(init!.method, 'POST');
    if (fail) return new Response('denied', { status: 401 });
    return new Response(JSON.stringify({ code: '00', datetime: '2026-10-03T12:00:00', data: [{ Arrive: [{ line: '1', stop: '62', bus: '7', estimateArrive: 120 }] }] }));
  };
  const client = new EmtClient({ clientId: 'test-client', passKey: 'test-pass' }, request, () => clock);
  const [a, b] = await Promise.all([client.get('62'), client.get('62')]); assert.deepEqual(a, b); assert.equal(logins, 1); assert.equal(arrivals, 1);
  await client.get('62'); assert.equal(arrivals, 1); assert.equal(client.latestSource(), at);
  fail = true; clock += 31_000; const retained = await client.get('62'); assert.equal(retained[0].sourceTimestamp, at); assert.ok(client.error); assert.ok(!client.error.includes('test-token'));
  clock += 181_000; assert.equal(client.latestSource(), null); assert.deepEqual(client.peek('62'), []);
  const noCredentials = new EmtClient(undefined, async () => { throw new Error('must not fetch'); }); assert.deepEqual(await noCredentials.get('62'), []);
});
test('EMT arrivals hook scopes bus IDs and only claims forecasts; the fleet remains schedule fallback', async () => {
  const client = new EmtClient({ clientId: 'x', passKey: 'y' }, async (url) => new Response(JSON.stringify(String(url).includes('/login/') ? { code: '00', data: [{ accessToken: 'token', tokenSecExpiration: 300 }] } : { code: '00', datetime: '2026-10-03T12:00:00', data: [{ Arrive: [{ line: '1', stop: '2', bus: '7', destination: 'D', estimateArrive: 60 }] }] })), () => at);
  const g = fixture(), provider = new EmtArrivalProvider('emt', { operatorId: 'emt', getSnapshot: async () => ({ operatorId: 'emt', fetchedAt: at, sourceTimestamp: null, vehicles: [], status: 'ok' }) }, client, 'es-test');
  const rows = await provider.arrivals.departures(g, 'b'); assert.equal(rows[0].source, 'realtime'); assert.equal(rows[0].updatedAt, at); assert.equal(rows[0].vehicleId, 'es-test:emt:vehicle:7');
  assert.equal(provider.arrivals.peek(g, 'b', null), null); assert.equal((await provider.getSnapshot(new Date(at))).vehicles.length, 0);
});
test('Madrid extensions remain code-owned; topology capabilities are honest and other data-only cities are unchanged', () => {
  const config = parseCityPackage(JSON.parse(fs.readFileSync('city-packages/es-madrid/city.json', 'utf8')));
  const extensions = madridExtensions(config);
  const city = createFolderCity(config, extensions);
  assert.equal(extensions.get('metro-madrid')!.filterActiveServices, false);
  assert.equal(city.manifest.providers.find((p) => p.id === 'metro-madrid')!.capabilities.scheduledService, false);
  assert.equal(city.manifest.providers.find((p) => p.id === 'metro-madrid')!.capabilities.vehiclePositions, false);
  assert.equal(city.manifest.providers.find((p) => p.id === 'cercanias-renfe')!.capabilities.vehiclePositions, true);
  assert.equal(createFolderCity({ ...config, id: 'es-fixture' }).manifest.providers.find((p) => p.id === 'metro-madrid')!.capabilities.stopArrivals, false);
});
test('native timeline reaches generic trip/stop detail without invented static times or loss of namespaced identity', async () => {
  const now = Date.now(), g = fixture(), source = now - 1000, estimator = new MetroEstimates(new Map([['1', '1']]));
  const feed = boards(source, now - at), vehicles = estimator.vehicles(g, feed, now, 'metro'); assert.equal(vehicles.length, 1);
  const manifest: CityManifest = { id: 'es-test', countryCode: 'ES', name: 'Test', region: 'Test', timezone: 'Europe/Madrid', center: [-3.7, 40.4], bounds: [[-4, 40], [-3, 41]], modes: ['rail'], apiVersion: 1, presentation: { title: 'Transit', brandMark: 't', mapLabel: 'Map', searchLabel: 'Search', initialZoom: 12 }, providers: [{ id: 'metro', name: 'Metro', color: '#0000FF', realtime: true, capabilities: { staticGtfs: true, vehiclePositions: false, tripUpdates: false, stopArrivals: true, serviceAlerts: false, bearing: false, speed: false, occupancy: false, scheduledService: false } }] };
  const native = new MetroArrivalProvider('metro', async () => g, { get: () => ({ boards: feed, receivedTimestamp: now }) } as unknown as MetroFeedClient, new Map([['1', '1']]), 'es-test');
  const runtime = new RegisteredProvider(manifest, manifest.providers[0], native) as ProviderRuntime; runtime.getGtfs = async () => g; runtime.arrivals = native.arrivals;
  const city: RuntimeCityPackage = { manifest, providers: [runtime], places: () => [], infrastructure: () => [] }, network = createCityNetwork(city);
  const snapshot = await network.getPresentationSnapshot(), vehicle = snapshot.vehicles[0]; assert.ok(vehicle); assert.equal(vehicle.sourceTimestamp, source); assert.equal(vehicle.observationTimestamp, null);
  const detail = await network.getTrip('metro', 'forward', vehicle.serviceDate, vehicle.id); assert.equal(detail!.vehicleId, vehicle.id); assert.equal(detail!.stops.at(-1)!.at, null); assert.equal(detail!.stops[1].at, now + 60_000);
  assert.equal(detail!.stops[0].at, null); assert.equal(detail!.stops[0].realtime, false); // Inferred approach is not an official station ETA.
  const stop = await network.getStop('metro', 'b'); assert.equal(stop!.departures[0].source, 'realtime'); assert.equal(stop!.departures[0].updatedAt, source);
});
test('ADDED trips expose live station departures even when they appear after the static catalogue index', async () => {
  const now = Date.now(), g = fixture(), config = parseCityPackage(JSON.parse(fs.readFileSync('city-packages/es-madrid/city.json', 'utf8')));
  const city = createFolderCity(config, madridExtensions(config));
  const manifest = { ...city.manifest, id: 'es-added-test', providers: [{ ...city.manifest.providers.find((p) => p.id === 'cercanias-renfe')!, id: 'renfe' }] };
  const adapter = new RenfeAddedTrips(new Set(['10T1'])); let updates = new Map();
  const runtime = new RegisteredProvider(manifest, manifest.providers[0], { operatorId: 'renfe', getSnapshot: async () => {
    const feed = addedFeed(now); feed.entity![0].tripUpdate!.stopTimeUpdate!.forEach((s, i) => { s.arrival!.time = (now - 60_000 + i * 120_000) / 1000; s.departure!.time = (now - 40_000 + i * 120_000) / 1000; });
    const prepared = adapter.prepare(g, feed, null, new Date(now)); updates = normalizeTripUpdates(g, prepared, new Date(now));
    return { operatorId: 'renfe', sourceTimestamp: now, fetchedAt: now, status: 'ok', vehicles: applyRealtime(g, generateScheduledVehicles(g, new Date(now), 'renfe'), 'renfe', updates, null, new Date(now)) };
  } }) as ProviderRuntime;
  runtime.getGtfs = async () => g; runtime.getUpdates = () => updates;
  const network = createCityNetwork({ manifest, providers: [runtime], places: () => [], infrastructure: () => [] });
  await network.getNetwork(); assert.equal(g.trips.has('SPECIAL_10_test'), false);
  const stop = await network.getStop('renfe', 'b'); const added = stop!.departures.find((d) => d.tripId.endsWith(':SPECIAL_10_test'));
  assert.ok(added); assert.equal(added.source, 'realtime'); assert.equal(added.updatedAt, now); assert.equal(added.at, now + 80_000);
});
test('ADDED service dates preserve midnight/extended-hour calls rather than shifting official events', () => {
  const g = fixture(), midnight = Date.parse('2026-10-03T22:00:00Z'), feed = addedFeed(midnight);
  feed.entity![0].tripUpdate!.stopTimeUpdate!.forEach((s, i) => { s.arrival!.time = (midnight - 10_000 + i * 120_000) / 1000; s.departure!.time = (midnight + 10_000 + i * 120_000) / 1000; });
  const prepared = new RenfeAddedTrips(new Set(['10T1'])).prepare(g, feed, null, new Date(midnight));
  assert.equal(prepared!.entity![0].tripUpdate!.trip.startDate, '20261003');
  const update = [...normalizeTripUpdates(g, prepared, new Date(midnight)).values()][0]; assert.equal(update.stops.get(1)!.departure, midnight + 10_000);
});
test('normalization rejects invalid, backwards or unbounded native anchors', () => {
  const g = fixture(), v = new MetroEstimates(new Map([['1', '1']])).vehicles(g, boards(), at, 'metro')[0];
  const scope = { cityId: 'es-test', providerId: 'metro', timezone: 'Europe/Madrid' };
  for (const motionTimeline of [[{ at: NaN, progress: 0 }, { at, progress: 1 }], [{ at, progress: 20 }, { at: at + 1, progress: 10 }], Array.from({ length: 501 }, (_, i) => ({ at: at + i, progress: i }))]) assert.equal(normalizeVehicle({ ...v, motionTimeline }, scope, at, at), null);
});
