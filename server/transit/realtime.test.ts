import assert from 'node:assert/strict';
import test from 'node:test';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import { applyRealtime, RealtimeProvider } from '../providers/realtimeProvider';
import { RealtimeFeedClient } from '../providers/realtimeFeed';
import { normalizeTripUpdates, renumberTrips, resolveServiceDate, stopStatusIsInformative, updatedTimeline, type NormalizationStats, type TripUpdate, type RealtimeMessage } from './realtime';
import { serviceEpoch } from './plans';
import { generateScheduledVehicles } from './scheduled';
import { anchorGpsTimeline } from './gpsTimeline';
import { ObservationTracker } from './observations';

test('an impossible GPS step confirmed by the next fix moves the vehicle there, without inventing a speed', () => {
  // Renfe Madrid, 16 Oct 2026: C7 held at 64.8 km for over a minute, then 72.2 km 20 s later, then held again.
  const tracker = new ObservationTracker(), at = now.getTime();
  tracker.accept('train', { at, progress: 64_808 }, 'rail', at, 40);
  assert.equal(tracker.accept('train', { at: at + 20_000, progress: 72_187 }, 'rail', at + 20_000, 40), null);
  const confirmed = tracker.accept('train', { at: at + 40_000, progress: 72_187 }, 'rail', at + 40_000, 40)!;
  assert.equal(confirmed.current.progress, 72_187); assert.equal(confirmed.speed, 0); assert.equal(confirmed.previous?.at, at + 20_000);
  // A lone glitch that the next fix contradicts is still ignored.
  tracker.accept('bus', { at, progress: 100 }, 'bus', at);
  assert.equal(tracker.accept('bus', { at: at + 10_000, progress: 2_000 }, 'bus', at + 10_000), null);
  assert.equal(tracker.accept('bus', { at: at + 20_000, progress: 200 }, 'bus', at + 20_000)?.current.progress, 200);
});
test('invalid and physically impossible backwards GPS preserves the last accepted observation and stop state', () => {
  const tracker = new ObservationTracker(), at = now.getTime();
  tracker.accept('vehicle', { at, progress: 100, stoppedAtStop: true }, 'bus', at);
  assert.equal(tracker.accept('vehicle', { at: at + 1000, progress: 50, stoppedAtStop: false }, 'bus', at + 1000), null);
  assert.equal(tracker.accept('vehicle', { at: at + 1000, progress: NaN }, 'bus', at + 1000), null);
  assert.deepEqual(tracker.latest('vehicle', at + 1000)?.current, { at, progress: 100, stoppedAtStop: true });
});

test('an explicit realtime station stop is normalized; an impossible next reading cannot overwrite it', () => {
  const data = fixture();
  const gps: RealtimeMessage = { header: feed().header, entity: [{ vehicle: { trip: { tripId: 't', startDate: date }, currentStatus: 'STOPPED_AT', timestamp: now.getTime() / 1000, position: { latitude: 43.26, longitude: -2.935 } } }] };
  const first = applyRealtime(data, [], 'stop-test', new Map(), gps, now, 40)[0];
  assert.equal(first.stoppedAtStop, true); assert.equal(first.maximumSpeedMetersPerSecond, 40);
  gps.entity![0].vehicle!.timestamp! += 1;
  gps.entity![0].vehicle!.position!.longitude = -2.931;
  gps.entity![0].vehicle!.currentStatus = 'IN_TRANSIT_TO';
  const next = applyRealtime(data, [], 'stop-test', new Map(), gps, new Date(now.getTime() + 1000), 40)[0];
  assert.equal(next.stoppedAtStop, true); assert.equal(next.observationTimestamp, first.observationTimestamp);
});

test('forecast anchoring uses the GPS instant and retains stop dwell without rebasing on each query', () => {
  const plan = [{ at: 1000, progress: 0 }, { at: 120000, progress: 1000 }, { at: 130000, progress: 1000 }, { at: 200000, progress: 2000 }];
  const observation = { at: 60000, progress: 500 };
  const anchored = anchorGpsTimeline(plan, observation);
  assert.deepEqual(anchored, [observation, ...plan.slice(1)]);
  assert.deepEqual(anchorGpsTimeline(anchored, observation), anchored);
  assert.deepEqual(anchorGpsTimeline(plan, { at: 140000, progress: 1400 }), [{ at: 140000, progress: 1400 }, plan[3]]);
});

