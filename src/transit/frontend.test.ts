import assert from 'node:assert/strict';
import test from 'node:test';
import { progressAt, positionAlong, correctionOffset, positionQuality, nextStopAhead } from './motion';
import { searchNetwork } from './search';
import { esc, badge, departures, positionExplanation, createShell, arrivalLabel, consistentArrival } from '../ui';
import { chooseCityId, cityUrl } from './cities';
import { loadCities, loadCity, loadNetwork, loadSnapshot, loadShapes } from './client';
import type { Network, Vehicle } from './networkTypes';
import { estimatedBusDwell } from './stopMotion';
import { composition, leadProgress, reversals, vehiclePose, trackDepth, CUTTING_METERS, COVER_METERS } from './vehiclePose';
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
  assert.match(html, /id="sheet-handle"[^>]+aria-expanded="true"/);
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
test('the next stop follows rendered progress instead of an older server snapshot', () => {
  const stops = [{ id: 'already-passed', progress: 100 }, { id: 'next', progress: 200 }];
  assert.equal(nextStopAhead(stops, 150)?.id, 'next');
  assert.equal(nextStopAhead(stops, 205), undefined);
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
  const shape = { key: 's', coordinates: [[0, 0], [.001, 0], [.001, .001]] as [number, number][], cumulative: [0, 100, 200], total: 200, underground: [{ from: 0, to: 200, depthMeters: 12, approximate: true, tunnelBeforeStart: true, tunnelAfterEnd: true }] };
  const vehicle = { mode: 'rail', operatorId: 'metro-bilbao', label: 'L1' } as const;
  assert.equal(vehiclePose(shape, 120, vehicle)?.bearing, 0);
  assert.equal(vehiclePose(shape, 80, vehicle)?.bearing, 90);
  assert.ok(Math.abs(vehiclePose(shape, 100, vehicle)!.bearing - 45) < 1, 'at the vertex a car is halfway through the turn');
  assert.equal(vehiclePose(shape, 100, vehicle)?.altitude, -12);
  assert.equal(composition(vehicle).count, 4);
  const reverse = { ...shape, coordinates: [...shape.coordinates].reverse() };
  assert.notDeepEqual(vehiclePose(shape, 50, vehicle)?.coordinate, vehiclePose(reverse, 150, vehicle)?.coordinate);
});

test('on a stretch drawn on its own track a train keeps no lateral offset, and slides onto it', () => {
  // 2 km east; the middle kilometre is matched onto the OSM track (Euskotren Matiko – Kukullaga).
  const shape = { key: 's', coordinates: [[0, 0], [.018, 0]] as [number, number][], cumulative: [0, 2003.8], total: 2003.8, onTrack: [{ from: 500, to: 1500 }] };
  const vehicle = { mode: 'rail', operatorId: 'euskotren', label: 'E1', appearance: { kind: 'train', composition: { count: 4, length: 19, gap: .4 }, lateralOffsetMeters: 1.7 } } as const;
  const offset = (progress: number, scale = 1) => 0 - vehiclePose(shape, progress, vehicle, scale)!.coordinate[1] * 110540;
  assert.equal(offset(1000), 0);
  assert.equal(offset(500), 0);
  assert.ok(Math.abs(offset(300) - 1.7) < 1e-6, 'off the stretch it keeps its offset to the right');
  assert.ok(offset(480) > 0 && offset(480) < offset(470) && offset(470) < 1.7, 'it slides onto the track');
  // Zoomed out the offset widens with the model; on its own track only by the widening, towards
  // the side trains run on there (right by default), so two widened trams do not overlap.
  assert.ok(Math.abs(offset(1000, 10) - 1.7 * 9) < 1e-6);
  const left = { ...shape, onTrack: [{ from: 500, to: 1500, runsOn: 'left' as const }] };
  assert.ok(Math.abs(0 - vehiclePose(left, 1000, vehicle, 10)!.coordinate[1] * 110540 + 1.7 * 9) < 1e-6, 'Euskotren runs on the left');
  const tram = { mode: 'tram', operatorId: 'euskotren', label: 'TR', appearance: { kind: 'tram', composition: { count: 3, length: 8, gap: .2 }, lateralOffsetMeters: 0 } } as const;
  assert.ok(Math.abs(0 - vehiclePose(shape, 1000, tram, 4)!.coordinate[1] * 110540 - 1.7 * 3) < 1e-6);
});

