import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceCorridor, routeStraightSegments, segmentKey, simplifyPath, straightMeters, type Corridor } from './routedSegments';
import type { GtfsShapePoint } from '../providers/bizkaibus/gtfs';

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

test('straight segments with a routed road get its curve; the feed points are kept', () => {
  const bilbao: [number, number] = [-2.94963, 43.26137], vitoria: [number, number] = [-2.685659, 42.858622], next: [number, number] = [-2.682499, 42.844554];
  const road: [number, number][] = [bilbao, [-2.9, 43.2], [-2.75, 42.95], vitoria];
  const repaired = routeStraightSegments(shape([bilbao, vitoria, next]), { [segmentKey(bilbao, vitoria)]: road })!;
  assert.deepEqual(coordinates(repaired), [...road, next]);
  assert.equal(routeStraightSegments(shape([vitoria, next]), { [segmentKey(bilbao, vitoria)]: road }), null);
});

test('simplification keeps the bends that matter and the ends', () => {
  const line: [number, number][] = [[-2.9, 43.2], [-2.89999, 43.21], [-2.9, 43.22], [-2.88, 43.22]];
  const simplified = simplifyPath(line, 3);
  assert.deepEqual(simplified, [line[0], line[2], line[3]]);
  assert.ok(Math.abs(straightMeters([-2.9, 43.2], [-2.9, 43.21]) - 1113) < 2);
});