const date = '20261002', now = new Date(serviceEpoch(date, 10 * 3600 + 5 * 60));
function fixture(): BizkaibusGtfs {
  return {
    routes: new Map([['r', { routeId: 'r', shortName: 'C1', longName: 'A – D', color: '', textColor: '', routeType: 2 }]]),
    trips: new Map([['t', { tripId: 't', routeId: 'r', serviceId: 's', shapeId: 'shape', headsign: 'D', directionId: 0 }]]),
    stops: new Map(['a', 'b', 'c', 'd'].map((stopId, i) => [stopId, { stopId, stopCode: '', name: stopId, latitude: 43.26, longitude: -2.94 + i * 0.01 }])),
    shapes: new Map([['shape', [0, 1, 2, 3].map((i) => ({ latitude: 43.26, longitude: -2.94 + i * 0.01, sequence: i }))]]),
    tripStops: new Map([['t', ['a', 'b', 'c', 'd'].map((stopId, i) => ({ stopId, sequence: i + 1, arrivalTime: `10:${String(i * 10).padStart(2, '0')}:00`, departureTime: `10:${String(i * 10).padStart(2, '0')}:30` }))]]),
    routeTripIds: new Map([['r', ['t']]]), calendars: new Map([['s', { serviceId: 's', startDate: '20260101', endDate: '20261231', weekdays: [true, true, true, true, true, true, true] }]]), calendarDates: new Map(),
  };
}
function feed(update: Partial<TripUpdate> = {}): RealtimeMessage {
  return { header: { gtfsRealtimeVersion: '2.0', timestamp: now.getTime() / 1000 }, entity: [{ tripUpdate: { trip: { tripId: 't', startDate: date }, stopTimeUpdate: [{ stopSequence: 2, stopId: 'b', arrival: { delay: 120 } }], ...update } }] };
}

