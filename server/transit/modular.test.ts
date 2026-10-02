import assert from 'node:assert/strict';
import test from 'node:test';
import { entityId, parseEntityId } from '../../shared/transit/ids';
import { renderedPositionSource } from '../../shared/transit/freshness';
import { normalizeVehicle, normalizeRoute, normalizeStop, normalizeTrip } from './normalization';
import { RegisteredProvider } from './registeredProvider';
import { ProviderRegistry } from './registry';
import type { AdapterVehicle, CityManifest, ProviderDefinition, SourceAdapter } from '../../shared/transit/contracts';
import { RealtimeFeedClient } from '../providers/realtimeFeed';
import { RealtimeProvider } from '../providers/realtimeProvider';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';

export const testDefinition = (id = 'provider'): ProviderDefinition => ({ id, name: id, color: '#123456', realtime: true, capabilities: { staticGtfs: true, vehiclePositions: true, tripUpdates: true, serviceAlerts: false, occupancy: false, speed: false, bearing: false, stopArrivals: false } });
const city = { id: 'test-city', timezone: 'Europe/Madrid' };
const at = Date.parse('2026-10-02T10:00:00Z');
const raw = (overrides: Partial<AdapterVehicle> = {}): AdapterVehicle => ({ id: 'provider:20261002:external:trip', operatorId: 'provider', mode: 'bus', tripId: 'external:trip', routeId: 'r/1', shapeId: 'shape', directionId: 0, progressMetersAlongShape: 300, longitude: -2.9, latitude: 43.2, bearing: 90, positionQuality: 'live', observationTimestamp: at - 30_000, predictionTimestamp: at, receivedTimestamp: at - 1000, speedMetersPerSecond: 5, previousObservation: { at: at - 179_000, progress: 100 }, delaySeconds: 60, ...overrides });
test('entity namespaces roundtrip hostile external IDs and isolate cities, providers and kinds', () => {
  const external = 'a:b/%2F ü';
  const id = entityId('test-city', 'provider', 'vehicle', external);
  assert.deepEqual(parseEntityId(id), { cityId: 'test-city', providerId: 'provider', kind: 'vehicle', externalId: external });
  assert.notEqual(id, entityId('other-city', 'provider', 'vehicle', external));
  assert.notEqual(id, entityId('test-city', 'other-provider', 'vehicle', external));
  assert.notEqual(id, entityId('test-city', 'provider', 'trip', external));
  assert.equal(parseEntityId('test-city:provider:shape:%ZZ'), null);
  assert.equal(parseEntityId('provider:shape'), null);
});
test('normalization preserves GPS progress, history and source time while scoping all references', () => {
  const input = raw();
  const value = normalizeVehicle(input, { cityId: city.id, providerId: 'provider', timezone: city.timezone }, null, at)!;
  assert.equal(value.sourceTimestamp, at - 30_000);
  assert.equal(value.receivedTimestamp, at - 1000);
  assert.equal(value.predictionTimestamp, at);
  assert.equal(value.serviceDate, '20261002');
  assert.equal(value.positionSource, 'GPS');
  assert.equal(value.progressMetersAlongShape, input.progressMetersAlongShape);
  assert.deepEqual(value.previousObservation, input.previousObservation);
  assert.equal(parseEntityId(value.tripId)?.externalId, input.tripId);
  assert.equal(parseEntityId(value.routeId)?.externalId, input.routeId);
  assert.equal(value.externalTripId, input.tripId);
  assert.deepEqual(input, raw(), 'normalization must not mutate adapter state');
});
test('schedule, arrival forecasts, sparse GPS and stale signals never gain fake source timestamps', () => {
  const scope = { cityId: city.id, providerId: 'provider', timezone: city.timezone };
  const normalize = (v: AdapterVehicle, now = at) => normalizeVehicle(v, scope, at, now)!;
  const schedule = normalize(raw({ observationTimestamp: null, positionQuality: 'scheduled', timetableTimestamp: null }));
  assert.equal(schedule.sourceTimestamp, null); assert.equal(schedule.positionSource, 'SCHEDULE_SIMULATION');
  const forecast = normalize(raw({ observationTimestamp: null, positionQuality: 'predicted', timetableTimestamp: at - 10_000 }));
  assert.equal(forecast.sourceTimestamp, at - 10_000); assert.equal(forecast.positionSource, 'PROVIDER_ESTIMATED');
  const sparse = normalize(raw({ observationTimestamp: at - 149_000 }));
  assert.equal(sparse.positionQuality, 'predicted'); assert.equal(sparse.positionSource, 'GPS');
  assert.equal(renderedPositionSource(sparse, 'estimated', at), 'PROVIDER_ESTIMATED');
  assert.equal(renderedPositionSource(sparse, 'interpolated', at), 'INTERPOLATED_REALTIME');
  const stale = normalize(raw({ observationTimestamp: at - 181_000 }));
  assert.equal(stale.positionSource, 'STALE'); assert.equal(stale.status, 'STALE');
  assert.equal(stale.sourceTimestamp, at - 181_000); assert.equal(stale.receivedTimestamp, at - 1000);
  assert.equal(renderedPositionSource(sparse, 'real', at + 100_000), 'STALE');
});
test('invalid coordinates and foreign provider identities are omitted, optional measurements remain unknown', () => {
  const scope = { cityId: city.id, providerId: 'provider', timezone: city.timezone };
  assert.equal(normalizeVehicle(raw({ latitude: NaN }), scope, null, at), null);
  assert.equal(normalizeVehicle(raw({ longitude: 181 }), scope, null, at), null);
  assert.equal(normalizeVehicle(raw({ operatorId: 'other' }), scope, null, at), null);
  const value = normalizeVehicle(raw({ speedMetersPerSecond: undefined, receivedTimestamp: undefined }), scope, null, at)!;
  assert.equal(value.speed, null); assert.equal(value.receivedTimestamp, null); assert.equal(value.occupancy, undefined);
  assert.equal(normalizeVehicle(raw({ observationTimestamp: null, positionQuality: 'scheduled', receivedTimestamp: null }), scope, at, at)!.receivedTimestamp, null, 'an explicitly unknown static reception must not inherit a GPS feed reception');
});
test('normalized catalog references join the same route, trip, shape and stop namespaces', () => {
  const scope = { cityId: city.id, providerId: 'provider' };
  const route = normalizeRoute({ routeId: 'r', shortName: '1', longName: 'One', routeType: 1, color: '', textColor: 'FFFFFF' }, scope, testDefinition(), []);
  const trip = normalizeTrip({ tripId: 't', routeId: 'r', serviceId: 's', shapeId: 'shape', headsign: 'End', directionId: 0 }, scope);
  const stop = normalizeStop({ stopId: 's', stopCode: '', name: 'Stop', latitude: 0, longitude: 0 }, scope, ['rail']);
  assert.equal(trip.routeId, route.id); assert.equal(route.mode, 'rail'); assert.equal(route.color, '#123456');
  assert.equal(parseEntityId(stop.id)?.kind, 'stop'); assert.equal(parseEntityId(trip.serviceId)?.kind, 'service');
});
test('registered adapters isolate failure and disabling, declare capabilities and retain source/receipt times', async () => {
  const source: SourceAdapter = { operatorId: 'provider', getSnapshot: async (now = new Date()) => ({ operatorId: 'provider', fetchedAt: now.getTime(), sourceTimestamp: (at - 30_000) / 1000, receivedTimestamp: at - 1000, vehicles: [raw()], status: 'ok' }) };
  const provider = new RegisteredProvider(city, testDefinition(), source);
  const first = await provider.getSnapshot(new Date(at));
  assert.equal(first.health.state, 'healthy'); assert.equal(first.sourceTimestamp, at - 30_000);
  const repeated = await provider.getSnapshot(new Date(at + 5000));
  assert.equal(repeated.receivedTimestamp, first.receivedTimestamp); assert.equal(repeated.vehicles[0].sourceTimestamp, first.vehicles[0].sourceTimestamp);
  assert.equal(first.capabilities.occupancy, false); assert.equal(first.capabilities.vehiclePositions, true);
  assert.equal((await provider.getSnapshot(new Date(at + 181_000))).health.state, 'stale');
  provider.enabled = false;
  const disabled = await provider.getSnapshot(new Date(at));
  assert.equal(disabled.vehicles.length, 0); assert.equal(disabled.health.state, 'unavailable');
  provider.enabled = true; assert.equal((await provider.getSnapshot(new Date(at))).health.state, 'healthy');
  const broken = new RegisteredProvider(city, testDefinition('broken'), { operatorId: 'broken', getSnapshot: async () => { throw new Error('feed down'); } });
  assert.equal((await broken.getSnapshot(new Date(at))).error, 'feed down');
  assert.equal((await provider.getSnapshot(new Date(at))).vehicles.length, 1);
});
test('registry validates package version and membership, exposes health and switches one provider', async () => {
  const definition = testDefinition();
  const provider = new RegisteredProvider(city, definition, { operatorId: 'provider', getSnapshot: async () => ({ operatorId: 'provider', fetchedAt: at, sourceTimestamp: null, status: 'ok', vehicles: [] }) });
  const manifest: CityManifest = { ...city, apiVersion: 1, countryCode: 'ES', name: 'Test', region: 'Region', center: [0, 0], bounds: [[-1, -1], [1, 1]], providers: [definition], modes: ['bus'], presentation: { title: 'Test', mapLabel: 'Test', searchLabel: 'Test', initialZoom: 12, brandMark: 't.' } };
  const registry = new ProviderRegistry();
  registry.register({ manifest, providers: [provider] });
  assert.equal(registry.getCities().length, 1); assert.equal(registry.getCity(city.id)?.manifest.timezone, city.timezone);
  assert.throws(() => registry.register({ manifest, providers: [provider] }), /already registered/);
  assert.throws(() => new ProviderRegistry().register({ manifest: { ...manifest, apiVersion: 2 as 1 }, providers: [provider] }), /version/);
  assert.throws(() => new ProviderRegistry().register({ manifest, providers: [] }), /differ/);
  registry.setProviderEnabled(city.id, 'provider', false);
  await provider.getSnapshot(new Date(at));
  assert.equal(registry.getProviderHealth(city.id, 'provider')?.state, 'unavailable');
  assert.equal(registry.getProvidersForCity('unknown').length, 0);
});

