import assert from 'node:assert/strict';
import test from 'node:test';
import { GpsMotion } from './gpsMotion';
import { advanceProgress } from './progressFollower';

const options = { mode: 'bus' as const, timeline: [], speed: 10 };
function advance(motion: GpsMotion, from: number, to: number) {
  for (let at = from + 1000; at <= to; at += 1000) motion.position(at);
}

test('three sparse 149-second GPS cycles keep moving, without a velocity spike at each refresh', () => {
  const motion = new GpsMotion();
  motion.update({ at: 0, progress: 0 }, 0, options);
  for (let cycle = 1; cycle <= 3; cycle++) {
    const at = cycle * 149000;
    advance(motion, at - 149000, at);
    const before = motion.diagnostics;
    const observation = { at, progress: at / 100 + (cycle === 1 ? 100 : 0) };
    assert.equal(motion.update(observation, at, options), true);
    assert.equal(motion.diagnostics.cadenceSeconds, 149);
    assert.equal(motion.position(at), before.renderedProgress);
    assert.equal(motion.diagnostics.renderedSpeed, before.renderedSpeed);
    const after = motion.position(at + 100)!;
    assert.ok(after - before.renderedProgress < 1.4);
    assert.ok(Math.abs(motion.diagnostics.renderedSpeed - before.renderedSpeed) <= .120001);
    assert.ok(motion.diagnostics.renderedSpeed < 14);
  }
});

test('duplicate HTTP replies leave source timestamp, cadence and corrections unchanged', () => {
  const a = new GpsMotion(), b = new GpsMotion();
  for (const motion of [a, b]) motion.update({ at: 0, progress: 0 }, 0, options);
  for (let at = 1000; at <= 140000; at += 1000) {
    a.position(at); b.position(at);
    if (at % 15000 === 0) a.update({ at: 0, progress: 0 }, at, { ...options, speed: 30 });
  }
  assert.deepEqual(a.diagnostics, b.diagnostics);
  assert.equal(a.quality, 'estimated');
  assert.equal(a.diagnostics.sourceTimestamp, 0);
  assert.equal(a.diagnostics.cadenceSeconds, null);
});

function correction(error: number, cadence: number, mode: 'bus' | 'rail' = 'bus', step = 1000) {
  const pace = mode === 'bus' ? 10 : 20, observed = 6700, start = 120000;
  const motion = new GpsMotion({ progress: observed - error, speed: pace });
  motion.update({ at: start, progress: observed }, start, { mode, timeline: [], speed: pace, previous: { at: start - cadence * 1000, progress: observed - pace * cadence } });
  let maximum = 0;
  for (let at = start + step; at <= start + 20000; at += step) { motion.position(at); maximum = Math.max(maximum, motion.diagnostics.renderedSpeed); }
  return { motion, maximum };
}
test('adaptive catch-up keeps small errors gentle and makes fresh large forward errors converge faster', () => {
  const small = correction(50, 30), large = correction(500, 30);
  assert.ok(small.maximum < 15, `small correction peaked at ${small.maximum}`);
  assert.ok(large.maximum > small.maximum * 2, `large ${large.maximum}, small ${small.maximum}`);
  assert.ok(large.motion.diagnostics.correctionErrorMeters < 300);
  assert.ok(large.motion.diagnostics.renderedProgress < large.motion.diagnostics.predictedProgress);
  assert.ok(large.maximum <= 40);
});

test('catch-up uses cadence and mode limits without making low-frequency observations weak forever', () => {
  const fast = correction(500, 10), slow = correction(500, 150), rail = correction(500, 30, 'rail');
  assert.ok(fast.motion.diagnostics.correctionErrorMeters < slow.motion.diagnostics.correctionErrorMeters);
  assert.ok(slow.motion.diagnostics.correctionErrorMeters < 400);
  assert.ok(fast.maximum <= 40); assert.ok(rail.maximum <= 75);
  assert.ok(rail.motion.diagnostics.renderedProgress <= rail.motion.diagnostics.predictedProgress);
});