test('a train backs out of a dead end led by its last car, without folding over the turn', () => {
  // E3 at Sondika: 500 m west into the platform and back east the same way.
  const shape = { key: 's', coordinates: [[0, 0], [-.0045, 0], [0, .00001]] as [number, number][], cumulative: [0, 500, 1000], total: 1000 };
  const vehicle = { mode: 'rail', operatorId: 'euskotren', label: 'E3', appearance: { kind: 'train', composition: { count: 3, length: 19, gap: .4 }, lateralOffsetMeters: -1.7 } } as const;
  assert.deepEqual(reversals(shape), [500]);
  // At the platform the head car points the way it came in, not across the track.
  assert.equal(Math.round(vehiclePose(shape, 500, vehicle)!.bearing), 270);
  assert.equal(Math.round(vehiclePose(shape, 501, vehicle)!.bearing), 90);
  const length = 2 * 19.4, cars = (progress: number) => { const lead = leadProgress(shape, progress, length); return [0, 1, 2].map((car) => vehiclePose(shape, lead - car * 19.4, vehicle)!.coordinate[0]).sort((a, b) => a - b); };
  // Leaving, the train is where it stood: the same places, the last car now leading.
  cars(500).forEach((longitude, i) => assert.ok(Math.abs(longitude - cars(499.999)[i]) < 1e-6));
  assert.ok(cars(500.1).every((longitude) => longitude > -.0045 - 1e-9), 'no car is left on the way in');
  assert.ok(leadProgress(shape, 520, length) > leadProgress(shape, 510, length), 'it moves on');
  assert.equal(leadProgress(shape, 500 + 3 * length, length), 500 + 3 * length, 'three lengths on it is back on the timeline');
  // Along the dead end it keeps no offset, which would swap sides as it turns.
  assert.equal(0 - vehiclePose(shape, 450, vehicle)!.coordinate[1], 0);
});

