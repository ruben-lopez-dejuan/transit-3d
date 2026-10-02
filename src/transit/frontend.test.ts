import assert from 'node:assert/strict';
import test from 'node:test';
import { progressAt, positionAlong, correctionOffset, positionQuality } from './motion';
import { searchNetwork } from './search';
import { esc, badge } from '../ui';
import type { Network, Vehicle } from './networkTypes';

test('client movement preserves station dwell and clamps the timeline', () => {
  const anchors = [{ at: 0, progress: 0 }, { at: 10000, progress: 1000 }, { at: 20000, progress: 1000 }, { at: 30000, progress: 2000 }];
  assert.equal(progressAt(anchors, -1), 0);
  assert.equal(progressAt(anchors, 5000), 500);
  assert.equal(progressAt(anchors, 15000, true), 1000);
  assert.equal(progressAt(anchors, 40000), 2000);
  assert.equal(progressAt([], 0), null);
  assert.ok(progressAt(anchors, 1000, true)! < progressAt(anchors, 1000)!);
  assert.ok(progressAt(anchors, 9000, true)! > progressAt(anchors, 9000)!);
});
test('rendered positions use cumulative meters and preserve segment bearing', () => {
  const shape = { key: 'op:shape', coordinates: [[0, 0], [.001, 0], [.001, .002]] as [number, number][], cumulative: [0, 100, 300], total: 300 };
  assert.deepEqual(positionAlong(shape, 200)?.coordinate, [.001, .001]);
  assert.equal(positionAlong(shape, 200)?.bearing, 0);
  assert.equal(positionAlong(shape, 50)?.bearing, 90);
  assert.deepEqual(positionAlong(shape, -50)?.coordinate, [0, 0]);
  assert.deepEqual(positionAlong(shape, 900)?.coordinate, [.001, .002]);
});
test('GPS correction starts at the displayed position and gradually removes error', () => {
  assert.equal(correctionOffset(100, 1000, 10000, 1000), 100);
  assert.equal(correctionOffset(100, 1000, 10000, 6000), 50);
  assert.equal(correctionOffset(100, 1000, 10000, 11000), 0);
  assert.equal(correctionOffset(-100, 1000, 10000, 6000), -50);
  const vehicle = { positionQuality: 'live', observationTimestamp: 1000 } as Vehicle;
  assert.equal(positionQuality(vehicle, 46000), 'live');
  assert.equal(positionQuality(vehicle, 46001), 'predicted');
  assert.equal(positionQuality({ ...vehicle, positionQuality: 'scheduled' }, 90000), 'scheduled');
});
const network: Network = {
  operators: [], places: [{ id: 'mam', name: 'San Mamés', longitude: -2.95, latitude: 43.26 }],
  routes: [
    { key: 'bus:A3', operatorId: 'bus', routeId: 'A3', shortName: 'A3', longName: 'San Mamés', mode: 'bus', color: '#246b57', textColor: '#fff', directions: [] },
    { key: 'rail:A3', operatorId: 'rail', routeId: 'A3', shortName: 'A3', longName: 'Rail', mode: 'rail', color: '#246b57', textColor: '#fff', directions: [] },
  ],
  stops: [{ key: 'rail:s', operatorId: 'rail', stopId: 's', name: 'San Mamés', modes: ['rail'], longitude: -2.95, latitude: 43.26 }],
};
test('search ranks exact route codes, handles accents, and respects mode/operator filters', () => {
  const first = searchNetwork(network, 'a3', 'bus', new Set(['bus', 'rail']))[0];
  assert.equal(first.type, 'route');
  assert.equal(first.type === 'route' && first.item.key, 'bus:A3');
  const results = searchNetwork(network, 'San Mames', 'rail', new Set(['rail']));
  assert.deepEqual(results.map((r) => r.type), ['stop', 'place']);
  assert.equal(searchNetwork(network, 'a3', 'all', new Set()).length, 0);
  assert.equal(searchNetwork(network, '', 'all', new Set(['bus'])).length, 0);
});
test('feed strings cannot inject HTML or CSS through labels and route badges', () => {
  assert.equal(esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  const html = badge({ color: 'red;position:fixed', shortName: '<script>' });
  assert.ok(html.includes('--line:#176955'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('position:fixed'));
});
