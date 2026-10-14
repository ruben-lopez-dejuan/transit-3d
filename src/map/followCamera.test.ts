import assert from 'node:assert/strict';
import test from 'node:test';
import { FollowCamera } from './followCamera';

const padding = { top: 0, bottom: 0, left: 0, right: 0 };
function fakeMap() {
  const calls: string[] = [];
  let zooming = false;
  return { calls, setZooming: (value: boolean) => { zooming = value; }, map: { easeTo: () => calls.push('ease'), jumpTo: () => calls.push('jump'), isZooming: () => zooming, isRotating: () => false } };
}

test('following eases once to the vehicle and then locks the camera on every frame', () => {
  const fake = fakeMap();
  const camera = new FollowCamera(fake.map);
  assert.equal(camera.update([0, 0], 0, padding, 600), 'ease');
  assert.equal(camera.update([0, 0], 300, padding, 600), 'wait');
  for (let at = 600; at <= 2000; at += 48) assert.equal(camera.update([at, 0], at, padding, 600), 'lock');
  assert.equal(fake.calls.filter((call) => call === 'ease').length, 1, 'no repeated eases that accelerate and brake the camera');
});
test('a user zoom is not interrupted, and reset eases back to the vehicle', () => {
  const fake = fakeMap();
  const camera = new FollowCamera(fake.map);
  camera.update([0, 0], 0, padding, 0);
  fake.setZooming(true);
  assert.equal(camera.update([1, 0], 100, padding, 0), 'wait');
  fake.setZooming(false);
  assert.equal(camera.update([1, 0], 200, padding, 0), 'lock');
  camera.reset();
  assert.equal(camera.update([1, 0], 300, padding, 0), 'ease');
});
