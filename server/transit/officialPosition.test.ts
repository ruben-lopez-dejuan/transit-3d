import assert from 'node:assert/strict';
import test from 'node:test';
import { officialNextStop, withOfficialPosition } from './officialPosition';
import { buildShapeMetric } from './motionEngine';
import type { NormalizedVehicle } from '../../shared/transit/contracts';

// A straight 6 km road east from (0, 43.3); stops every 1 km.
const metric = buildShapeMetric(Array.from({ length: 61 }, (_, i) => ({ latitude: 43.3, longitude: i * .001234, sequence: i })));
const plan = { metric, stops: [1000, 2000, 3000, 4000, 5000, 6000].map((progress, i) => ({ stopId: `s${i}`, sequence: i + 1, arrival: 0, departure: 0, progress })), anchors: [] } as never;
const t0 = Date.parse('2026-10-15T16:00:00Z');
const bus = { observationTimestamp: t0, observationProgressMeters: 1000, progressMetersAlongShape: 1000, speedMetersPerSecond: 8, externalVehicleId: '2089' } as NormalizedVehicle;
const reading = (stopId: string, distanceMeters: number, at: number) => (_gtfs: unknown, id: string) => id === stopId ? { arrival: at, sourceTimestamp: at, distanceMeters } : null;

test('the operator placing a bus well ahead of its late GPS moves it there, as the app says it is arriving', () => {
  // 150 s after the fix the operator has it 100 m before the 5000 m stop: 24 m/s through the tunnel.
  const now = new Date(t0 + 155_000);
  const moved = withOfficialPosition(bus, {} as never, plan, now, reading('s4', 100, t0 + 150_000));
  assert.equal(moved.observationTimestamp, t0 + 150_000);
  assert.ok(Math.abs(moved.observationProgressMeters! - 4900) < 1);
  assert.deepEqual(moved.previousObservation, { at: t0, progress: 1000 });
  assert.ok(moved.speedMetersPerSecond! > 25);
});

test('a reading close to where the GPS already puts the bus, older, or impossible changes nothing', () => {
  const now = new Date(t0 + 155_000);
  // 8 m/s for 150 s: 2200 m, and the operator says 2300 m.
  assert.equal(withOfficialPosition(bus, {} as never, plan, now, reading('s2', 700, t0 + 150_000)), bus);
  assert.equal(withOfficialPosition(bus, {} as never, plan, now, reading('s4', 100, t0 - 10_000)), bus, 'older than the fix');
  assert.equal(withOfficialPosition(bus, {} as never, plan, new Date(t0 + 35_000), reading('s4', 100, t0 + 30_000)), bus, '130 m/s is not a bus');
  assert.equal(withOfficialPosition({ ...bus, observationTimestamp: null }, {} as never, plan, now, reading('s4', 100, t0 + 150_000)).observationTimestamp, null);
});

test('the next stop is the first one the stop panels still list the bus at', () => {
  const now = new Date(t0 + 60_000);
  // GPS at 1000 m, 60 s old; the operator has it 300 m before the 3000 m stop 10 s ago: next is 3000, not 2000.
  assert.equal(officialNextStop(bus, {} as never, plan, now, reading('s2', 300, t0 + 50_000))?.progress, 3000);
  // 1500 m before the 4000 m stop: the bus is before the 3000 m stop, its next one.
  assert.equal(officialNextStop(bus, {} as never, plan, now, reading('s3', 1500, t0 + 50_000))?.progress, 3000);
  // At the stop (0 m): that stop is still the next one.
  assert.equal(officialNextStop(bus, {} as never, plan, now, reading('s1', 0, t0 + 50_000))?.stopId, 's1');
  // Where the operator put it when queried: never behind its GPS fix, never past the stop.
  assert.equal(officialNextStop(bus, {} as never, plan, now, reading('s2', 300, t0 + 50_000))?.position, 2700);
  assert.equal(officialNextStop(bus, {} as never, plan, now, reading('s1', 1500, t0 + 50_000))?.position, 985);
});

test('an old reading, or one a newer GPS fix has overtaken, names no next stop behind the bus', () => {
  assert.equal(officialNextStop(bus, {} as never, plan, new Date(t0 + 200_000), reading('s2', 300, t0 + 50_000)), null, 'older than 90 s');
  // The reading put it 1500 m before the 4000 m stop, but a newer fix has it at 2900 m.
  const later = { ...bus, observationTimestamp: t0 + 55_000, observationProgressMeters: 2900, progressMetersAlongShape: 2900 };
  assert.equal(officialNextStop(later, {} as never, plan, new Date(t0 + 60_000), reading('s3', 1500, t0 + 50_000))?.progress, 3000);
  assert.equal(officialNextStop({ ...bus, externalVehicleId: null }, {} as never, plan, new Date(t0 + 60_000), reading('s2', 300, t0 + 50_000)), null);
});

test('a fresher reading further on beats a stale one at a stop the bus has left, and a newer fix at a stop overtakes it', () => {
  const now = new Date(t0 + 60_000);
  // 60 s old: still listed at the 2000 m stop. 10 s old: 400 m before the 3000 m stop. It has left 2000.
  const readings = (_gtfs: unknown, id: string) => id === 's1' ? { arrival: t0, sourceTimestamp: t0, distanceMeters: 50 } : id === 's2' ? { arrival: t0 + 50_000, sourceTimestamp: t0 + 50_000, distanceMeters: 400 } : null;
  assert.equal(officialNextStop(bus, {} as never, plan, now, readings)?.progress, 3000);
  // A fix 5 s after the reading has the bus 9 m past the 2000 m stop it was listed at: that reading says nothing more.
  const atStop = { ...bus, observationTimestamp: t0 + 55_000, observationProgressMeters: 2009, progressMetersAlongShape: 2009 };
  assert.equal(officialNextStop(atStop, {} as never, plan, now, reading('s1', 30, t0 + 50_000)), null);
  // The same fix older than the reading: the bus may still be at the stop.
  assert.equal(officialNextStop({ ...atStop, observationTimestamp: t0 + 40_000 }, {} as never, plan, now, reading('s1', 0, t0 + 50_000))?.progress, 2000);
});
