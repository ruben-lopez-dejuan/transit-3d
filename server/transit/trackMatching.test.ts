import assert from 'node:assert/strict';
import test from 'node:test';
import { matchToTracks, RAIL_TRACK_OPTIONS, TrackNetwork, withoutReversals, type TrackWay } from './trackMatching';

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

test('a train in Bizkaia runs on the left-hand track', () => {
  const network = new TrackNetwork(doubleTrack, RAIL_TRACK_OPTIONS);
  assert.ok(matchToTracks(centreLine, network)!.every(([, latitude]) => latitude === NORTH), 'eastbound runs on the north track');
  assert.ok(matchToTracks([...centreLine].reverse(), network)!.every(([, latitude]) => latitude === SOUTH));
});

test('a sketch that cuts a corner 150 m inside the tracks still takes its own track', () => {
  // Matiko – Kukullaga: the feed draws the curves as chords up to 177 m off the tunnel.
  // Far from the tracks the nodes of the nearer one are almost as close as its nearest
  // point; they must not crowd the other track out of the candidates.
  const sketch: Lonlat[] = centreLine.slice(1, -1).map(([longitude]) => [longitude, 43.00135]);
  const network = new TrackNetwork(doubleTrack, RAIL_TRACK_OPTIONS);
  assert.ok(matchToTracks(sketch, network)!.every(([, latitude]) => latitude === NORTH));
  assert.ok(matchToTracks([...sketch].reverse(), network)!.every(([, latitude]) => latitude === SOUTH));
  assert.equal(matchToTracks(sketch, new TrackNetwork(doubleTrack)), null, 'trams look only 40 m away');
});

test('a line longer than the tracks is matched only along them', () => {
  // The tracks end at -1.99; the line runs on to -1.98 as published.
  const line: Lonlat[] = [...centreLine, ...[-1.988, -1.986, -1.984, -1.982, -1.98].map((longitude): Lonlat => [longitude, 43])];
  const matched = matchToTracks(line, new TrackNetwork(doubleTrack, RAIL_TRACK_OPTIONS))!;
  assert.ok(matched.filter(([longitude]) => longitude <= -1.99).every(([, latitude]) => latitude === NORTH));
  assert.deepEqual(matched.filter(([longitude]) => longitude > -1.99), line.slice(6), 'past the end of the tracks the shape is kept');
  // A turnback outside the tracks is not a reversal to drop (E3 at Sondika).
  const turnback: Lonlat[] = [...centreLine, [-1.985, 43], [-1.98, 43], [-1.985, 43.0002]];
  assert.deepEqual(matchToTracks(turnback, new TrackNetwork(doubleTrack, RAIL_TRACK_OPTIONS))!.slice(-3), turnback.slice(-3));
});

test('a path that doubles back drops the tip', () => {
  assert.deepEqual(withoutReversals([[-2, 43], [-1.999, 43], [-1.9991, 43], [-1.998, 43]]), [[-2, 43], [-1.9991, 43], [-1.998, 43]]);
  assert.deepEqual(withoutReversals([[-2, 43], [-1.999, 43], [-1.999, 43], [-1.998, 43.001]]), [[-2, 43], [-1.999, 43], [-1.998, 43.001]]);
});