test('physical result is stable across sparse and frame-rate position calls', () => {
  const oneHz = correction(500, 30, 'bus', 1000), sixtyHz = correction(500, 30, 'bus', 1000 / 60);
  assert.ok(Math.abs(oneHz.motion.diagnostics.renderedProgress - sixtyHz.motion.diagnostics.renderedProgress) < 1);
  assert.ok(Math.abs(oneHz.maximum - sixtyHz.maximum) < .2);
});

test('a correction behind the displayed bus slows it progressively and never drives it backwards', () => {
  const motion = new GpsMotion();
  motion.update({ at: 0, progress: 0 }, 0, options);
  advance(motion, 0, 120000);
  const before = motion.position(120000)!;
  motion.update({ at: 120000, progress: 1100 }, 120000, options);
  advance(motion, 120000, 125000);
  assert.ok(motion.position(125000)! >= before);
  assert.ok(motion.diagnostics.renderedSpeed < 10);
});

test('invalid source speed and conflicting timestamps do not rejuvenate the last accepted GPS', () => {
  const motion = new GpsMotion();
  motion.update({ at: 0, progress: 0 }, 0, options);
  assert.equal(motion.update({ at: 1000, progress: 1000 }, 1000, options), false);
  assert.equal(motion.diagnostics.sourceTimestamp, 0);
  assert.equal(motion.diagnostics.rejected, 'implausible source speed');
  assert.equal(motion.update({ at: -1, progress: 1 }, 1000, options), false);
  assert.equal(motion.update({ at: NaN, progress: 1 }, 1000, options), false);
});

test('real stopped status and real zero speed override a moving theoretical timetable', () => {
  for (const stop of [{ stopped: true, speed: 10 }, { speed: 0 }]) {
    const motion = new GpsMotion();
    motion.update({ at: 0, progress: 50 }, 0, { ...options, ...stop, timeline: [{ at: 0, progress: 50 }, { at: 10000, progress: 500 }] });
    advance(motion, 0, 20000);
    assert.equal(motion.position(20000), 50);
  }
});

test('observed pace retimes theoretical travel and preserves explicit dwell, while real ETA can update', () => {
  const motion = new GpsMotion();
  motion.update({ at: 0, progress: 0 }, 0, { ...options, timeline: [{ at: 0, progress: 0 }, { at: 10000, progress: 200 }, { at: 20000, progress: 200 }, { at: 30000, progress: 400 }] });
  advance(motion, 0, 10000);
  assert.ok(Math.abs(motion.position(10000)! - 100) < 1);
  advance(motion, 10000, 29000);
  assert.equal(motion.diagnostics.predictedProgress, 200);
  assert.ok(motion.position(29000)! <= 202, 'prediction should brake before passing a known station dwell');
  // A fresh GPS beyond the stop takes precedence over its planned dwell.
  motion.update({ at: 29000, progress: 290 }, 29000, { ...options, timeline: [{ at: 29000, progress: 290 }, { at: 60000, progress: 600 }] });
  assert.equal(motion.diagnostics.sourceTimestamp, 29000);
});

test('fresh arrival forecasts can change the estimate without changing its GPS timestamp or displayed position', () => {
  const motion = new GpsMotion();
  const observation = { at: 0, progress: 0 };
  motion.update(observation, 0, { ...options, realtimeTimetable: true, forecastTimestamp: 1, timeline: [observation, { at: 100000, progress: 1000 }] });
  advance(motion, 0, 10000);
  const before = motion.position(10000);
  motion.update(observation, 10000, { ...options, realtimeTimetable: true, forecastTimestamp: 2, timeline: [observation, { at: 120000, progress: 1000 }] });
  assert.equal(motion.position(10000), before);
  assert.equal(motion.diagnostics.sourceTimestamp, 0);
  motion.position(11000);
  assert.ok(motion.diagnostics.renderedSpeed > 8 && motion.diagnostics.renderedSpeed < 10);
});

