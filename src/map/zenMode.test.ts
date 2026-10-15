import assert from 'node:assert/strict';
import test from 'node:test';
import { isZenShortcut, zenHiddenLayers, ZenLayers } from './zenMode';

const style = [
  { id: 'background', type: 'background' },
  { id: 'water', type: 'fill' },
  { id: 'highway_name_other', type: 'symbol', layout: { 'text-field': '{name}', visibility: 'visible' } },
  { id: 'place_city', type: 'symbol', layout: { 'text-field': '{name}' } },
  { id: 'poi_hidden', type: 'symbol', layout: { 'text-field': '{name}', visibility: 'none' } },
  { id: 'transit-buildings', type: 'fill-extrusion' },
  { id: 'route-line', type: 'line' },
  { id: 'stations', type: 'circle' },
  { id: 'bus-stops', type: 'circle' },
  { id: 'stop-labels', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
  { id: 'selected-stops-dot', type: 'circle' },
  { id: 'selected-stops-label', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
  { id: 'clusters', type: 'circle' },
  { id: 'cluster-count', type: 'symbol', layout: { 'text-field': ['get', 'point_count_abbreviated'] } },
  { id: 'vehicle-icon', type: 'symbol', layout: { 'icon-image': ['get', 'icon'] } },
  { id: 'vehicle-label', type: 'symbol', layout: { 'text-field': ['get', 'label'] } },
  { id: 'location-dot', type: 'circle' },
];

test('zen hides every text on the map and the stop dots, never the vehicles', () => {
  assert.deepEqual(zenHiddenLayers(style), ['highway_name_other', 'place_city', 'poi_hidden', 'stations', 'bus-stops', 'stop-labels', 'selected-stops-label', 'cluster-count', 'vehicle-label']);
});

function fakeMap(layers: typeof style) {
  const visibility = new Map(layers.map((layer) => [layer.id, (layer.layout as { visibility?: string } | undefined)?.visibility]));
  return {
    visibility,
    getStyle: () => ({ layers }),
    getLayer: (id: string) => visibility.has(id) ? {} : undefined,
    getLayoutProperty: (id: string) => visibility.get(id),
    setLayoutProperty: (id: string, _name: string, value: unknown) => { visibility.set(id, value as string); },
  };
}

test('leaving zen gives each layer back its own visibility', () => {
  const map = fakeMap(style), zen = new ZenLayers();
  zen.apply(map, true);
  assert.equal(map.visibility.get('vehicle-label'), 'none');
  assert.equal(map.visibility.get('place_city'), 'none');
  assert.equal(map.visibility.get('vehicle-icon'), undefined);
  zen.apply(map, true); // applying again (new layers after a style load) keeps the first saved state
  zen.apply(map, false);
  assert.equal(map.visibility.get('vehicle-label'), 'visible');
  assert.equal(map.visibility.get('highway_name_other'), 'visible');
  assert.equal(map.visibility.get('poi_hidden'), 'none', 'a basemap layer hidden by its style stays hidden');
});

test('after a theme change the new style is hidden and restored on its own terms', () => {
  const zen = new ZenLayers();
  zen.apply(fakeMap(style), true);
  const next = fakeMap(style.filter((layer) => layer.id !== 'place_city'));
  zen.reset(); zen.apply(next, true); zen.apply(next, false);
  assert.equal(next.visibility.get('stop-labels'), 'visible');
  assert.equal(next.visibility.has('place_city'), false);
});

test('Z toggles zen except while typing or with modifiers', () => {
  const key = (key: string, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...extra });
  assert.equal(isZenShortcut(key('z'), { tagName: 'BODY' }), true);
  assert.equal(isZenShortcut(key('Z'), { tagName: 'CANVAS' }), true);
  assert.equal(isZenShortcut(key('z'), { tagName: 'INPUT' }), false);
  assert.equal(isZenShortcut(key('z'), { tagName: 'DIV', isContentEditable: true }), false);
  assert.equal(isZenShortcut(key('z', { ctrlKey: true }), { tagName: 'BODY' }), false);
  assert.equal(isZenShortcut(key('z', { repeat: true }), { tagName: 'BODY' }), false);
  assert.equal(isZenShortcut(key('x'), { tagName: 'BODY' }), false);
});
