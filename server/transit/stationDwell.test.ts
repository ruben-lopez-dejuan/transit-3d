import assert from 'node:assert/strict';
import test from 'node:test';
import { withStationDwell } from './stationDwell';

test('trains stop at stations published without dwell, keeping the published arrival', () => {
  const timeline = [{ at: 0, progress: 0 }, { at: 120_000, progress: 1000 }, { at: 240_000, progress: 2000 }];
  const dwell = withStationDwell(timeline);
  assert.deepEqual(dwell, [{ at: 0, progress: 0 }, { at: 120_000, progress: 1000 }, { at: 140_000, progress: 1000 }, { at: 240_000, progress: 2000 }]);
  // Explicit dwell is left as published and the function is idempotent.
  assert.deepEqual(withStationDwell(dwell), dwell);
});
test('short runs get a proportionally short stop', () => {
  const dwell = withStationDwell([{ at: 0, progress: 0 }, { at: 30_000, progress: 300 }, { at: 50_000, progress: 600 }]);
  assert.equal(dwell[2].at - dwell[1].at, 6000);
});