test('an overshot realtime stop recovers towards the following stop instead of reversing or parking mid-route', () => {
  const observation = { at: 0, progress: 0 };
  const motion = new GpsMotion();
  motion.update(observation, 0, { ...options, realtimeTimetable: true, forecastTimestamp: 1, timeline: [observation, { at: 100000, progress: 1000 }] });
  advance(motion, 0, 50000);
  const before = motion.position(50000)!;
  motion.update(observation, 50000, { ...options, realtimeTimetable: true, forecastTimestamp: 2, timeline: [observation, { at: 100000, progress: 300 }, { at: 200000, progress: 800 }] });
  advance(motion, 50000, 65000);
  const after = motion.position(65000)!;
  assert.ok(after >= before, 'the vehicle must not reverse towards the revised anchor');
  assert.ok(after - before < 60, `the vehicle travelled ${after - before} m while its ETA target was behind`);
  assert.ok(motion.diagnostics.renderedSpeed > 0 && motion.diagnostics.renderedSpeed < 4);
  assert.equal(motion.diagnostics.recoveringToRealtimeAnchor, true);
  assert.equal(motion.diagnostics.holdingForRealtimeAnchor, false);
  assert.ok(motion.diagnostics.correctionErrorMeters < 0);
});

test('stale recovery is not retroactively applied over the missing interval and shape end is respected', () => {
  const motion = new GpsMotion();
  motion.setEnd(10000); motion.update({ at: 0, progress: 0 }, 0, options);
  motion.position(300000);
  const before = motion.position(300000)!;
  motion.update({ at: 300000, progress: 3000 }, 300000, options);
  assert.equal(motion.position(300000), before);
  assert.ok(motion.position(300100)! - before < 2);
  motion.setEnd(3001);
  advance(motion, 300100, 350100);
  assert.ok(motion.position(350100)! <= 3001);
});

test('schedule/GPS handovers preserve displayed progress; fallback also limits acceleration and correction speed', () => {
  const motion = new GpsMotion({ progress: 400, speed: 6 });
  motion.update({ at: 0, progress: 0 }, 0, options);
  assert.equal(motion.position(0), 400);
  assert.equal(motion.diagnostics.renderedSpeed, 6);
  const next = advanceProgress(400, 6, .1, 4000, 10, 30, 40, 1.2);
  assert.ok(next.progress < 401);
  assert.ok(next.speed <= 6.120001);
  assert.ok(next.correction > 8 && next.correction <= 30);
});

test('a stop report older than a dwell does not keep a bus parked for the whole freshness window', () => {
  const motion = new GpsMotion();
  const observation = { at: 0, progress: 50 };
  // Fix published 90 s late, as Bizkaibus does: the bus already left the stop.
  motion.update(observation, 90000, { ...options, speed: null, stopped: true, realtimeTimetable: true, timeline: [observation, { at: 100000, progress: 1050 }] });
  advance(motion, 90000, 150000);
  assert.ok(motion.diagnostics.predictedProgress > 600, `expected the plan to resume after the dwell, got ${motion.diagnostics.predictedProgress}`);
  assert.ok(motion.position(150000)! > 300);
});

test('a timetable shifted through the GPS fix follows measured interval pace instead of catching up to schedule', () => {
  const observation = { at: 0, progress: 0 };
  // Commercial pace is 5 m/s, but two physical fixes measured 2 m/s in traffic.
  const timeline = [observation, { at: 60000, progress: 300 }, { at: 120000, progress: 600 }];
  const anchored = new GpsMotion();
  anchored.update(observation, 0, { ...options, speed: 2, anchoredTimeline: true, timeline });
  advance(anchored, 0, 60000);
  assert.ok(Math.abs(anchored.diagnostics.predictedProgress - 120) < 1);
  assert.ok(anchored.diagnostics.renderedProgress <= 121, 'static schedule must not pull the bus ahead of its observed pace');
});