test('invalid timestamps are rejected and physical vehicle IDs are scoped independently of feed IDs', async () => {
  const scope = { cityId: city.id, providerId: 'provider', timezone: city.timezone };
  for (const observationTimestamp of [NaN, Infinity, -1, 0]) assert.equal(normalizeVehicle(raw({ observationTimestamp }), scope, null, at), null);
  assert.equal(normalizeVehicle(raw({ receivedTimestamp: NaN }), scope, null, at), null);
  const vehicle = normalizeVehicle(raw({ vehicleId: '123:physical' }), scope, null, at)!;
  assert.equal(parseEntityId(vehicle.vehicleId!)?.externalId, '123:physical');
  assert.equal(vehicle.externalVehicleId, '123:physical');
  const unknown = normalizeVehicle(raw({ observationTimestamp: null }), scope, null, at)!;
  assert.equal(unknown.positionQuality, 'predicted');
  const provider = new RegisteredProvider(city, testDefinition(), { operatorId: 'provider', getSnapshot: async () => ({ operatorId: 'provider', fetchedAt: at, sourceTimestamp: NaN, status: 'ok', vehicles: [] }) });
  assert.equal((await provider.getSnapshot(new Date(at))).health.state, 'unavailable');
});

test('cached realtime source and reception times survive polling and expiration without HTTP', async () => {
  const client = new RealtimeFeedClient('fixture', 'unused:no-network');
  const sourceTimestamp = at - 30_000, receivedTimestamp = at - 10_000;
  Object.assign(client, { feed: { header: { timestamp: sourceTimestamp / 1000 } }, receivedTimestamp, expires: at + 1_000_000 });
  const first = await client.get(at), repeated = await client.get(at + 5000), stale = await client.get(at + 181_000);
  assert.ok(first.feed); assert.deepEqual(repeated, first);
  assert.equal(stale.feed, null); assert.equal(stale.sourceTimestamp, sourceTimestamp); assert.equal(stale.receivedTimestamp, receivedTimestamp);
  assert.ok(stale.error);
  Object.assign(client, { receivedTimestamp: null });
  assert.equal((await client.get(at)).receivedTimestamp, null, 'a disk fallback with unknown receipt must not invent one');
});

