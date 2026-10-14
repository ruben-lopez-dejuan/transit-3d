import assert from 'node:assert/strict';
import test from 'node:test';
import { TimelineMotion } from './timelineMotion';

const old = [{ at: 0, progress: 0 }, { at: 100_000, progress: 1000 }];
const revised = [{ at: 0, progress: 0 }, { at: 60_000, progress: 1000 }];

test('a vehicle drawn for a while ends where a fresh reload draws it', () => {
  const slow = [{ at: 0, progress: 0 }, { at: 200_000, progress: 1000 }], fast = [{ at: 0, progress: 0 }, { at: 120_000, progress: 1000 }];
  const watched = new TimelineMotion(false, 0);
  watched.retime(slow, 0);
  for (let at = 0; at <= 30_000; at += 48) watched.position(at);
  // A new ETA moves the train 100 m ahead; a page loaded now starts directly there.
  watched.retime(fast, 30_000, watched.position(30_000));
  const reloaded = new TimelineMotion(false, 0);
  reloaded.retime(fast, 30_000);
  for (let at = 30_000; at <= 70_000; at += 48) watched.position(at);
  assert.ok(Math.abs(watched.position(70_000) - reloaded.position(70_000)) < 2);
});
test('a revision ahead is caught up gently, not with a lurch', () => {
  const slow = [{ at: 0, progress: 0 }, { at: 200_000, progress: 1000 }], fast = [{ at: 0, progress: 0 }, { at: 120_000, progress: 1000 }];
  const motion = new TimelineMotion(false, 0);
  motion.retime(slow, 0);
  const before = motion.position(30_000);
  motion.retime(fast, 30_000, before);
  let last = before, fastest = 0;
  for (let at = 30_048; at <= 90_000; at += 48) { const p = motion.position(at); fastest = Math.max(fastest, (p - last) / .048); last = p; }
  // The timeline itself runs at 8.3 m/s; the catch-up adds at most 1.5 × 3 m/s.
  assert.ok(fastest < 8.4 + 4.6, `peak ${fastest.toFixed(1)} m/s`);
});
test('a revision behind the drawn vehicle never runs it backwards', () => {
  const motion = new TimelineMotion(false, 0);
  motion.retime(revised, 0);
  motion.position(30_000);
  const before = motion.position(30_000);
  motion.retime(old, 30_000, before);
  let last = before;
  for (let at = 30_000; at <= 80_000; at += 100) { const p = motion.position(at); assert.ok(p >= last); last = p; }
  assert.equal(Math.round(motion.position(90_000)), 900);
});
test('a new timeline changes the speed gradually, not at once', () => {
  // The old timeline has the train dwelling; the new one has it already moving at 10 m/s.
  const dwelling = [{ at: 0, progress: 500 }, { at: 60_000, progress: 500 }, { at: 120_000, progress: 1100 }];
  const moving = [{ at: 0, progress: 0 }, { at: 100_000, progress: 1000 }];
  const before = new TimelineMotion(true, 0);
  before.retime(dwelling, 0);
  for (let at = 0; at <= 50_000; at += 48) before.position(at);
  const after = new TimelineMotion(true, 0);
  after.retime(moving, 50_000, before.position(50_000), before);
  let last = after.position(50_000), previousSpeed = 0, harshest = 0;
  for (let at = 50_048; at <= 80_000; at += 48) {
    const p = after.position(at), speed = (p - last) / .048;
    harshest = Math.max(harshest, Math.abs(speed - previousSpeed) / .048);
    previousSpeed = speed; last = p;
  }
  assert.ok(harshest < 2, `acceleration ${harshest.toFixed(2)} m/s²`);
});
