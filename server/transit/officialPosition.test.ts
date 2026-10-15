import assert from 'node:assert/strict';
import test from 'node:test';
import { withOfficialPosition } from './officialPosition';
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
