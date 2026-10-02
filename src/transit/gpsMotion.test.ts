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

test('bounded corrections converge without traveling a two-minute error in five seconds', () => {
  const motion = new GpsMotion();
  motion.update({ at: 0, progress: 0 }, 0, options);
  advance(motion, 0, 120000);
  motion.update({ at: 120000, progress: 1400 }, 120000, options);
  const initial = motion.diagnostics.correctionErrorMeters;
  advance(motion, 120000, 240000);
  assert.ok(motion.diagnostics.correctionErrorMeters < initial * .5);
  assert.ok(motion.diagnostics.renderedSpeed < 13.51);
  assert.ok(motion.diagnostics.renderedProgress > 2400);
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
  assert.ok(next.correction <= 3.5);
});
