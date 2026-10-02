import assert from 'node:assert/strict';
import test from 'node:test';
import { createCityNetwork } from './network';
import { RegisteredProvider } from './registeredProvider';
import { bilbaoManifest } from '../cities/es-bilbao/city.manifest';
import { bilbaoAppearance } from '../cities/es-bilbao/providers';
import { cityRegistry } from '../cities';
import { entityId, parseEntityId } from '../../shared/transit/ids';
import type { RuntimeCityPackage, ProviderRuntime } from './cityPackage';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import { generateScheduledVehicles } from './scheduled';
import { formatServiceDate } from './gtfsCalendar';
import { serviceEpoch } from './plans';
import { normalizeTripUpdates, tripInstanceKey } from './realtime';

function fixture(longitude = -2.95, routeType = 3): BizkaibusGtfs {
  return {
    routes: new Map([['route:1', { routeId: 'route:1', shortName: 'L1', longName: 'Destination', color: '', textColor: 'FFFFFF', routeType }]]),
    trips: new Map([['trip:1', { tripId: 'trip:1', routeId: 'route:1', shapeId: 'shape:1', serviceId: 'daily', headsign: 'Destination', directionId: 0 }]]),
    stops: new Map([['stop:1', { stopId: 'stop:1', stopCode: '1', name: 'Start', longitude, latitude: 43.26 }], ['stop:2', { stopId: 'stop:2', stopCode: '2', name: 'End', longitude: longitude + .02, latitude: 43.26 }]]),
    shapes: new Map([['shape:1', [{ longitude, latitude: 43.26, sequence: 1 }, { longitude: longitude + .02, latitude: 43.26, sequence: 2 }]]]),
    tripStops: new Map([['trip:1', [{ stopId: 'stop:1', sequence: 1, arrivalTime: '00:00:00', departureTime: '00:00:00' }, { stopId: 'stop:2', sequence: 2, arrivalTime: '24:00:00', departureTime: '24:00:00' }]]]),
    routeTripIds: new Map([['route:1', ['trip:1']]]), calendars: new Map([['daily', { serviceId: 'daily', weekdays: [true, true, true, true, true, true, true], startDate: '20260101', endDate: '20271231' }]]), calendarDates: new Map(),
  };
}
function memoryCity(options: { broken?: string; cityId?: string; longitude?: number } = {}) {
  const ids = ['bizkaibus', 'bilbobus', 'metro-bilbao', 'euskotren'];
  const manifest = { ...bilbaoManifest, id: options.cityId ?? bilbaoManifest.id, providers: bilbaoManifest.providers.filter((p) => ids.includes(p.id)) };
  const feeds = new Map(ids.map((id) => [id, fixture(options.longitude, id.includes('bus') ? 3 : 1)]));
  const now = Date.now();
  const providers = ids.map((id) => {
    const gtfs = feeds.get(id)!;
    const provider = new RegisteredProvider(manifest, manifest.providers.find((p) => p.id === id)!, {
      operatorId: id, getSnapshot: async () => {
        if (options.broken === id) throw new Error('fixture failure');
        const vehicle = generateScheduledVehicles(gtfs, new Date(now), id)[0];
        assert.ok(vehicle);
        const gps = id.includes('bus');
        return { operatorId: id, fetchedAt: now, sourceTimestamp: now - 30_000, receivedTimestamp: now - 1000, status: 'ok', vehicles: [{ ...vehicle, observationTimestamp: gps ? now - 30_000 : null, timetableTimestamp: gps ? null : now - 30_000, positionQuality: gps ? 'live' : 'predicted', positionSource: gps ? 'gps' : 'trip-updates' }] };
      },
    }) as ProviderRuntime;
    provider.getGtfs = async () => gtfs;
    provider.appearanceFor = (vehicle, shortName) => bilbaoAppearance(id, vehicle, shortName);
    return provider;
  });
  const city: RuntimeCityPackage = { manifest, providers, infrastructure: () => [], places: () => [] };
  return { city, network: createCityNetwork(city), now, feeds };
}
test('only Bilbao is registered, with honest source capabilities and existing styling metadata', () => {
  assert.deepEqual(cityRegistry.getCities().map((city) => city.id), ['es-bilbao']);
  assert.equal(cityRegistry.getProvidersForCity('es-bilbao').length, bilbaoManifest.providers.length);
  const capabilities = (id: string) => bilbaoManifest.providers.find((p) => p.id === id)!.capabilities;
  assert.equal(capabilities('bizkaibus').vehiclePositions, true);
  assert.equal(capabilities('bilbobus').stopArrivals, true); assert.equal(capabilities('bilbobus').tripUpdates, false);
  assert.equal(capabilities('metro-bilbao').vehiclePositions, false); assert.equal(capabilities('metro-bilbao').tripUpdates, true);
  assert.equal(capabilities('euskotren').vehiclePositions, false);
  assert.equal(capabilities('renfe').vehiclePositions, true);
  assert.equal(bilbaoAppearance('renfe', { mode: 'rail', routeId: 'x' }, 'C4').lateralOffsetMeters, 0);
  assert.deepEqual(bilbaoAppearance('renfe', { mode: 'rail', routeId: 'x' }, 'C1').composition, { count: 3, length: 23, gap: 1 });
  assert.equal(bilbaoAppearance('metro-bilbao', { mode: 'rail', routeId: 'x' }, 'L1').kind, 'metro');
});
test('city catalog, vehicles, geometry, line, stop and trip details share normalized references', async () => {
  const { network, now } = memoryCity();
  const catalog = await network.getNetwork();
  const snapshot = await network.getPresentationSnapshot();
  assert.equal(catalog.city.id, 'es-bilbao'); assert.equal(snapshot.vehicles.length, 4);
  assert.equal(new Set(catalog.routes.map((r) => r.id)).size, 4);
  assert.equal(new Set(catalog.stops.map((s) => s.id)).size, 8);
  for (const vehicle of snapshot.vehicles) {
    assert.equal(vehicle.sourceTimestamp, now - 30_000); assert.equal(vehicle.receivedTimestamp, now - 1000);
    assert.equal(vehicle.routeShortName, 'L1'); assert.equal(vehicle.destination, 'Destination');
    assert.ok(catalog.routes.some((r) => r.id === vehicle.routeId));
    assert.equal(vehicle.nextStopId, vehicle.nextStop?.key);
    const shapes = await network.getGeometries([vehicle.shapeKey]);
    assert.equal(shapes[0].key, vehicle.shapeId);
    const line = await network.getLine(vehicle.operatorId, vehicle.externalRouteId);
    assert.equal(line?.route.id, vehicle.routeId); assert.equal(line?.shapes[0].key, vehicle.shapeId);
    const trip = await network.getTrip(vehicle.operatorId, vehicle.externalTripId, vehicle.serviceDate, vehicle.id);
    assert.equal(trip?.trip.id, vehicle.tripId); assert.equal(trip?.shape?.key, vehicle.shapeId); assert.equal(trip?.vehicleId, vehicle.id);
    const stop = await network.getStop(vehicle.operatorId, 'stop:2');
    assert.ok(stop?.departures.some((d) => d.routeKey === vehicle.routeId));
    assert.equal(parseEntityId(trip!.stops[0].id)?.kind, 'stop');
  }
});
test('failed or disabled providers leave the remaining Bilbao vehicles and station services available', async () => {
  const { city, network } = memoryCity({ broken: 'bizkaibus' });
  const snapshot = await network.getPresentationSnapshot();
  assert.equal(snapshot.vehicles.length, 3);
  assert.equal(snapshot.providers.find((p) => p.providerId === 'bizkaibus')?.health.state, 'unavailable');
  const bilbobus = city.providers.find((p) => p.operatorId === 'bilbobus')!;
  bilbobus.enabled = false;
  const changed = await network.getPresentationSnapshot();
  assert.deepEqual(changed.vehicles.map((v) => v.providerId).sort(), ['euskotren', 'metro-bilbao']);
  assert.equal(changed.providers.find((p) => p.providerId === 'bilbobus')?.health.state, 'unavailable');
  const stop = await network.getStop('metro-bilbao', 'stop:2');
  assert.ok(stop?.departures.some((d) => d.operatorId === 'metro-bilbao'));
  assert.ok(stop?.departures.every((d) => d.operatorId !== 'bilbobus'));
});
test('city caches cannot mix identical external IDs and reject cross-city geometry requests', async () => {
  const one = memoryCity(), two = memoryCity({ cityId: 'fixture-scope', longitude: 1 });
  const [a, b] = await Promise.all([one.network.getPresentationSnapshot(), two.network.getPresentationSnapshot()]);
  assert.notEqual(a.vehicles[0].id, b.vehicles[0].id);
  assert.ok(a.vehicles[0].longitude < 0); assert.ok(b.vehicles[0].longitude > 0);
  assert.deepEqual(await one.network.getGeometries([b.vehicles[0].shapeKey]), []);
  assert.deepEqual(await one.network.getGeometries([entityId('es-bilbao', 'bizkaibus', 'trip', 'shape:1')]), []);
});
test('arrival hooks are provider-neutral and preserve source timestamps while warming upcoming stops', async () => {
  const { city, network, now } = memoryCity();
  const provider = city.providers.find((p) => p.operatorId === 'bilbobus')!;
  const warmed: string[] = [];
  provider.arrivals = {
    peek: (_gtfs, stopId) => stopId === 'stop:2' ? { arrival: now + 120_000, sourceTimestamp: now - 10_000 } : null,
    warm: async (_gtfs, stopIds) => { warmed.push(...stopIds); },
    departures: async () => [{ routeKey: entityId(city.manifest.id, 'bilbobus', 'route', 'route:1'), tripId: entityId(city.manifest.id, 'bilbobus', 'trip', 'siri:1'), label: 'L1', headsign: 'Destination', operatorId: 'bilbobus', at: now + 120_000, updatedAt: now - 10_000, quality: 'predicted', source: 'realtime', delaySeconds: null }],
  };
  const snapshot = await network.getPresentationSnapshot();
  const vehicle = snapshot.vehicles.find((v) => v.providerId === 'bilbobus')!;
  vehicle.externalVehicleId = 'bus-1';
  assert.equal(vehicle.nextStop?.at, now + 120_000); assert.equal(vehicle.sourceTimestamp, now - 30_000);
  const trip = await network.getTrip('bilbobus', vehicle.externalTripId, vehicle.serviceDate, vehicle.id);
  assert.equal(trip?.stops.at(-1)?.at, now + 120_000); assert.ok(warmed.includes('stop:2'));
  const stop = await network.getStop('bilbobus', 'stop:2');
  assert.ok(stop?.departures.some((d) => d.source === 'realtime' && d.updatedAt === now - 10_000));
});
test('service epochs and realtime delays use an explicit timezone, including non-hour offsets', () => {
  const date = '20261002';
  assert.equal(serviceEpoch(date, 0, 'UTC') - serviceEpoch(date, 0, 'Asia/Kathmandu'), 5.75 * 3600_000);
  assert.equal(serviceEpoch(date, 0, 'UTC') - serviceEpoch(date, 0, 'Europe/Madrid'), 2 * 3600_000);
  const gtfs = fixture();
  const now = new Date('2026-10-02T10:00:00Z');
  const updates = normalizeTripUpdates(gtfs, { header: { timestamp: now.getTime() / 1000 }, entity: [{ tripUpdate: { trip: { tripId: 'trip:1', startDate: date }, delay: 60, stopTimeUpdate: [{ stopId: 'stop:1', stopSequence: 1, departure: { delay: 60 } }] } }] }, now, 'UTC');
  assert.equal(updates.get(tripInstanceKey(date, 'trip:1'))?.stops.get(1)?.scheduledDeparture, serviceEpoch(date, 0, 'UTC'));
  assert.equal(formatServiceDate(new Date('2026-10-02T23:00:00Z'), 'Asia/Kathmandu').date, '20261003');
});
