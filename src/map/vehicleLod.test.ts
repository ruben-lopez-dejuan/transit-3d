import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_CAPACITY, modelLevel, representation, vehicleKind, vehicleScale } from './vehicleLod';
import { TransitRenderer } from './transitRenderer';
import type { Vehicle } from '../transit/networkTypes';
import type { Map as TransitMap } from 'maplibre-gl';

const bus = { mode: 'bus' as const, operatorId: 'bilbobus' };
test('mode silhouettes distinguish bus, suburban train, metro, articulated tram and funicular', () => {
  assert.equal(vehicleKind(bus), 'bus');
  assert.equal(vehicleKind({ mode: 'rail', operatorId: 'renfe' }), 'train');
  assert.equal(vehicleKind({ mode: 'rail', operatorId: 'metro-bilbao' }), 'metro');
  assert.equal(vehicleKind({ mode: 'tram', operatorId: 'euskotren' }), 'tram');
  assert.equal(vehicleKind({ mode: 'funicular', operatorId: 'funicular-artxanda' }), 'funicular');
});

test('LOD has one representation owner, with loading and capacity fallback instead of a partial double fleet', () => {
  assert.equal(representation(10.99, true, 1000), 'icon');
  assert.equal(representation(11, true, MODEL_CAPACITY), 'model');
  assert.equal(representation(18, false, 1), 'icon');
  assert.equal(representation(18, true, MODEL_CAPACITY + 1), 'icon');
  assert.deepEqual([10, 11, 13.9, 14, 15.9, 16, 19].map(modelLevel), ['cluster', 'silhouette', 'silhouette', 'simplified', 'simplified', 'detailed', 'detailed']);
});

test('minimum representation smoothly approaches physical scale, independently of detail thresholds', () => {
  assert.deepEqual(vehicleScale(bus, 19, 43.26), { width: 1, length: 1, height: 1 });
  for (const zoom of [11, 14, 16, 17]) {
    const before = vehicleScale(bus, zoom - .001, 43.26), after = vehicleScale(bus, zoom + .001, 43.26);
    assert.ok(Math.abs(before.length - after.length) / before.length < .002);
    assert.ok(Math.abs(before.width - after.width) / before.width < .002);
    assert.ok(after.width >= 1 && after.length >= 1);
  }
  const metersPerPixel = 40075016.686 * Math.cos(43.26 * Math.PI / 180) / (512 * 2 ** 11);
  assert.ok(Math.abs(vehicleScale(bus, 11, 43.26).length * 12 / metersPerPixel - 18) < .01);
  assert.ok(Math.abs(vehicleScale({ mode: 'rail', operatorId: 'renfe' }, 11, 43.26).length * 71 / metersPerPixel - 36) < .01);
});

test('render preparation hides icons before enabling models and selection keeps other vehicle LOD unchanged', () => {
  const events: string[] = [], layouts = new Map<string, unknown>();
  let zoom = 15, items: { kind: string; scale: unknown; selected: boolean }[] = [], enabled = false;
  const sources = new Map<string, unknown>();
  const map = {
    getSource: (name: string) => ({ setData: (data: unknown) => sources.set(name, data) }),
    isStyleLoaded: () => true, getLayer: () => ({}), getZoom: () => zoom,
    getBounds: () => ({ contains: (coordinate: [number, number]) => coordinate[0] >= 0 }),
    getLayoutProperty: (id: string) => layouts.get(id),
    setLayoutProperty: (id: string, _property: string, value: unknown) => { layouts.set(id, value); events.push('icons:' + value); },
    triggerRepaint: () => {},
  } as unknown as TransitMap;
  const renderer = new TransitRenderer(map);
  Object.assign(renderer, { models: { ready: true, update: (models: typeof items, active: boolean) => { items = models; enabled = active; events.push('models:' + active); } } });
  renderer.operators.add('bilbobus'); renderer.operators.add('metro-bilbao');
  const now = Date.now();
  const vehicle = (id: string, mode: Vehicle['mode'], operatorId: string): Vehicle => ({
    id, mode, operatorId, operatorName: operatorId, tripId: id, routeId: id, routeKey: id, shapeId: 's', shapeKey: 's', serviceDate: '20261002', label: id, headsign: 'Destination', color: '#e73939', directionId: 0, longitude: .01, latitude: 0, bearing: 90, progressMetersAlongShape: 2000, positionQuality: 'scheduled', observationTimestamp: null, predictionTimestamp: now, delaySeconds: null, delayEstimated: false, timeline: [{ at: now - 1000, progress: 2000 }, { at: now + 100000, progress: 3000 }], nextStop: null,
  });
  renderer.shapes.set('s', { key: 's', coordinates: [[0, 0], [.05, 0]], cumulative: [0, 5000], total: 5000 });
  renderer.update([vehicle('b', 'bus', 'bilbobus'), vehicle('m', 'rail', 'metro-bilbao')], now, now);
  const render = () => (renderer as unknown as { render(): void }).render();
  render();
  assert.equal(enabled, true); assert.equal(items.length, 5);
  assert.ok(events.indexOf('icons:none') < events.indexOf('models:true'));
  const other = items.filter((item) => item.kind === 'metro').map((item) => item.scale);
  renderer.selectedId = 'b'; render();
  assert.deepEqual(items.filter((item) => item.kind === 'metro').map((item) => item.scale), other);
  assert.equal(items.length, 5);
  // A large regional fleet must not turn the few cars in a close view into icons.
  const outside = Array.from({ length: MODEL_CAPACITY / 4 + 1 }, (_, index) => ({
    ...vehicle('outside-' + index, 'rail', 'metro-bilbao'),
    shapeKey: 'outside', longitude: -10,
  }));
  zoom = 18;
  renderer.update([vehicle('b', 'bus', 'bilbobus'), vehicle('m', 'rail', 'metro-bilbao'), ...outside], now, now);
  render();
  assert.equal(enabled, true, 'offscreen cars must not disable close 3D');
  assert.equal(items.length, 5);
  assert.equal(renderer.lod, 'detailed');
  assert.equal(renderer.modelFallbackReason, 'none');
  assert.equal(layouts.get('vehicle-icon'), 'none');
  // The safety limit still applies to cars actually in view and is reversible.
  renderer.update(outside.map((v) => ({ ...v, shapeKey: 's', longitude: .01 })), now, now);
  render();
  assert.equal(enabled, false);
  assert.equal(renderer.modelFallbackReason, 'visible-capacity');
  assert.equal(renderer.modelCars, 0);
  assert.equal(layouts.get('vehicle-icon'), 'visible');
  renderer.update([vehicle('b', 'bus', 'bilbobus'), vehicle('m', 'rail', 'metro-bilbao')], now, now);
  render();
  assert.equal(enabled, true);
  assert.equal(items.length, 5);
  zoom = 10; render();
  assert.equal(enabled, false); assert.equal(items.length, 0); assert.equal(layouts.get('vehicle-icon'), 'visible');
});

test('animation start is idempotent and stop releases the only frame request', () => {
  const originalRequest = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
  let requests = 0, canceled = 0;
  globalThis.requestAnimationFrame = () => ++requests;
  globalThis.cancelAnimationFrame = () => { canceled++; };
  try {
    const renderer = new TransitRenderer({} as TransitMap);
    renderer.start(); renderer.start(); assert.equal(requests, 1);
    renderer.stop(); assert.equal(canceled, 1);
    renderer.start(); assert.equal(requests, 2); renderer.stop();
  } finally { globalThis.requestAnimationFrame = originalRequest; globalThis.cancelAnimationFrame = originalCancel; }
});
