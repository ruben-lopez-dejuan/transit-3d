import assert from 'node:assert/strict';
import test from 'node:test';
import { progressAt, positionAlong, correctionOffset, positionQuality } from './motion';
import { searchNetwork } from './search';
import { esc, badge, departures, positionExplanation, createShell } from '../ui';
import { chooseCityId, cityUrl } from './cities';
import { loadCities, loadCity, loadNetwork, loadSnapshot, loadShapes } from './client';
import type { Network, Vehicle } from './networkTypes';
import { estimatedBusDwell } from './stopMotion';
import { composition, vehiclePose } from './vehiclePose';
import { bilbaoManifest } from '../../server/cities/es-bilbao/city.manifest';
import { migrateFavorites } from './favorites';
import { entityId } from '../../shared/transit/ids';
import { cityPreferencesKey, parseCityPreferences, readCityPreferences, writeCityPreferences } from './preferences';

test('city selection uses URL, persistence and safe fallback for removed packages', () => {
  const cities = [{ id: 'es-bilbao' }, { id: 'es-test' }];
  assert.equal(chooseCityId(cities, 'es-test', 'es-bilbao', 'es-bilbao'), 'es-test');
  assert.equal(chooseCityId(cities, null, 'es-test', 'es-bilbao'), 'es-test');
  assert.equal(chooseCityId(cities, 'removed', 'removed', 'es-bilbao'), 'es-bilbao');
  assert.equal(chooseCityId(cities, null, null, 'removed'), 'es-bilbao');
  assert.throws(() => chooseCityId([], null, null, 'es-bilbao'));
});
test('city navigation preserves debug flags, origin and hash without duplicating the selection', () => {
  const url = new URL(cityUrl('http://localhost:3001/?debug&city=es-bilbao#map', 'es-test'));
  assert.equal(url.origin, 'http://localhost:3001');
  assert.equal(url.searchParams.has('debug'), true);
  assert.deepEqual(url.searchParams.getAll('city'), ['es-test']);
  assert.equal(url.hash, '#map');
});
test('city preferences remain isolated, validated and recover malformed local storage', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  writeCityPreferences('es-bilbao', { mode: 'rail', operators: ['metro', 'metro'], disabledLayers: ['metro:bus'], underground: false, camera: { center: [-2.93, 43.26], zoom: 14, bearing: 12, pitch: 40 } }, storage);
  assert.deepEqual(readCityPreferences('es-bilbao', storage), { mode: 'rail', operators: ['metro'], disabledLayers: ['metro:bus'], underground: false, camera: { center: [-2.93, 43.26], zoom: 14, bearing: 12, pitch: 40 } });
  assert.deepEqual(readCityPreferences('es-madrid', storage), {});
  values.set(cityPreferencesKey('bad'), '{'); assert.deepEqual(readCityPreferences('bad', storage), {});
  assert.deepEqual(parseCityPreferences({ mode: 'plane', camera: { center: [0, 0], zoom: 80, bearing: 0, pitch: 0 } }), {});
});
test('shell renders an accessible selector, escapes city labels and selects only the active city', () => {
  const other = { ...bilbaoManifest, id: 'es-test', name: '<script>Test</script>' };
  const html = createShell(other, [bilbaoManifest, other]);
  assert.match(html, /aria-label="Ciudad o núcleo urbano"/);
  assert.match(html, /value="es-test" selected/);
  assert.match(html, /&lt;script&gt;Test&lt;\/script&gt;/);
  assert.equal((html.match(/ selected/g) ?? []).length, 1);
  assert.match(createShell(bilbaoManifest), /id="city-picker"/);
});
test('API requests remain scoped to the selected city and reject incompatible packages', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input); calls.push(url);
    const body = url === '/api/cities' ? [bilbaoManifest] : url === '/api/cities/es-bad' ? { ...bilbaoManifest, apiVersion: 2 } : { ...bilbaoManifest, id: url === '/api/cities/es-test' ? 'es-test' : 'es-bilbao' };
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
  try {
    assert.equal((await loadCities())[0].id, 'es-bilbao');
    await loadCity(); await loadNetwork();
    assert.equal(calls.at(-1), '/api/network?cityId=es-bilbao');
    await loadCity('es-test'); await loadSnapshot(); await loadShapes(['shape']);
    assert.equal(calls.at(-2), '/api/transit?cityId=es-test');
    assert.equal(calls.at(-1), '/api/geometries?cityId=es-test');
    await assert.rejects(loadCity('es-bad'), /incompatible/);
    await loadNetwork(); assert.equal(calls.at(-1), '/api/network?cityId=es-test');
  } finally { globalThis.fetch = original; }
});

