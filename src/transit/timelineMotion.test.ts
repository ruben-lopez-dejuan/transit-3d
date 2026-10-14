import assert from 'node:assert/strict';
import test from 'node:test';
import { TimelineMotion } from './timelineMotion';

const old = [{ at: 0, progress: 0 }, { at: 100_000, progress: 1000 }];
const revised = [{ at: 0, progress: 0 }, { at: 60_000, progress: 1000 }];

test('a vehicle drawn for a while ends where a fresh reload draws it', () => {
  const watched = new TimelineMotion(false, 0);
  watched.retime(old, 0);
  for (let at = 0; at <= 30_000; at += 48) watched.position(at);
  // A new ETA moves the train ahead; a page loaded now starts directly there.
  watched.retime(revised, 30_000, watched.position(30_000));
  const reloaded = new TimelineMotion(false, 0);
  reloaded.retime(revised, 30_000);
  for (let at = 30_000; at <= 50_000; at += 48) watched.position(at);
  assert.equal(Math.round(watched.position(50_000)), Math.round(reloaded.position(50_000)));
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
