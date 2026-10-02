import assert from 'node:assert/strict';
import test from 'node:test';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import { applyRealtime } from '../providers/realtimeProvider';
import { normalizeTripUpdates, resolveServiceDate, updatedTimeline, type TripUpdate, type RealtimeMessage } from './realtime';
import { serviceEpoch } from './plans';
import { generateScheduledVehicles } from './scheduled';

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
  const stale = feed(); stale.header!.timestamp! -= 181;
  const differential = feed(); differential.header!.incrementality = 'DIFFERENTIAL';
  for (const input of [stale, differential, feed({ timestamp: now.getTime() / 1000 - 181 }), feed({ trip: { tripId: 'unknown' } }), feed({ trip: { tripId: 't', routeId: 'other' } }), feed({ trip: { tripId: 't', startDate: '20260231' } }), feed({ trip: { tripId: 't', startTime: '10:00:00' } })]) assert.equal(normalizeTripUpdates(data, input, now).size, 0);
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
