import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { bearing, extendShape, extendToTerminals, moveToPlatforms, onTrackStretches, rejectRoute, replaceCorridor, routeStraightSegments, segmentKey, trimRoute, simplifyPath, straightMeters, type Corridor, type ShapeExtension } from './routedSegments';
import type { GtfsShapePoint } from '../providers/bizkaibus/gtfs';
import { RAIL_TRACKS_FILE } from './trackMatching';

const shape = (points: [number, number][]): GtfsShapePoint[] => points.map(([longitude, latitude], i) => ({ longitude, latitude, sequence: i + 1 }));
const coordinates = (points: GtfsShapePoint[]) => points.map((p) => [p.longitude, p.latitude]);

// Euskotren E3 in miniature: Larrondo → Sondika → west to Lutxana → straight jump back to Ola → Matiko.
const LARRONDO: [number, number] = [-2.935, 43.303], SONDIKA: [number, number] = [-2.9282, 43.2983];
const LUTXANA: [number, number] = [-2.9698, 43.2912], OLA: [number, number] = [-2.9251, 43.2918], MATIKO: [number, number] = [-2.9255, 43.269];
const corridor: Corridor = { operatorId: 'euskotren', name: 'Sondika – Matiko', path: [SONDIKA, OLA, [-2.926, 43.28], MATIKO] };

test('a rail shape that detours to a dead end follows the known corridor instead, in both directions', () => {
  const published = shape([LARRONDO, SONDIKA, [-2.95, 43.295], LUTXANA, OLA, MATIKO]);
  const repaired = replaceCorridor(published, corridor)!;
  assert.deepEqual(coordinates(repaired), [LARRONDO, ...corridor.path]);
  assert.deepEqual(repaired.map((p) => p.sequence), [1, 2, 3, 4, 5]);
  const reversed = replaceCorridor(shape([MATIKO, OLA, LUTXANA, [-2.95, 43.295], SONDIKA, LARRONDO]), corridor)!;
  assert.deepEqual(coordinates(reversed), [...[...corridor.path].reverse(), LARRONDO]);
});

test('a shape already following the corridor, or not reaching both ends, is left alone', () => {
  assert.equal(replaceCorridor(shape([LARRONDO, SONDIKA, OLA, [-2.9258, 43.28], MATIKO]), corridor), null);
  assert.equal(replaceCorridor(shape([LUTXANA, [-2.95, 43.295], SONDIKA]), corridor), null);
});

test('a shape that stops short of its trip continues along the extension; one ending elsewhere is left alone', () => {
  // Metro Bilbao IBB_BSR in miniature: the shape ends at Etxebarri, the trip runs on to Ariz and Basauri.
  const bolueta: [number, number] = [-2.9187, 43.2476], etxebarri: [number, number] = [-2.89833, 43.24392];
  const extension: ShapeExtension = { operatorId: 'metro-bilbao', shapeId: 'IBB_BSR', name: 'Etxebarri – Basauri', path: [[-2.89846, 43.24396], [-2.8812, 43.2398], [-2.8943, 43.2366]] };
  const repaired = extendShape(shape([bolueta, etxebarri]), extension)!;
  assert.deepEqual(coordinates(repaired), [bolueta, etxebarri, ...extension.path.slice(1)]);
  assert.deepEqual(repaired.map((p) => p.sequence), [1, 2, 3, 4]);
  assert.equal(extendShape(shape([etxebarri, bolueta]), extension), null);
});

test('a rail shape ending short of its terminal platforms follows the track of another shape to them', () => {
  // Euskotren E1 in miniature: Durango → Traña-Abadiño, the short working ends about 350 m before Traña.
  const track: [number, number][] = [[-2.6347, 43.1695], [-2.625, 43.1699], [-2.6157, 43.1666], [-2.6139, 43.1658], [-2.6121, 43.1651], [-2.6054, 43.164]];
  const traña: [number, number] = [-2.612, 43.16512], durango: [number, number] = [-2.6347, 43.1695];
  const short = shape([[-2.625, 43.1699], track[2]]);
  const repaired = extendToTerminals(short, { first: durango, last: traña }, [shape(track)])!;
  assert.deepEqual(coordinates(repaired), track.slice(0, 5));
  // The opposite direction's track works too, and the shape is reversed to match the trip.
  const reversed = extendToTerminals(shape([track[2], [-2.625, 43.1699]]), { first: traña, last: durango }, [shape([...track].reverse())])!;
  assert.deepEqual(coordinates(reversed), track.slice(0, 5).reverse());
  assert.deepEqual(coordinates(extendToTerminals(shape([track[2], [-2.625, 43.1699]]), { first: traña, last: durango }, [shape(track)])!), track.slice(0, 5).reverse());
});

test('a shape already reaching its terminals, or without a track through them, is left alone', () => {
  const track: [number, number][] = [[-2.6347, 43.1695], [-2.625, 43.1699], [-2.6157, 43.1666], [-2.6121, 43.1651]];
  assert.equal(extendToTerminals(shape(track), { first: track[0], last: track[3] }, [shape(track)]), null);
  assert.equal(extendToTerminals(shape(track.slice(0, 3)), { first: track[0], last: [-2.6, 43.18] }, [shape(track)]), null);
});