test('TripUpdates must not erase fresh base GPS at timetable boundaries, but cancellation still removes it', () => {
  const data = fixture(), evaluatedAt = new Date(serviceEpoch(date, 10 * 3600 + 31 * 60));
  const observedAt = evaluatedAt.getTime() - 149_000;
  const base = generateScheduledVehicles(data, now, 'bizkaibus').map((v) => ({ ...v, positionQuality: 'predicted' as const, positionSource: 'gps' as const, observationTimestamp: observedAt, receivedTimestamp: evaluatedAt.getTime() - 1000, vehicleId: 'physical-bus' }));
  const input = feed({ delay: 20, stopTimeUpdate: [{ stopSequence: 2, stopId: 'b', arrival: { delay: 20 } }] }); input.header!.timestamp = evaluatedAt.getTime() / 1000;
  const updates = normalizeTripUpdates(data, input, evaluatedAt);
  const result = applyRealtime(data, base, 'bizkaibus', updates, null, evaluatedAt);
  assert.equal(result.length, 1);
  assert.equal(result[0].observationTimestamp, observedAt);
  assert.equal(result[0].receivedTimestamp, base[0].receivedTimestamp);
  assert.equal(result[0].progressMetersAlongShape, base[0].progressMetersAlongShape);
  assert.equal(applyRealtime(data, generateScheduledVehicles(data, now, 'bizkaibus'), 'bizkaibus', updates, null, evaluatedAt).length, 0, 'an ended schedule stand-in is still removed');
  const canceled = feed({ trip: { tripId: 't', startDate: date, scheduleRelationship: 'CANCELED' } }); canceled.header!.timestamp = evaluatedAt.getTime() / 1000;
  assert.equal(applyRealtime(data, base, 'bizkaibus', normalizeTripUpdates(data, canceled, evaluatedAt), null, evaluatedAt).length, 0);
});
test('TripUpdates absolute times take precedence, preserve dwell, and propagate stop delays', () => {
  const update = normalizeTripUpdates(fixture(), feed({ delay: 60, stopTimeUpdate: [{ stopId: 'b', arrival: { delay: 999, time: serviceEpoch(date, 10 * 3600 + 12 * 60) / 1000 }, departure: { delay: 150 } }] }), now).get(`${date}:t`)!;
  assert.equal(update.stops.get(1)!.departure - update.stops.get(1)!.scheduledDeparture, 60_000);
  assert.equal(update.stops.get(2)!.arrival - update.stops.get(2)!.scheduledArrival, 120_000);
  assert.equal(update.stops.get(2)!.departure - update.stops.get(2)!.scheduledDeparture, 150_000);
  assert.equal(update.stops.get(3)!.arrival - update.stops.get(3)!.scheduledArrival, 150_000);
  assert.ok(updatedTimeline(fixture(), update));
});
test('NO_DATA clears propagation, SKIPPED is local, and explicit zero restores realtime', () => {
  const update = normalizeTripUpdates(fixture(), feed({ delay: 120, stopTimeUpdate: [{ stopSequence: 2, scheduleRelationship: 'SKIPPED' }, { stopSequence: 3, scheduleRelationship: 'NO_DATA' }, { stopSequence: 4, arrival: { delay: 0 } }] }), now).get(`${date}:t`)!;
  assert.equal(update.stops.get(2)?.skipped, true);
  assert.equal(update.stops.get(2)?.arrivalRealtime, true);
  assert.equal(update.stops.get(3)?.skipped, false);
  assert.equal(update.stops.get(3)?.arrivalRealtime, false);
  assert.equal(update.stops.get(4)?.arrivalRealtime, true);
  assert.equal(update.stops.get(4)?.arrival, update.stops.get(4)?.scheduledArrival);
  const timeline = updatedTimeline(fixture(), update)!;
  assert.equal(timeline.length, 6);
});
test('Missing delay is unknown rather than an on-time prediction', () => {
  const update = normalizeTripUpdates(fixture(), feed(), now).get(`${date}:t`)!;
  assert.equal(update.stops.get(1)?.arrivalRealtime, false);
  assert.equal(update.stops.get(2)?.arrivalRealtime, true);
});
test('Stale headers/entities, differential feeds, invalid dates/routes, and unknown trips are ignored', () => {
  const data = fixture();
  const stale = feed(); stale.header!.timestamp! -= 271;
  const differential = feed(); differential.header!.incrementality = 'DIFFERENTIAL';
  for (const input of [stale, differential, feed({ timestamp: now.getTime() / 1000 - 271 }), feed({ trip: { tripId: 'unknown' } }), feed({ trip: { tripId: 't', routeId: 'other' } }), feed({ trip: { tripId: 't', startDate: '20260231' } }), feed({ trip: { tripId: 't', startTime: '10:00:00' } })]) assert.equal(normalizeTripUpdates(data, input, now).size, 0);
});
test('Stops must match both ID and sequence; repeated stations without sequence are ambiguous', () => {
  const data = fixture();
  assert.equal(normalizeTripUpdates(data, feed({ stopTimeUpdate: [{ stopSequence: 2, stopId: 'c', arrival: { delay: 60 } }] }), now).size, 0);
  data.tripStops.get('t')![2].stopId = 'b';
  assert.equal(normalizeTripUpdates(data, feed({ stopTimeUpdate: [{ stopId: 'b', arrival: { delay: 60 } }] }), now).size, 0);
  assert.equal(normalizeTripUpdates(data, feed({ stopTimeUpdate: [{ stopId: 'b', stopSequence: 3, arrival: { delay: 60 } }] }), now).size, 1);
});
test('Calendar exclusions are honored even for realtime entities', () => {
  const data = fixture(); data.calendarDates.set('s', new Map([[date, 2]]));
  assert.equal(normalizeTripUpdates(data, feed(), now).size, 0);
});
test('Absolute stop events resolve yesterday’s extended-hour service instance', () => {
  const data = fixture();
  for (const stop of data.tripStops.get('t')!) { stop.arrivalTime = stop.arrivalTime!.replace('10:', '25:'); stop.departureTime = stop.departureTime!.replace('10:', '25:'); }
  const at = serviceEpoch(date, 25 * 3600 + 10 * 60);
  assert.equal(resolveServiceDate(data, { tripId: 't' }, new Date(at), [{ stopId: 'b', arrival: { time: at / 1000 } }]), date);
});
test('Realtime predictions keep delayed trips active, with the same identity and no false GPS', () => {
  const data = fixture(), late = new Date(serviceEpoch(date, 10 * 3600 + 35 * 60));
  const input = feed({ delay: 600, stopTimeUpdate: [{ stopSequence: 2, arrival: { delay: 600 } }] }); input.header!.timestamp = late.getTime() / 1000;
  const updates = normalizeTripUpdates(data, input, late), base = generateScheduledVehicles(data, late, 'renfe');
  assert.equal(base.length, 0);
  const vehicles = applyRealtime(data, base, 'renfe', updates, null, late);
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].id, `renfe:${date}:t`);
  assert.equal(vehicles[0].positionQuality, 'predicted');
  assert.equal(vehicles[0].observationTimestamp, null);
  assert.equal(vehicles[0].delaySeconds, 600);
});
test('the unit named in a TripUpdate becomes the vehicle id (Metro Bilbao 607 is a five-car train)', () => {
  const data = fixture(), late = new Date(serviceEpoch(date, 10 * 3600 + 35 * 60));
  const input = feed({ vehicle: { id: '607' }, delay: 600, stopTimeUpdate: [{ stopSequence: 2, arrival: { delay: 600 } }] }); input.header!.timestamp = late.getTime() / 1000;
  const updates = normalizeTripUpdates(data, input, late);
  assert.equal(updates.get(`${date}:t`)?.vehicleId, '607');
  assert.equal(applyRealtime(data, [], 'metro-bilbao', updates, null, late)[0].vehicleId, '607');
});
test('Cancellations remove scheduled vehicles and also suppress GPS observations', () => {
  const data = fixture(), updates = normalizeTripUpdates(data, feed({ trip: { tripId: 't', startDate: date, scheduleRelationship: 'CANCELED' }, stopTimeUpdate: [] }), now);
  const gps: RealtimeMessage = { header: feed().header, entity: [{ vehicle: { trip: { tripId: 't', startDate: date }, timestamp: now.getTime() / 1000, position: { latitude: 43.26, longitude: -2.935 } } }] };
  assert.equal(applyRealtime(data, generateScheduledVehicles(data, now, 'renfe'), 'renfe', updates, gps, now).length, 0);
});
test('Future predictions do not create active vehicles prematurely', () => {
  const data = fixture(), updates = normalizeTripUpdates(data, feed({ delay: 600, stopTimeUpdate: [{ stopSequence: 2, arrival: { delay: 600 } }] }), now);
  assert.equal(applyRealtime(data, generateScheduledVehicles(data, now, 'renfe'), 'renfe', updates, null, now).length, 0);
});
test('Recent GPS replaces one scheduled identity; malformed or distant positions cannot create trains', () => {
  const data = fixture(), gps: RealtimeMessage = { header: feed().header, entity: [{ vehicle: { trip: { tripId: 't', startDate: date }, timestamp: now.getTime() / 1000, position: { latitude: 43.26, longitude: -2.935 } } }] };
  const base = generateScheduledVehicles(data, now, 'renfe');
  const vehicles = applyRealtime(data, base, 'renfe', new Map(), gps, now);
  assert.equal(vehicles.length, 1); assert.equal(vehicles[0].positionQuality, 'live');
  gps.entity![0].vehicle!.position!.latitude = 0;
  assert.equal(applyRealtime(data, base, 'renfe', new Map(), gps, now)[0].positionQuality, 'scheduled');
});