test('client movement preserves station dwell and clamps the timeline', () => {
  const anchors = [{ at: 0, progress: 0 }, { at: 10000, progress: 1000 }, { at: 20000, progress: 1000 }, { at: 30000, progress: 2000 }];
  assert.equal(progressAt(anchors, -1), 0);
  assert.equal(progressAt(anchors, 5000), 500);
  assert.equal(progressAt(anchors, 15000, true), 1000);
  assert.equal(progressAt(anchors, 40000), 2000);
  assert.equal(progressAt([], 0), null);
  assert.ok(progressAt(anchors, 1000, true)! < progressAt(anchors, 1000)!);
  assert.ok(progressAt(anchors, 9000, true)! > progressAt(anchors, 9000)!);
});
test('rendered positions use cumulative meters and preserve segment bearing', () => {
  const shape = { key: 'op:shape', coordinates: [[0, 0], [.001, 0], [.001, .002]] as [number, number][], cumulative: [0, 100, 300], total: 300 };
  assert.deepEqual(positionAlong(shape, 200)?.coordinate, [.001, .001]);
  assert.equal(positionAlong(shape, 200)?.bearing, 0);
  assert.equal(positionAlong(shape, 50)?.bearing, 90);
  assert.deepEqual(positionAlong(shape, -50)?.coordinate, [0, 0]);
  assert.deepEqual(positionAlong(shape, 900)?.coordinate, [.001, .002]);
});
test('GPS correction starts at the displayed position and gradually removes error', () => {
  assert.equal(correctionOffset(100, 1000, 10000, 1000), 100);
  assert.equal(correctionOffset(100, 1000, 10000, 6000), 50);
  assert.equal(correctionOffset(100, 1000, 10000, 11000), 0);
  assert.equal(correctionOffset(-100, 1000, 10000, 6000), -50);
  const vehicle = { positionQuality: 'live', observationTimestamp: 1000 } as Vehicle;
  assert.equal(positionQuality(vehicle, 46000), 'live');
  assert.equal(positionQuality(vehicle, 46001), 'predicted');
  assert.equal(positionQuality({ ...vehicle, positionQuality: 'scheduled' }, 90000), 'scheduled');
});
const network: Network = {
  city: bilbaoManifest,
  operators: [], places: [{ id: 'mam', name: 'San Mamés', longitude: -2.95, latitude: 43.26 }],
  routes: [
    { id: 'bus:A3', cityId: 'test-city', providerId: 'bus', externalId: 'A3', key: 'bus:A3', operatorId: 'bus', routeId: 'A3', shortName: 'A3', longName: 'San Mamés', mode: 'bus', color: '#246b57', textColor: '#fff', directions: [] },
    { id: 'rail:A3', cityId: 'test-city', providerId: 'rail', externalId: 'A3', key: 'rail:A3', operatorId: 'rail', routeId: 'A3', shortName: 'A3', longName: 'Rail', mode: 'rail', color: '#246b57', textColor: '#fff', directions: [] },
  ],
  stops: [{ id: 'rail:s', cityId: 'test-city', providerId: 'rail', externalId: 's', key: 'rail:s', operatorId: 'rail', stopId: 's', name: 'San Mamés', modes: ['rail'], longitude: -2.95, latitude: 43.26 }],
};

test('estimated bus stops preserve published arrival times and existing explicit dwell', () => {
  const anchors = [{ at: 0, progress: 0 }, { at: 120000, progress: 1000 }, { at: 240000, progress: 2000 }];
  const dwell = estimatedBusDwell(anchors);
  assert.equal(progressAt(dwell, 123000, true), 1000);
  assert.equal(progressAt(dwell, 240000, true), 2000);
  assert.deepEqual(estimatedBusDwell(dwell), dwell);
});