test('a train goes down a cutting into the tunnel mouth smoothly, car after car', () => {
  // 2 km straight, with a portal at 1000 m and the tunnel running on past the end of the shape.
  const shape = { key: 's', coordinates: [[0, 0], [.018, 0]] as [number, number][], cumulative: [0, 2003.8], total: 2003.8, underground: [{ from: 1000, to: 2003.8, depthMeters: 12, approximate: true, tunnelAfterEnd: true }] };
  const vehicle = { mode: 'rail', operatorId: 'metro-bilbao', label: 'L1' } as const;
  const pose = (progress: number) => vehiclePose(shape, progress, vehicle)!;
  assert.equal(pose(1000 - CUTTING_METERS - 1).altitude, 0, 'level track before the cutting');
  assert.equal(pose(2000).altitude, -12);
  const portal = pose(1000);
  assert.ok(-portal.altitude >= COVER_METERS - .3 && -portal.altitude <= COVER_METERS + .6, 'at the mouth the roof is just under ground');
  assert.ok(pose(980).buried > 0 && pose(980).buried < 1 && !pose(980).underground, 'in the cutting a car is partly below ground');
  assert.ok(pose(1010).underground);
  let previous = pose(800);
  for (let progress = 801; progress <= 1400; progress++) {
    const next = pose(progress);
    assert.ok(next.altitude <= previous.altitude, 'always going down');
    assert.ok(previous.altitude - next.altitude < .06, 'no steps steeper than 6 %');
    assert.ok(next.slope >= 0 && next.slope < .06);
    previous = next;
  }
  // A four-car train straddling the mouth: the cars go in one after another.
  const cars = [0, 1, 2, 3].map((car) => pose(1010 - car * 18.1).buried);
  assert.ok(cars[0] === 1 && cars.every((buried, car) => car === 0 || buried < cars[car - 1]), String(cars));
  assert.equal(trackDepth(shape, 2003.8).depth, 12, 'no portal at an underground terminus');
});
test('two tunnels close together keep the train down in between instead of surfacing', () => {
  const shape = { key: 's', coordinates: [[0, 0], [.018, 0]] as [number, number][], cumulative: [0, 2003.8], total: 2003.8, underground: [{ from: 200, to: 900, depthMeters: 12, approximate: true }, { from: 1000, to: 1800, depthMeters: 12, approximate: true }] };
  assert.ok(trackDepth(shape, 950).depth > 2, 'a 100 m open cutting between two tunnels');
  assert.equal(trackDepth(shape, 1999).depth, 0);
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
test('A train standing at the platform is "Ahora" until it leaves, not "1 min"', () => {
  const now = Date.now(), at = now + 16_000;
  const row = { routeKey: 'metro:r', tripId: 't', label: 'L1', headsign: 'Plentzia', operatorId: 'metro', at, arrivalAt: now - 8_000, scheduledAt: at, source: 'realtime' as const, updatedAt: now - 60_000, quality: 'predicted' as const, delaySeconds: 0 };
  assert.ok(departures([row], () => 'Metro', now).includes('<strong>Ahora</strong>'));
  // Still on its way: the minutes count to the arrival, not to the departure.
  assert.ok(departures([{ ...row, arrivalAt: now + 100_000, at: now + 124_000 }], () => 'Metro', now).includes('<strong>2 min</strong>'));
});
test('A position predicted from TripUpdates does not claim to have a GPS signal', () => {
  const v = { positionQuality: 'predicted', observationTimestamp: null, timetableTimestamp: 1000 } as Vehicle;
  assert.equal(positionExplanation(v, 16000), 'Sin GPS · previsión hace 15 s');
});

test('the position line is short and always gives the age of its data in seconds', () => {
  const v = { positionQuality: 'predicted', observationTimestamp: null, timetableTimestamp: 1000, timelineSource: 'siri' } as Vehicle;
  assert.equal(positionExplanation(v, 16000), 'Sin GPS · previsión hace 15 s');
  assert.equal(positionExplanation({ ...v, observationTimestamp: 6000 }, 77000), 'GPS hace 71 s');
  assert.equal(positionExplanation({ ...v, observationTimestamp: 6000, tripIdentityQuality: 'estimated' } as Vehicle, 77000), 'GPS hace 71 s · servicio sin confirmar');
});

test('"Llegando" only for a bus drawn at the stop, unless the operator itself says it is arriving', () => {
  const now = 1_000_000;
  assert.equal(consistentArrival(now - 5000, now, true, 1200, 10), now - 5000, 'an official 0 minutes stands');
  assert.equal(consistentArrival(now - 5000, now, false, 100, 10), now - 5000, 'an estimate due with the bus at the stop');
  assert.equal(consistentArrival(now - 5000, now, false, 750, 10), now + 75_000, 'an estimate due 750 m away: 75 s at 10 m/s');
  assert.equal(consistentArrival(now + 60_000, now, false, 750, 10), now + 60_000);
});

test('a next-stop forecast already due reads as arriving, not as a time in the past', () => {
  assert.equal(arrivalLabel(1000, 5000), 'Llegando');
  assert.equal(arrivalLabel(5000 + 125_000, 5000), '3 min');
});

test('favorite migration preserves saved lines/stops, unknown references and existing namespaced IDs', () => {
  const catalog = { routes: network.routes.map((route) => ({ ...route, key: entityId(route.cityId, route.providerId, 'route', route.externalId) })), stops: network.stops.map((stop) => ({ ...stop, key: entityId(stop.cityId, stop.providerId, 'stop', stop.externalId) })) };
  const saved = new Set(['route:bus:A3', 'stop:rail:s', 'route:unavailable:r', `route:${catalog.routes[0].key}`]);
  const migrated = migrateFavorites(saved, catalog);
  assert.deepEqual([...migrated], [`route:${catalog.routes[0].key}`, `stop:${catalog.stops[0].key}`, 'route:unavailable:r']);
  assert.deepEqual(migrateFavorites(migrated, catalog), migrated);
  assert.equal(saved.size, 4);
});