test('a provider speed limit rejects an impossible GPS hop without renewing the last valid timestamp', () => {
  const data = fixture();
  const gps: RealtimeMessage = { header: feed().header, entity: [{ vehicle: { trip: { tripId: 't', startDate: date }, timestamp: now.getTime() / 1000, position: { latitude: 43.26, longitude: -2.939 } } }] };
  const first = applyRealtime(data, [], 'bounded', new Map(), gps, now, 40)[0];
  const later = new Date(now.getTime() + 1000);
  gps.entity![0].vehicle!.timestamp = later.getTime() / 1000;
  gps.entity![0].vehicle!.position!.longitude = -2.931;
  const invalid = applyRealtime(data, [], 'bounded', new Map(), gps, later, 40)[0];
  assert.equal(invalid.observationTimestamp, first.observationTimestamp);
  assert.equal(invalid.progressMetersAlongShape, first.progressMetersAlongShape);
  const recoveredAt = new Date(now.getTime() + 40_000);
  gps.entity![0].vehicle!.timestamp = recoveredAt.getTime() / 1000;
  const recovered = applyRealtime(data, [], 'bounded', new Map(), gps, recoveredAt, 40)[0];
  assert.equal(recovered.observationTimestamp, recoveredAt.getTime());
  assert.ok(recovered.speedMetersPerSecond! < 40);
});