test('an expired realtime feed retains stale provider health while falling back to schedule', async () => {
  const now = Date.now(), client = new RealtimeFeedClient('fixture', 'unused:no-network');
  Object.assign(client, { feed: { header: { timestamp: (now - 181_000) / 1000 } }, receivedTimestamp: now - 1000, expires: now + 1_000_000 });
  const gtfs: BizkaibusGtfs = { routes: new Map(), trips: new Map(), stops: new Map(), shapes: new Map(), tripStops: new Map(), routeTripIds: new Map(), calendars: new Map(), calendarDates: new Map() };
  const base: SourceAdapter = { operatorId: 'provider', getSnapshot: async () => ({ operatorId: 'provider', fetchedAt: now, sourceTimestamp: null, receivedTimestamp: now - 3600_000, status: 'ok', vehicles: [] }) };
  const adapter = new RealtimeProvider(base, async () => gtfs, client);
  const provider = new RegisteredProvider(city, testDefinition(), adapter);
  const snapshot = await provider.getSnapshot(new Date(now));
  assert.equal(snapshot.health.state, 'stale');
  assert.equal(snapshot.sourceTimestamp, now - 181_000); assert.equal(snapshot.receivedTimestamp, now - 1000);
  assert.equal(snapshot.realtimeTripCount, 0); assert.equal(snapshot.vehicles.length, 0);
});
