import assert from 'node:assert/strict';
import test from 'node:test';
import { arrivalReliability, feedKind, vehicleReliability } from '../../shared/transit/reliability';
import type { Vehicle } from '../../shared/transit/network';

const now = Date.parse('2026-10-14T15:00:00Z');
const vehicle = (fields: Partial<Vehicle>) => ({ observationTimestamp: null, timetableTimestamp: null, sourceTimestamp: null, positionQuality: 'predicted', positionSource: 'PROVIDER_ESTIMATED', timelineSource: undefined, tripIdentityQuality: 'exact', ...fields }) as Vehicle;

test('a fresh GPS fix is trusted, even when the service it runs had to be deduced', () => {
  const gps = vehicle({ observationTimestamp: now - 200_000, sourceTimestamp: now - 200_000, positionQuality: 'predicted', positionSource: 'GPS', timelineSource: 'gps-schedule' });
  assert.deepEqual(vehicleReliability(gps, now), { level: 'high', basis: 'gps', ageMs: 200_000, identityEstimated: false });
  assert.deepEqual(vehicleReliability({ ...gps, tripIdentityQuality: 'estimated' }, now), { level: 'high', basis: 'gps', ageMs: 200_000, identityEstimated: true });
});

test('live arrival predictions without GPS are trusted as much as GPS while fresh (Metro Bilbao)', () => {
  const metro = vehicle({ timetableTimestamp: now - 150_000, sourceTimestamp: now - 150_000, timelineSource: 'gtfs-rt' });
  assert.deepEqual(vehicleReliability(metro, now), { level: 'high', basis: 'realtime-arrivals', ageMs: 150_000, identityEstimated: false });
  assert.equal(vehicleReliability({ ...metro, timetableTimestamp: now - 300_000 }, now).level, 'low', 'expired predictions are not trusted');
});

test('operator position estimates are approximate and the timetable is not trusted', () => {
  assert.deepEqual(vehicleReliability(vehicle({ timetableTimestamp: now - 20_000, timelineSource: 'provider' }), now), { level: 'medium', basis: 'operator-estimate', ageMs: 20_000, identityEstimated: false });
  assert.deepEqual(vehicleReliability(vehicle({ positionQuality: 'scheduled', positionSource: 'SCHEDULE_SIMULATION', timelineSource: 'schedule' }), now), { level: 'low', basis: 'schedule', ageMs: null, identityEstimated: false });
  assert.equal(vehicleReliability(vehicle({ observationTimestamp: now - 10_000, positionSource: 'STALE' }), now).level, 'low');
});

test('arrival times: operator predictions are trusted, GPS-shifted timetables approximate, the timetable not', () => {
  assert.deepEqual(arrivalReliability('realtime', now - 30_000, now), { level: 'high', basis: 'realtime' });
  assert.deepEqual(arrivalReliability('siri', null, now), { level: 'high', basis: 'realtime' });
  assert.deepEqual(arrivalReliability('realtime', now - 600_000, now), { level: 'low', basis: 'schedule' });
  assert.deepEqual(arrivalReliability('gps', now - 30_000, now), { level: 'medium', basis: 'gps-shifted' });
  assert.deepEqual(arrivalReliability('schedule', null, now), { level: 'low', basis: 'schedule' });
});

test('providers are classified by how they feed the map', () => {
  assert.equal(feedKind({ vehiclePositions: true, tripUpdates: true, stopArrivals: false }), 'vehicle-positions');
  assert.equal(feedKind({ vehiclePositions: false, tripUpdates: true, stopArrivals: false }), 'arrival-predictions');
  assert.equal(feedKind({ vehiclePositions: false, tripUpdates: false, stopArrivals: false }), 'schedule-only');
});