test('straight segments with a routed road get its curve; the feed points are kept', () => {
  const bilbao: [number, number] = [-2.94963, 43.26137], vitoria: [number, number] = [-2.685659, 42.858622], next: [number, number] = [-2.682499, 42.844554];
  const road: [number, number][] = [bilbao, [-2.9, 43.2], [-2.75, 42.95], vitoria];
  const repaired = routeStraightSegments(shape([bilbao, vitoria, next]), { [segmentKey(bilbao, vitoria)]: road })!;
  assert.deepEqual(coordinates(repaired), [...road, next]);
  assert.equal(routeStraightSegments(shape([vitoria, next]), { [segmentKey(bilbao, vitoria)]: road }), null);
});

test('a road route is kept unless it loops or ends far from the stops', () => {
  assert.equal(rejectRoute({ straight: 2000, route: 4000, snap: 20 }), null);
  // Alavabus 19B Marañón – Bujanda: 5.8 km apart, 17.4 km by road around the hills.
  assert.equal(rejectRoute({ straight: 5768, route: 17414, snap: 30 }), null);
  assert.equal(rejectRoute({ straight: 5879, route: 9700, snap: 237 }), null);
  // PESA DG05: 1.4 km apart, 23.5 km by the only connected road in OSM.
  assert.equal(rejectRoute({ straight: 1420, route: 23504, snap: 3 }), 'ruta 23504 m para 1420 m en línea recta');
  assert.equal(rejectRoute({ straight: 2000, route: 3000, snap: 400 }), 'extremo a 400 m de la carretera');
});

test('a route to the next point is cut where it passes the point OSRM snapped elsewhere', () => {
  // PESA DG05 in the AP-1 Zarimutz tunnel: B lies under a surface lane, so the route goes A → C and is cut at B.
  const a: [number, number] = [-2.60226, 42.97121], b: [number, number] = [-2.5906, 42.9807], c: [number, number] = [-2.58401, 42.98611];
  const route: [number, number][] = [a, [-2.596, 42.976], [-2.588, 42.9832], c];
  const { path, miss } = trimRoute(route, a, b);
  assert.deepEqual(path.slice(0, 2), [a, [-2.596, 42.976]]);
  assert.equal(path.length, 3);
  assert.ok(straightMeters(path[2], b) < 40 && miss < 40);
  assert.equal(trimRoute(route, a, [-2.6, 43]).miss > 2000, true);
});

test('bearings point in the direction of travel', () => {
  assert.equal(bearing([-2.9, 43.2], [-2.9, 43.3]), 0);
  assert.equal(bearing([-2.9, 43.2], [-2.8, 43.2]), 90);
  assert.equal(bearing([-2.90698, 43.23367], [-2.89095, 43.23165]), 100);
});

test('simplification keeps the bends that matter and the ends', () => {
  const line: [number, number][] = [[-2.9, 43.2], [-2.89999, 43.21], [-2.9, 43.22], [-2.88, 43.22]];
  const simplified = simplifyPath(line, 3);
  assert.deepEqual(simplified, [line[0], line[2], line[3]]);
  assert.ok(Math.abs(straightMeters([-2.9, 43.2], [-2.9, 43.21]) - 1113) < 2);
});

test('a shape drawn on the reviewed tracks is on its own track there, and nowhere else', () => {
  // The southbound track of the Euskotren tunnel between Otxarkoaga and Txurdinaga, then 1 m off it.
  const way = (JSON.parse(fs.readFileSync(RAIL_TRACKS_FILE, 'utf8')) as { ways: { id: number; path: [number, number][] }[] }).ways.find((item) => item.id === 559443418)!.path;
  const off = way.map(([longitude, latitude]): [number, number] => [longitude, latitude + 1 / 110_540]);
  const path = [...way, ...off];
  const cumulative = path.map((_, i) => path.slice(1, i + 1).reduce((sum, point, j) => sum + straightMeters(path[j], point), 0));
  const stretches = onTrackStretches(path, cumulative);
  assert.equal(stretches.length, 1);
  assert.deepEqual(stretches[0], { from: 0, to: cumulative[way.length - 1], runsOn: 'left' }, 'Euskotren runs on the left');
});

test('the stops of an underground station move onto its platform', () => {
  // Euskotren puts Zurbaranbarri at its street entrance, 170 m off the track.
  const stations = [{ name: 'Zurbaranbarri', ids: [5294711015], point: [-2.9137236, 43.2637265] as [number, number] }, { name: 'Zazpikaleak / Casco Viejo', ids: [4298706695], point: [-2.9218361, 43.2602246] as [number, number] }];
  const stop = (name: string, longitude: number, latitude: number) => ({ stopId: name, stopCode: '', name, longitude, latitude });
  const stops = [stop('Zurbaranbarri-Bilbao', -2.914971, 43.26495), stop('Zazpikaleak/Casco Viejo-Bilbao', -2.921842, 43.260176), stop('Zurbaranbarri-Bilbao', -2.95, 43.26), stop('Zurbaran', -2.914971, 43.26495)];
  assert.equal(moveToPlatforms(stops, stations), 2);
  assert.deepEqual([stops[0].longitude, stops[0].latitude], stations[0].point);
  assert.deepEqual([stops[1].longitude, stops[1].latitude], stations[1].point, 'names are compared without spaces around the slash');
  assert.equal(stops[2].longitude, -2.95, 'a stop of the same name far away stays');
  assert.equal(stops[3].longitude, -2.914971, 'another name stays');
});