test('a first delayed GPS fix without observed pace starts at the fix instead of inventing schedule travel', () => {
  const motion = new GpsMotion();
  const observation = { at: 0, progress: 500 };
  motion.update(observation, 90000, { mode: 'bus', timeline: [observation, { at: 120000, progress: 1700 }], speed: null, anchoredTimeline: true });
  assert.equal(motion.position(90000), 500);
  assert.equal(motion.diagnostics.sourceSpeed, null);
});

test('far behind a fresh observation the vehicle is placed there instead of chasing it for minutes', () => {
  // Artxanda tunnels: drawn at 2200 m, the next observation puts the bus at 4900 m.
  const motion = new GpsMotion();
  motion.update({ at: 0, progress: 1000 }, 60_000, { mode: 'bus', timeline: [], speed: 8 });
  for (let at = 60_000; at <= 150_000; at += 50) motion.position(at);
  motion.update({ at: 150_000, progress: 4900 }, 155_000, { mode: 'bus', timeline: [], speed: 26, previous: { at: 0, progress: 1000 } });
  assert.ok(Math.abs(motion.position(155_000)! - 5030) < 5);
});

test('a bus the operator still lists at a stop waits there instead of running past on its old pace', () => {
  const motion = new GpsMotion();
  // GPS 60 s old at 0 m, 10 m/s: without the stop it would be drawn 600 m on, past the 400 m stop.
  motion.setGate({ progress: 400, sourceTimestamp: 50000 });
  motion.update({ at: 0, progress: 0 }, 60000, options);
  advance(motion, 60000, 120000);
  assert.ok(Math.abs(motion.position(120000)! - 400) < 1);
  // A reading that no longer lists it there lets it go on, without a jump.
  motion.setGate({ progress: 1500, sourceTimestamp: 125000 });
  advance(motion, 120000, 130000);
  const moved = motion.position(130000)!;
  assert.ok(moved > 400 && moved < 520, String(moved));
});

test('an expired or overtaken stop reading never holds the bus, nor drives it backwards', () => {
  const stale = new GpsMotion();
  stale.setGate({ progress: 400, sourceTimestamp: -100000 });
  stale.update({ at: 0, progress: 0 }, 60000, options);
  advance(stale, 60000, 120000);
  assert.ok(stale.position(120000)! > 900, 'a reading older than 90 s says nothing');
  const reached = new GpsMotion();
  reached.setGate({ progress: 400, sourceTimestamp: 50000 });
  reached.update({ at: 55000, progress: 405 }, 60000, options);
  advance(reached, 60000, 90000);
  assert.ok(reached.position(90000)! > 600, 'a fix newer than the reading has it at the stop already');
  const ahead = new GpsMotion();
  ahead.update({ at: 0, progress: 0 }, 60000, options);
  advance(ahead, 60000, 90000);
  const drawn = ahead.position(90000)!;
  ahead.setGate({ progress: drawn - 100, sourceTimestamp: 90000 });
  advance(ahead, 90000, 100000);
  assert.ok(ahead.position(100000)! >= drawn, 'already past the stop it holds where it is');
  assert.ok(ahead.position(100000)! < drawn + 1);
});

test('a bus the panels put further on than its old fix catches up there, and no further than their stop', () => {
  const motion = new GpsMotion();
  // An old fix with the bus stopped at 0 m; the panels have it 600 m on, 400 m before its next stop.
  motion.update({ at: 0, progress: 0 }, 10000, { ...options, speed: 0 });
  advance(motion, 10000, 30000);
  motion.setGate({ progress: 1000, sourceTimestamp: 30000, position: 600 });
  advance(motion, 30000, 90000);
  const drawn = motion.position(90000)!;
  assert.ok(drawn >= 590 && drawn <= 1000, String(drawn));
});
