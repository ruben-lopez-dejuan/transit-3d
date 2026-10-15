import assert from 'node:assert/strict';
import test from 'node:test';
import { bearingDegrees, sameSpotStops } from './sameSpotStops';

type TestStop = { key: string; longitude: number; latitude: number; bearings: number[] };
const stop = (key: string, longitude: number, latitude: number, ...bearings: number[]): TestStop => ({ key, longitude, latitude, bearings });
const keys = (stops: TestStop[]) => stops.map((s) => s.key);

test('a departure board joins stops at the same spot that leave the same way', () => {
  // Sabino Arana: Euskotren puts both tram platforms at one point; Bilbobus stops 12 m away.
  const tramNorth = stop('tram-q1', -2.946222, 43.263192, 20), tramSouth = stop('tram-q2', -2.946222, 43.263192, 200);
  const busNorth = stop('bus-north', -2.9461, 43.2631, 35), busSouth = stop('bus-south', -2.9464, 43.2633, 210);
  const farNorth = stop('bus-far', -2.9455, 43.2630, 20);
  const all = [tramNorth, tramSouth, busNorth, busSouth, farNorth];
  assert.deepEqual(keys(sameSpotStops(tramNorth, all, (s) => s.bearings)), ['tram-q1', 'bus-north']);
  assert.deepEqual(keys(sameSpotStops(tramSouth, all, (s) => s.bearings)), ['tram-q2', 'bus-south']);
});

test('a stop without known departures is kept beside one that has them', () => {
  const selected = stop('a', -2.9462, 43.2632, 90), unknown = stop('b', -2.9462, 43.26321);
  assert.deepEqual(keys(sameSpotStops(selected, [selected, unknown], (s) => s.bearings)), ['a', 'b']);
});

test('bearings are compass degrees', () => {
  assert.equal(Math.round(bearingDegrees({ longitude: -2.9, latitude: 43.2 }, { longitude: -2.9, latitude: 43.21 })), 0);
  assert.equal(Math.round(bearingDegrees({ longitude: -2.9, latitude: 43.2 }, { longitude: -2.91, latitude: 43.2 })), 270);
});

test('a train station shows both directions: its platforms are joined whatever way they leave', () => {
  // Euskotren Sondika: platforms Q1 and Q2 are separate stops with the station's name.
  const platform = (key: string, longitude: number, latitude: number, bearing: number, modes = ['rail']) => ({ key, longitude, latitude, name: 'Sondika', operatorId: 'euskotren', modes, bearings: [bearing] });
  const q1 = platform('q1', -2.928255, 43.298278, 200), q2 = platform('q2', -2.928092, 43.298351, 20);
  const bus = { key: 'bus', longitude: -2.9282, latitude: 43.2983, name: 'Sondika geltokia', operatorId: 'bizkaibus', modes: ['bus'], bearings: [20] };
  assert.deepEqual(keys(sameSpotStops(q1, [q1, q2, bus], (s) => s.bearings) as never), ['q1', 'q2', 'bus']);
  // Tram platforms on either side of a street are still kept apart.
  const t1 = platform('t1', -2.946222, 43.263192, 20, ['tram']), t2 = platform('t2', -2.946222, 43.263192, 200, ['tram']);
  assert.deepEqual(keys(sameSpotStops(t1, [t1, t2], (s) => s.bearings) as never), ['t1']);
});