test('a feed marking every vehicle STOPPED_AT carries no stop information', () => {
  assert.equal(stopStatusIsInformative(Array(235).fill(1)), false);
  assert.equal(stopStatusIsInformative(Array(20).fill('STOPPED_AT')), false);
  assert.equal(stopStatusIsInformative([1, 1, 1, 1, 1, 2]), true);
  assert.equal(stopStatusIsInformative([1, 1]), true, 'too few reports to judge the feed');
  assert.equal(stopStatusIsInformative([undefined, null]), true);
});

/** Six numbered trips 10 min apart over a–d, as Metro Bilbao publishes them. */
function numberedFixture(): BizkaibusGtfs {
  const data = fixture(), ids = ['900', '901', '902', '903', '904', '905'];
  const clock = (seconds: number) => [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
  data.trips = new Map(ids.map((tripId) => [tripId, { tripId, routeId: 'r', serviceId: 's', shapeId: 'shape', headsign: 'D', directionId: 0 }]));
  data.tripStops = new Map(ids.map((tripId, k) => [tripId, ['a', 'b', 'c', 'd'].map((stopId, i) => ({ stopId, sequence: i + 1, arrivalTime: clock(9 * 3600 + 50 * 60 + k * 600 + i * 600), departureTime: clock(9 * 3600 + 50 * 60 + k * 600 + i * 600 + 30) }))]));
  data.routeTripIds = new Map([['r', ids]]);
  return data;
}
/** The operator's update for published trip `k`, renumbered by `shift` and running `delay` seconds late. */
function numberedUpdate(k: number, shift: number, delay: number, stopIds = ['b', 'c', 'd']) {
  return { tripUpdate: { trip: { tripId: String(900 + k + shift), routeId: 'r' }, stopTimeUpdate: stopIds.map((stopId) => ({ stopId, arrival: { time: serviceEpoch(date, 9 * 3600 + 50 * 60 + k * 600 + 'abcd'.indexOf(stopId) * 600) / 1000 + delay } })) } };
}
const numberedFeed = (entity: RealtimeMessage['entity']): RealtimeMessage => ({ header: { gtfsRealtimeVersion: '2.0', timestamp: now.getTime() / 1000 }, entity });

test('a feed that renumbers every trip by a constant is matched back to the timetable (Metro Bilbao +1663)', () => {
  const data = numberedFixture();
  const input = numberedFeed([0, 1, 2, 3].map((k) => numberedUpdate(k, 1663, 40 + k)));
  assert.equal(normalizeTripUpdates(data, input, now).size, 0);
  const { feed: renamed, renumbering } = renumberTrips(data, input, now);
  assert.deepEqual(renumbering, { offset: -1663, renamed: 4, unknown: 4 });
  const updates = normalizeTripUpdates(data, renamed, now);
  assert.deepEqual([...updates.values()].map((update) => update.tripId), ['900', '901', '902', '903']);
  assert.equal(updates.get(`${date}:901`)!.stops.get(2)!.arrival - updates.get(`${date}:901`)!.stops.get(2)!.scheduledArrival, 41_000);
  assert.equal(input.entity![0].tripUpdate!.trip.tripId, '2563', 'the downloaded feed is not mutated');
});

test('renumbering needs most unknown trips to agree; a coincidence, a tie or a stranger is not renamed', () => {
  const data = numberedFixture();
  assert.equal(renumberTrips(data, numberedFeed([numberedUpdate(0, 50, 0), numberedUpdate(1, 50, 0)]), now).renumbering, null, 'two trips are too few to call it a renumbering');
  assert.equal(renumberTrips(data, numberedFeed([0, 1, 2].map((k) => numberedUpdate(k, 50, 3 * 3600))), now).renumbering, null, 'no trip runs at those times');
  assert.equal(renumberTrips(data, numberedFeed([numberedUpdate(0, 50, 0), numberedUpdate(1, 50, 0), numberedUpdate(2, 70, 0), numberedUpdate(3, 70, 0)]), now).renumbering, null, 'two shifts tie');
  const mixed = numberedFeed([numberedUpdate(0, 50, 0), numberedUpdate(1, 50, 0), numberedUpdate(2, 50, 0), numberedUpdate(3, 50, 0, ['d', 'b'])]);
  const { feed: renamed, renumbering } = renumberTrips(data, mixed, now);
  assert.deepEqual(renumbering, { offset: -50, renamed: 3, unknown: 4 });
  assert.equal(renamed!.entity![3].tripUpdate!.trip.tripId, '953', 'stations out of order do not agree with trip 903');
  const known = numberedFeed([numberedUpdate(0, 0, 60), numberedUpdate(1, 0, 60), numberedUpdate(2, 0, 60)]);
  assert.equal(renumberTrips(data, known, now).feed, known, 'a feed with known trips is left as is');
});

test('updates that only repeat the timetable are counted as echoes, not as predictions', () => {
  const data = numberedFixture(), stats: NormalizationStats = { echoTripIds: [] };
  const updates = normalizeTripUpdates(data, numberedFeed([numberedUpdate(0, 0, 0), numberedUpdate(1, 0, 90), numberedUpdate(2, 0, 0)]), now, 'Europe/Madrid', stats);
  assert.deepEqual([...updates.values()].map((update) => update.tripId), ['901']);
  assert.deepEqual(stats.echoTripIds, ['900', '902']);
});

test('the provider joins a renumbered feed and tells the admin what it renamed and which lines publish only the timetable', async () => {
  const data = numberedFixture();
  data.routes.set('r2', { routeId: 'r2', shortName: 'C2', longName: 'A – D', color: '', textColor: '', routeType: 2 });
  data.trips.set('902', { ...data.trips.get('902')!, routeId: 'r2' });
  const client = new RealtimeFeedClient('renumbered-fixture', 'unused:no-network');
  const onC2 = numberedUpdate(2, 1663, 0); onC2.tripUpdate.trip.routeId = 'r2';
  const timetable = numberedFeed([numberedUpdate(0, 1663, 60), numberedUpdate(1, 1663, 75), onC2, numberedUpdate(3, 1663, 30)]);
  // The fixture lives on a fixed service day; the client would judge its freshness against the real clock.
  Object.assign(client, { get: async () => ({ feed: timetable, sourceTimestamp: now.getTime(), receivedTimestamp: now.getTime() }) });
  const provider = new RealtimeProvider({ operatorId: 'metro', getSnapshot: async () => ({ operatorId: 'metro', fetchedAt: now.getTime(), sourceTimestamp: null, status: 'ok', vehicles: [] }) }, async () => data, client);
  const snapshot = await provider.getSnapshot(now);
  assert.equal(snapshot.realtimeTripCount, 3);
  assert.equal(snapshot.status, 'ok');
  assert.deepEqual(snapshot.realtimeNotes, [
    'Los TripUpdates numeran cada viaje con su trip_id del GTFS publicado +1663; 4 de 4 se han reconocido por su horario.',
    '1 viaje del feed solo repite el horario, sin retraso ni incertidumbre, y no cuenta como tiempo real. Sin ninguna previsión: C2.',
  ]);
});
