import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CENTRE, LEAD, MIDDLE, SINGLE, TAIL, carRole, vehicleParts } from './vehicleShapes';
import { MODEL_FULL_ZOOM, MODEL_MIN_ZOOM } from './vehicleLod';
import type { VehicleBody } from '../../shared/transit/contracts';

const metro: VehicleBody = { cab: 'round', doors: 4, width: 2.8, height: 3.75 };
const euskotren: VehicleBody = { cab: 'sloped', doors: 3, width: 2.6, height: 3.6 };
/** Signed volume of a triangle soup: positive when every face winds outwards. */
function volume(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute('position'), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let sum = 0;
  for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2); sum += a.dot(b.cross(c)) / 6; }
  return sum;
}
const bounds = (geometry: THREE.BufferGeometry) => { geometry.computeBoundingBox(); return geometry.boundingBox!; };

test('a train has a cab at each end: lead and tail cars share the cab, middle cars have gangways', () => {
  assert.deepEqual([0, 1, 2, 3].map((car) => carRole(car, 4)), [LEAD, MIDDLE, MIDDLE | CENTRE, TAIL]);
  assert.equal(carRole(0, 1), SINGLE);
  assert.equal(carRole(1, 3), MIDDLE | CENTRE, 'the middle module of a tram carries its pantograph');
});

test('car bodies are closed, face outwards and keep the real width, roof height and length', () => {
  for (const [kind, body, length] of [['metro', metro, 17.8], ['train', euskotren, 19], ['tram', { cab: 'round', doors: 1, width: 2.4, height: 3.3 }, 8]] as const) {
    const parts = vehicleParts(kind, 'skirt', body, length, .3);
    for (const role of [LEAD, MIDDLE]) {
      const shell = parts.filter((part) => part.on & role && part.minZoom === MODEL_MIN_ZOOM && (part.tinted === 'body' || part.tinted === 'front') && part.maxZoom === undefined);
      const total = shell.reduce((sum, part) => sum + volume(part.geometry), 0);
      assert.ok(total > 0, `${kind} ${role}: outward faces`);
      const box = shell.map((part) => bounds(part.geometry)).reduce((all, b) => all.union(b), new THREE.Box3());
      assert.ok(Math.abs(box.max.x - body.width / 2) < .01, `${kind}: half width`);
      assert.ok(Math.abs(box.max.z - body.height) < .01, `${kind}: roof height`);
      assert.ok(box.max.y < length / 2 && box.max.y > length / 2 - .2, `${kind}: length`);
      // A cab is smaller than the saloon section: shorter roof and narrower nose.
      assert.ok(total < body.width * (body.height - .3) * length, `${kind}: volume below the bounding box`);
    }
  }
});

test('the raked Euskotren nose drops its roof; the metro front stays upright', () => {
  const nose = (body: VehicleBody) => {
    const cab = vehicleParts('train', 'broad', body, 19, .4).find((part) => part.on & LEAD && part.tinted === 'front')!;
    const p = cab.geometry.getAttribute('position'); let top = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 19 / 2 - .15) top = Math.max(top, p.getZ(i));
    return body.height - top;
  };
  assert.ok(nose(euskotren) > 1, 'Euskotren 900: long raked nose');
  assert.ok(nose(metro) < .5, 'Metro Bilbao: rounded upright front');
});

test('pantographs ride the cab cars of a train and the middle module of a tram; the funicular has none', () => {
  const pantographs = (kind: 'metro' | 'tram' | 'funicular', body: VehicleBody) => vehicleParts(kind, 'thin', body, 12, .2).filter((part) => part.color === '#33424a').map((part) => part.on);
  assert.deepEqual(pantographs('metro', metro), [LEAD | TAIL]);
  assert.deepEqual(pantographs('tram', { cab: 'round', doors: 1, width: 2.4, height: 3.3 }), [CENTRE]);
  assert.deepEqual(pantographs('funicular', { cab: 'cabin', doors: 3, width: 2.6, height: 3.1 }), []);
});

test('from a distance the livery shows on the roof, so a Bizkaibus reads green from above', () => {
  const roof = vehicleParts('bus', 'broad', { cab: 'flat', doors: 3, width: 2.55, height: 3.2 }, 12, 0).filter((part) => part.tinted === 'accent' && part.maxZoom === MODEL_FULL_ZOOM);
  assert.equal(roof.length, 1);
  assert.ok(bounds(roof[0].geometry).max.z > 3.2, 'on top of the roof');
  assert.ok(vehicleParts('bus', 'broad', { cab: 'flat', doors: 3, width: 2.55, height: 3.2 }, 12, 0).some((part) => part.tinted === 'accent' && part.minZoom === 11 && part.maxZoom === undefined), 'side band from the first 3D zoom');
});