test('rail cars follow different tangents around curves, with opposite directions separated', () => {
  const shape = { key: 's', coordinates: [[0, 0], [.001, 0], [.001, .001]] as [number, number][], cumulative: [0, 100, 200], total: 200, underground: [{ from: 0, to: 200, depthMeters: 12, approximate: true }] };
  const vehicle = { mode: 'rail', operatorId: 'metro-bilbao', label: 'L1' } as const;
  assert.equal(vehiclePose(shape, 120, vehicle)?.bearing, 0);
  assert.equal(vehiclePose(shape, 80, vehicle)?.bearing, 90);
  assert.equal(vehiclePose(shape, 100, vehicle)?.altitude, -12);
  assert.equal(composition(vehicle).count, 4);
  const reverse = { ...shape, coordinates: [...shape.coordinates].reverse() };
  assert.notDeepEqual(vehiclePose(shape, 50, vehicle)?.coordinate, vehiclePose(reverse, 150, vehicle)?.coordinate);
});

test('search ranks exact route codes, handles accents, and respects mode/operator filters', () => {
  const first = searchNetwork(network, 'a3', 'bus', new Set(['bus', 'rail']))[0];
  assert.equal(first.type, 'route');
  assert.equal(first.type === 'route' && first.item.key, 'bus:A3');
  const results = searchNetwork(network, 'San Mames', 'rail', new Set(['rail']));
  assert.deepEqual(results.map((r) => r.type), ['stop', 'place']);
  assert.equal(searchNetwork(network, 'a3', 'all', new Set()).length, 0);
  assert.equal(searchNetwork(network, '', 'all', new Set(['bus'])).length, 0);
});
test('feed strings cannot inject HTML or CSS through labels and route badges', () => {
  assert.equal(esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  const html = badge({ color: 'red;position:fixed', shortName: '<script>' });
  assert.ok(html.includes('--line:#176955'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('position:fixed'));
});

test('Realtime timetables show freshness, delay and cancellation, reverting stale updates to schedule', () => {
  const at = Date.now() + 600_000;
  const row = { routeKey: 'renfe:r', tripId: 't', label: 'C1', headsign: 'Abando', operatorId: 'renfe', at, scheduledAt: at - 120_000, source: 'realtime' as const, updatedAt: at - 610_000, quality: 'predicted' as const, delaySeconds: 120 };
  const html = departures([row], () => 'Renfe', at - 600_000);
  assert.ok(html.includes('Tiempo real')); assert.ok(html.includes('+2 min')); assert.ok(html.includes('Actualizado hace 10 s'));
  assert.ok(departures([{ ...row, canceled: true }], () => 'Renfe', at - 600_000).includes('Cancelado'));
  const stale = departures([row], () => 'Renfe', at);
  assert.ok(stale.includes('Sin actualización reciente')); assert.ok(!stale.includes('Tiempo real'));
});
test('A position predicted from TripUpdates does not claim to have a GPS signal', () => {
  const v = { positionQuality: 'predicted', observationTimestamp: null, timetableTimestamp: 1000 } as Vehicle;
  assert.ok(positionExplanation(v, 16000).includes('hace 15 s'));
  assert.ok(!positionExplanation(v, 16000).includes('Último GPS'));
});

test('favorite migration preserves saved lines/stops, unknown references and existing namespaced IDs', () => {
  const catalog = { routes: network.routes.map((route) => ({ ...route, key: entityId(route.cityId, route.providerId, 'route', route.externalId) })), stops: network.stops.map((stop) => ({ ...stop, key: entityId(stop.cityId, stop.providerId, 'stop', stop.externalId) })) };
  const saved = new Set(['route:bus:A3', 'stop:rail:s', 'route:unavailable:r', `route:${catalog.routes[0].key}`]);
  const migrated = migrateFavorites(saved, catalog);
  assert.deepEqual([...migrated], [`route:${catalog.routes[0].key}`, `stop:${catalog.stops[0].key}`, 'route:unavailable:r']);
  assert.deepEqual(migrateFavorites(migrated, catalog), migrated);
  assert.equal(saved.size, 4);
});
