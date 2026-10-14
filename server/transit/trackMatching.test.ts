import assert from 'node:assert/strict';
import test from 'node:test';
import { matchToTracks, TrackNetwork, withoutReversals, type TrackWay } from './trackMatching';

type Lonlat = [number, number];
// A double track running east, 4.4 m apart, with a node every ~8 m; trams run on the right.
const NORTH = 43.00002, SOUTH = 42.99998;
const track = (latitude: number, from = -2.0, to = -1.99): Lonlat[] => Array.from({ length: 101 }, (_, i) => [Number((from + (to - from) * i / 100).toFixed(7)), latitude]);
const doubleTrack: TrackWay[] = [{ id: 1, path: track(NORTH) }, { id: 2, path: track(SOUTH) }];
// The feed draws the centre line with a point every ~160 m.
const centreLine: Lonlat[] = [-2.0, -1.998, -1.996, -1.994, -1.992, -1.99].map((longitude) => [longitude, 43]);

test('a polygonal shape follows the right-hand track with its nodes', () => {
  const matched = matchToTracks(centreLine, new TrackNetwork(doubleTrack))!;
  assert.ok(matched.length > 90, 'the track nodes between the feed points are kept');
  assert.ok(matched.every(([, latitude]) => latitude === SOUTH), 'eastbound runs on the south track');
  const westbound = matchToTracks([...centreLine].reverse(), new TrackNetwork(doubleTrack))!;
  assert.ok(westbound.every(([, latitude]) => latitude === NORTH));
});

test('a direction OSM tags wins over running on the right', () => {
  // Left-hand running, as tagged: the north track runs east and the south one west.
  const tagged: TrackWay[] = [{ id: 1, direction: 'forward', path: track(NORTH) }, { id: 2, direction: 'forward', path: track(SOUTH, -1.99, -2.0) }];
  assert.ok(matchToTracks(centreLine, new TrackNetwork(tagged))!.every(([, latitude]) => latitude === NORTH));
});

test('a shape alternating between depot tracks 20 m apart stays on one of them', () => {
  // Atxuri: the feed jumps between two depot tracks every point.
  const depot: TrackWay[] = [{ id: 1, service: 'yard', path: track(43) }, { id: 2, service: 'yard', path: track(43.00018) }];
  const zigzag: Lonlat[] = Array.from({ length: 12 }, (_, i) => [-2.0 + i * 0.0003, i % 2 ? 43.00018 : 43]);
  const matched = matchToTracks(zigzag, new TrackNetwork(depot))!;
  assert.equal(new Set(matched.map(([, latitude]) => latitude)).size, 1);
});

test('a shape away from every track is not matched', () => {
  assert.equal(matchToTracks(centreLine.map(([longitude]) => [longitude, 43.01]), new TrackNetwork(doubleTrack)), null);
});

test('a path that doubles back drops the tip', () => {
  assert.deepEqual(withoutReversals([[-2, 43], [-1.999, 43], [-1.9991, 43], [-1.998, 43]]), [[-2, 43], [-1.9991, 43], [-1.998, 43]]);
  assert.deepEqual(withoutReversals([[-2, 43], [-1.999, 43], [-1.999, 43], [-1.998, 43.001]]), [[-2, 43], [-1.999, 43], [-1.998, 43.001]]);
});
