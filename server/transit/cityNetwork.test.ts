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
function memoryCity(options: { broken?: string; cityId?: string; longitude?: number; withoutGps?: string } = {}) {
  const ids = ['bizkaibus', 'bilbobus', 'metro-bilbao', 'euskotren'];
  const manifest = { ...bilbaoManifest, id: options.cityId ?? bilbaoManifest.id, providers: bilbaoManifest.providers.filter((p) => ids.includes(p.id)) };
  const now = Date.now();
  // Keep the final call near the test clock. A fixed 24:00 call is outside the
  // API's departures window when these tests run shortly after midnight.
  const date = formatServiceDate(new Date(now), manifest.timezone).date;
  const finalSeconds = Math.floor((now - serviceEpoch(date, 0, manifest.timezone)) / 1000) + 600;
  const finalTime = `${String(Math.floor(finalSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(finalSeconds % 3600 / 60)).padStart(2, '0')}:${String(finalSeconds % 60).padStart(2, '0')}`;
  const feeds = new Map(ids.map((id) => {
    const gtfs = fixture(options.longitude, id.includes('bus') ? 3 : 1);
    const last = gtfs.tripStops.get('trip:1')!.at(-1)!;
    last.arrivalTime = finalTime; last.departureTime = finalTime;
    return [id, gtfs] as const;
  }));
  const providers = ids.map((id) => {
    const gtfs = feeds.get(id)!;
    const provider = new RegisteredProvider(manifest, manifest.providers.find((p) => p.id === id)!, {
      operatorId: id, getSnapshot: async () => {
        if (options.broken === id) throw new Error('fixture failure');
        const vehicle = generateScheduledVehicles(gtfs, new Date(now), id)[0];
        assert.ok(vehicle);
        const bus = id.includes('bus'), gps = bus && options.withoutGps !== id;
        return { operatorId: id, fetchedAt: now, sourceTimestamp: now - 30_000, receivedTimestamp: now - 1000, status: 'ok', vehicles: [{ ...vehicle, vehicleId: bus ? `${id}-vehicle` : null, observationTimestamp: gps ? now - 30_000 : null, timetableTimestamp: gps ? null : now - 30_000, positionQuality: gps ? 'live' : 'predicted', positionSource: gps ? 'gps' : 'trip-updates' }] };
      },
    }) as ProviderRuntime;
    provider.getGtfs = async () => gtfs;
    provider.appearanceFor = (vehicle, shortName) => bilbaoAppearance(id, vehicle, shortName);
    return provider;
  });
  const city: RuntimeCityPackage = { manifest, providers, infrastructure: () => [], places: () => [] };
  return { city, network: createCityNetwork(city), now, feeds };
}
test('built-in Bilbao remains registered with honest capabilities and existing styling when folders are added', () => {
  assert.ok(cityRegistry.getCities().some((city) => city.id === 'es-bilbao'));
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
test('vehicles carry their fleet livery and real consist, not the line colour', () => {
  const look = (id: string, mode: 'rail' | 'tram' | 'bus', line: string) => bilbaoAppearance(id, { mode, routeId: 'x' }, line);
  assert.deepEqual(look('metro-bilbao', 'rail', 'MB').composition.count, 4);
  assert.equal(look('metro-bilbao', 'rail', 'MB').livery?.body, '#c8cfd3');
  assert.equal(look('euskotren', 'rail', 'L3').composition.count, 3, 'L3 runs 950 series, three cars');
  assert.equal(look('euskotren', 'rail', 'E1').composition.count, 4, 'the 900 series has four');
  assert.equal(look('euskotren', 'tram', 'TG1').composition.count, 5, 'Vitoria trams, five modules');
  assert.equal(look('euskotren', 'tram', 'TR').composition.count, 3, 'Bilbao trams, three modules');
  assert.equal(look('euskotren', 'tram', 'TR').livery?.body, look('euskotren', 'rail', 'E1').livery?.body, 'Euskotren is blue on every mode');
  assert.deepEqual(look('renfe', 'rail', 'C1').livery, { body: '#f2f3f4', accent: '#cf102d' });
  assert.equal(look('la-union', 'bus', '3714').livery, undefined, 'no confirmed livery: the line colour stays');
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
test('a physical vehicle assigned to a future public trip stays hidden until its first departure', async () => {
  const now = Date.now();
  const timezone = 'UTC';
  const date = formatServiceDate(new Date(now), timezone).date;
  const serviceSecond = Math.floor((now - serviceEpoch(date, 0, timezone)) / 1000);
  const gtfsTime = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const gtfs = fixture();
  const stops = gtfs.tripStops.get('trip:1')!;
  stops[0].arrivalTime = stops[0].departureTime = gtfsTime(serviceSecond + 1200);
  stops[1].arrivalTime = stops[1].departureTime = gtfsTime(serviceSecond + 3600);
  const definition = bilbaoManifest.providers.find((entry) => entry.id === 'bizkaibus')!;
  const manifest = { ...bilbaoManifest, id: 'future-trip-fixture', timezone, providers: [definition] };
  const vehicle = generateScheduledVehicles(gtfs, new Date(now + 1800_000), definition.id, timezone)[0];
  assert.ok(vehicle, 'fixture vehicle should be active later in the same trip');
  const provider = new RegisteredProvider(manifest, definition, {
    operatorId: definition.id,
    getSnapshot: async () => ({
      operatorId: definition.id, fetchedAt: now, sourceTimestamp: now - 10_000, receivedTimestamp: now,
      status: 'ok', vehicles: [{ ...vehicle, observationTimestamp: now - 10_000, predictionTimestamp: now, positionQuality: 'live', positionSource: 'gps' }],
    }),
  }) as ProviderRuntime;
  provider.getGtfs = async () => gtfs;
  const city: RuntimeCityPackage = { manifest, providers: [provider], infrastructure: () => [], places: () => [] };
  const snapshot = await createCityNetwork(city).getPresentationSnapshot();
  assert.equal(snapshot.vehicles.length, 0);
  assert.equal(snapshot.providers[0].health.state, 'healthy');
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
    peek: (_gtfs, stopId) => stopId === 'stop:2' ? { arrival: now + 120_000, departure: now + 130_000, sourceTimestamp: now - 10_000 } : null,
    warm: async (_gtfs, stopIds) => { warmed.push(...stopIds); },
    departures: async () => [{ routeKey: entityId(city.manifest.id, 'bilbobus', 'route', 'route:1'), tripId: entityId(city.manifest.id, 'bilbobus', 'trip', 'siri:1'), label: 'L1', headsign: 'Destination', operatorId: 'bilbobus', at: now + 120_000, updatedAt: now - 10_000, quality: 'predicted', source: 'realtime', delaySeconds: null }],
  };
  const snapshot = await network.getPresentationSnapshot();
  const vehicle = snapshot.vehicles.find((v) => v.providerId === 'bilbobus')!;
  assert.equal(vehicle.nextStop?.at, now + 120_000); assert.equal(vehicle.sourceTimestamp, now - 30_000);
  assert.equal(vehicle.timetableTimestamp, now - 10_000); assert.equal(vehicle.gpsAnchoredTimeline, false);
  assert.ok(vehicle.timeline.some((anchor) => anchor.at === now + 120_000));
  assert.ok(vehicle.timeline.some((anchor) => anchor.at === now + 130_000));
  assert.equal(vehicle.arrivalPredictions?.[0]?.sourceTimestamp, now - 10_000);
  const trip = await network.getTrip('bilbobus', vehicle.externalTripId, vehicle.serviceDate, vehicle.id);
  assert.equal(trip?.stops.at(-1)?.at, now + 120_000); assert.ok(warmed.includes('stop:2'));
  const stop = await network.getStop('bilbobus', 'stop:2');
  assert.ok(stop?.departures.some((d) => d.source === 'realtime' && d.updatedAt === now - 10_000));
});
test('stale provider stop forecasts never become motion anchors or fresh timestamps', async () => {
  const { city, network, now } = memoryCity();
  const provider = city.providers.find((p) => p.operatorId === 'bilbobus')!;
  provider.arrivals = {
    departures: async () => [], warm: async () => {},
    peek: (_gtfs, stopId) => stopId === 'stop:2' ? { arrival: now + 120_000, sourceTimestamp: now - 271_000 } : null,
  };
  const snapshot = await network.getPresentationSnapshot();
  const vehicle = snapshot.vehicles.find((v) => v.providerId === 'bilbobus')!;
  assert.equal(vehicle.timetableTimestamp, null);
  assert.equal(vehicle.gpsAnchoredTimeline, true);
  assert.equal(vehicle.arrivalPredictions, undefined);
});
test('SIRI stop forecasts publish their own delay and label the timeline source', async () => {
  const { city, network, now } = memoryCity();
  const provider = city.providers.find((p) => p.operatorId === 'bilbobus')!;
  provider.arrivals = {
    departures: async () => [], warm: async () => {},
    peek: (_gtfs, stopId) => stopId === 'stop:2' ? { arrival: now + 120_000, sourceTimestamp: now - 10_000 } : null,
  };
  const snapshot = await network.getPresentationSnapshot();
  const vehicle = snapshot.vehicles.find((v) => v.providerId === 'bilbobus')!;
  assert.equal(vehicle.timelineSource, 'siri');
  // The fixture schedules the final call about ten minutes after the test clock.
  assert.ok(vehicle.delaySeconds !== null && vehicle.delaySeconds < -400 && vehicle.delaySeconds > -500);
  assert.equal(vehicle.delayEstimated, false);
  const trip = await network.getTrip('bilbobus', vehicle.externalTripId, vehicle.serviceDate, vehicle.id);
  assert.equal(trip?.stops.at(-1)?.source, 'siri');
});
test('SIRI forecasts drive a vehicle that has no fresh GPS', async () => {
  const { city, network, now } = memoryCity({ withoutGps: 'bilbobus' });
  const provider = city.providers.find((p) => p.operatorId === 'bilbobus')!;
  provider.arrivals = {
    departures: async () => [], warm: async () => {},
    peek: (_gtfs, stopId) => stopId === 'stop:2' ? { arrival: now + 120_000, sourceTimestamp: now - 10_000 } : null,
  };
  const snapshot = await network.getPresentationSnapshot();
  const vehicle = snapshot.vehicles.find((v) => v.providerId === 'bilbobus')!;
  assert.equal(vehicle.observationTimestamp, null);
  assert.equal(vehicle.timelineSource, 'siri'); assert.equal(vehicle.nextStop?.at, now + 120_000);
  assert.ok(vehicle.timeline.some((anchor) => anchor.at === now + 120_000));
});
test('a forecast far from the trip belongs to another journey and is ignored', async () => {
  const { city, network, now } = memoryCity();
  const provider = city.providers.find((p) => p.operatorId === 'bilbobus')!;
  provider.arrivals = {
    departures: async () => [], warm: async () => {},
    peek: (_gtfs, stopId) => stopId === 'stop:2' ? { arrival: now + 3 * 3600_000, sourceTimestamp: now - 10_000 } : null,
  };
  const snapshot = await network.getPresentationSnapshot();
  const vehicle = snapshot.vehicles.find((v) => v.providerId === 'bilbobus')!;
  assert.notEqual(vehicle.timelineSource, 'siri'); assert.equal(vehicle.arrivalPredictions, undefined);
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
