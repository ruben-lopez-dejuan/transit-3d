import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeStopForecasts, timeAtProgress, type StopForecast } from './stopForecasts';

// Base timetable: stops every 1000 m, 100 s apart, 20 s dwell at the middle stops.
const base = [
  { at: 0, progress: 0 }, { at: 100, progress: 1000 }, { at: 120, progress: 1000 },
  { at: 220, progress: 2000 }, { at: 240, progress: 2000 }, { at: 340, progress: 3000 },
];
const forecast = (progress: number, at: number, departure = at): StopForecast => ({ at, departure, progress, sourceTimestamp: 0, scheduledArrival: 0 });

test('a single forecast stop does not end the timeline: later anchors keep the base pace from its departure', () => {
  const merged = mergeStopForecasts(base, [forecast(1000, 160, 175)]);
  assert.deepEqual(merged.filter((a) => a.progress === 1000).map((a) => a.at), [160, 175]);
  // 55 s late at the forecast stop: the rest of the trip is shifted by the same amount.
  assert.equal(timeAtProgress(merged, 2000), 275);
  assert.equal(merged.at(-1)!.progress, 3000); assert.equal(merged.at(-1)!.at, 395);
});
test('the forecast replaces the base time at its stop and stretches the stops between two forecasts', () => {
  const merged = mergeStopForecasts(base, [forecast(1000, 110), forecast(3000, 410)]);
  assert.equal(timeAtProgress(merged, 1000), 110); assert.equal(timeAtProgress(merged, 3000), 410);
  // Base 120 → 340 becomes 110 → 410; stop 2000 keeps its relative position (100/220 of the span).
  assert.equal(Math.round(timeAtProgress(merged, 2000)!), Math.round(110 + 100 / 220 * 300));
});
test('anchors before the first forecast move with it, so a late vehicle without GPS is drawn behind its timetable', () => {
  const merged = mergeStopForecasts(base, [forecast(2000, 280)]);
  assert.equal(merged[0].at, 60); assert.equal(timeAtProgress(merged, 1000), 160);
});
test('merged timelines never run backwards in time', () => {
  const merged = mergeStopForecasts(base, [forecast(1000, 300), forecast(2000, 310)]);
  for (let i = 1; i < merged.length; i++) assert.ok(merged[i].at >= merged[i - 1].at && merged[i].progress >= merged[i - 1].progress);
});
