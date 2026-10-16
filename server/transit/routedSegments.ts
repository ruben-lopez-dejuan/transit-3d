import fs from 'node:fs';
import path from 'node:path';
import type { BizkaibusGtfs, GtfsShapePoint, GtfsStop, GtfsTrip } from '../providers/bizkaibus/gtfs';
import { matchToTracks, RAIL_TRACK_OPTIONS, RAIL_TRACKS_FILE, TrackNetwork, TRAM_TRACK_OPTIONS, TRAM_TRACKS_FILE, type TrackOptions, type TrackStation, type TrackWay } from './trackMatching';

/**
 * Offline repairs for operator shapes that are drawn wrong: long straight
 * segments routed along roads (server/build-routed-segments.ts), rail
 * corridors whose published shape detours or jumps, and shapes that stop
 * short of their trips (server/import-shape-extensions.ts, or the track of
 * another shape of the feed for rail terminals), and polygonal tram shapes and
 * sketched Euskotren tunnels matched onto OSM tracks (server/transit/trackMatching.ts). Applied once while a feed
 * is prepared; the result is cached with the parsed feed.
 */
type Lonlat = [number, number];
export type RoutedSegments = { generatedAt: string; segments: Record<string, Lonlat[]>; rejected?: Record<string, string> };
export type Corridor = { operatorId: string; name: string; path: Lonlat[] };
export type ShapeExtension = { operatorId: string; shapeId: string; name: string; path: Lonlat[] };
export const ROUTED_SEGMENTS_FILE = path.resolve('server/cities/es-bilbao/routed-segments.json');
export const CORRIDORS_FILE = path.resolve('server/cities/es-bilbao/rail-corridors.json');
export const EXTENSIONS_FILE = path.resolve('server/cities/es-bilbao/shape-extensions.json');

const METERS_PER_DEGREE = 111_320;
export function straightMeters(a: Lonlat, b: Lonlat) {
  const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * METERS_PER_DEGREE * k, (a[1] - b[1]) * METERS_PER_DEGREE);
}
const pathMeters = (points: Lonlat[]) => points.slice(1).reduce((sum, point, i) => sum + straightMeters(points[i], point), 0);
/** Five decimals (about a metre) identify a feed point across reruns. */
export const segmentKey = (from: Lonlat, to: Lonlat) => `${from[0].toFixed(5)},${from[1].toFixed(5)}>${to[0].toFixed(5)},${to[1].toFixed(5)}`;

/** Douglas–Peucker with a tolerance in metres. */
export function simplifyPath(points: Lonlat[], toleranceMeters: number): Lonlat[] {
  if (points.length < 3) return points;
  const k = Math.cos(points[0][1] * Math.PI / 180);
  const xy = points.map(([lon, lat]) => [lon * METERS_PER_DEGREE * k, lat * METERS_PER_DEGREE]);
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const [ax, ay] = xy[start], [bx, by] = xy[end], length = Math.hypot(bx - ax, by - ay);
    let farthest = -1, distance = toleranceMeters;
    for (let i = start + 1; i < end; i++) {
      const [px, py] = xy[i];
      const d = length ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length : Math.hypot(px - ax, py - ay);
      if (d > distance) { farthest = i; distance = d; }
    }
    if (farthest >= 0) { keep[farthest] = 1; stack.push([start, farthest], [farthest, end]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Stop-to-stop coach segments: a road route this much longer than the straight line is a loop, not the road. */
export const MAX_DETOUR_RATIO = 8;
export const MAX_SNAP_METERS = 300;
/**
 * Why a routed road is not the missing curve of a straight segment, or null when it is.
 * Rural roads in Álava wind around hills (Alavabus 19B: 5.8 km apart, 17.4 km by road),
 * so only a route far from the stops or a loop, such as a motorway carriageway snapped
 * in the wrong direction, is rejected.
 */
export function rejectRoute({ straight, route, snap }: { straight: number; route: number; snap: number }): string | null {
  if (snap > MAX_SNAP_METERS) return `extremo a ${Math.round(snap)} m de la carretera`;
  if (route > straight * MAX_DETOUR_RATIO) return `ruta ${Math.round(route)} m para ${Math.round(straight)} m en línea recta`;
  return null;
}
/** Compass bearing from one point to another, for OSRM to snap onto the carriageway in the direction of travel. */
export function bearing(from: Lonlat, to: Lonlat) {
  const k = Math.cos(((from[1] + to[1]) / 2) * Math.PI / 180);
  return Math.round((Math.atan2((to[0] - from[0]) * k, to[1] - from[1]) * 180 / Math.PI + 360) % 360);
}

/**
 * The stretch of a longer route between the places it passes nearest to `from` and
 * then `to`, with how far it passes from them. For a feed point OSRM snaps to the
 * wrong road: PESA DG05 has a point inside the AP-1 Zarimutz tunnel, 3 m from a
 * lane on the surface above, so it is routed to the next point and cut there.
 */
export function trimRoute(path: Lonlat[], from: Lonlat, to: Lonlat): { path: Lonlat[]; miss: number } {
  const k = Math.cos(from[1] * Math.PI / 180);
  const project = (target: Lonlat, first: number) => {
    let best = { segment: first, point: path[first], distance: Infinity };
    for (let i = first; i < path.length - 1; i++) {
      const [ax, ay] = path[i], [bx, by] = path[i + 1];
      const dx = (bx - ax) * k, dy = by - ay, length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((target[0] - ax) * k * dx + (target[1] - ay) * dy) / length)) : 0;
      const point: Lonlat = [ax + t * (bx - ax), ay + t * (by - ay)], distance = straightMeters(point, target);
      if (distance < best.distance) best = { segment: i, point, distance };
    }
    return best;
  };
  const start = project(from, 0), end = project(to, start.segment);
  return { path: [start.point, ...path.slice(start.segment + 1, end.segment + 1), end.point], miss: Math.max(start.distance, end.distance) };
}

const toPoint = ([longitude, latitude]: Lonlat, sequence: number): GtfsShapePoint => ({ longitude, latitude, sequence });
const lonlat = (point: GtfsShapePoint): Lonlat => [point.longitude, point.latitude];

/** Insert the routed road between every pair of consecutive points that has one. */
export function routeStraightSegments(points: GtfsShapePoint[], segments: Record<string, Lonlat[]>): GtfsShapePoint[] | null {
  let changed = false;
  const result: Lonlat[] = [lonlat(points[0])];
  for (let i = 1; i < points.length; i++) {
    const routed = segments[segmentKey(lonlat(points[i - 1]), lonlat(points[i]))];
    if (routed && routed.length > 2) { result.push(...routed.slice(1, -1)); changed = true; }
    result.push(lonlat(points[i]));
  }
  return changed ? result.map((point, i) => toPoint(point, i + 1)) : null;
}

const CORRIDOR_SNAP_METERS = 150;
/** A published stretch this much longer than the corridor is a detour, not a curve the corridor simplified. */
const DETOUR_RATIO = 1.3;
/**
 * Replace the stretch of a shape between the two ends of a known corridor when
 * the published stretch detours (Euskotren E3 went Sondika → Lutxana and then
 * jumped 4 km back to Ola). Works in either direction.
 */
export function replaceCorridor(points: GtfsShapePoint[], corridor: Corridor): GtfsShapePoint[] | null {
  const nearest = (target: Lonlat) => {
    let index = -1, distance = CORRIDOR_SNAP_METERS;
    points.forEach((point, i) => { const d = straightMeters(lonlat(point), target); if (d < distance) { index = i; distance = d; } });
    return index;
  };
  const start = nearest(corridor.path[0]), end = nearest(corridor.path.at(-1)!);
  if (start < 0 || end < 0 || start === end) return null;
  const [from, to] = start < end ? [start, end] : [end, start];
  const replacement = start < end ? corridor.path : [...corridor.path].reverse();
  const published = points.slice(from, to + 1).map(lonlat);
  if (pathMeters(published) <= pathMeters(replacement) * DETOUR_RATIO) return null;
  return [...points.slice(0, from).map(lonlat), ...replacement, ...points.slice(to + 1).map(lonlat)].map((point, i) => toPoint(point, i + 1));
}

/**
 * Continue a shape that stops short of its trips along the track another shape
 * of the feed draws (Metro Bilbao IBB_BSR is a copy of IBB_ETX: it ends at
 * Etxebarri while its trip runs on to Ariz and Basauri). The extension starts
 * where the shape ends; a shape ending anywhere else is left alone.
 */
export function extendShape(points: GtfsShapePoint[], extension: ShapeExtension): GtfsShapePoint[] | null {
  if (straightMeters(lonlat(points.at(-1)!), extension.path[0]) > CORRIDOR_SNAP_METERS) return null;
  return [...points.map(lonlat), ...extension.path.slice(1)].map((point, i) => toPoint(point, i + 1));
}

/** Distance from a point to the nearest segment of a path. */
function distanceToPath(point: Lonlat, path: Lonlat[]) {
  const k = Math.cos(point[1] * Math.PI / 180);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = [(path[i - 1][0] - point[0]) * k, path[i - 1][1] - point[1]], [bx, by] = [(path[i][0] - point[0]) * k, path[i][1] - point[1]];
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy) * METERS_PER_DEGREE);
  }
  return best;
}
const TRACK_SNAP_METERS = 50;
const MAX_TERMINAL_EXTENSION_METERS = 5000;
/**
 * Continue a rail shape that stops short of its trip's first or last platform along
 * the track another shape of the feed draws through both points (Euskotren's short
 * workings to Traña-Abadiño ended 350 m before the station). Euskotren shape ids
 * change between releases, so the track is looked up in the feed, not a dataset.
 * A track in the trip's own direction is preferred over one in the opposite one.
 */
export function extendToTerminals(points: GtfsShapePoint[], terminals: { first: Lonlat; last: Lonlat }, tracks: GtfsShapePoint[][]): GtfsShapePoint[] | null {
  let path = points.map(lonlat), changed = false;
  const nearest = (track: Lonlat[], target: Lonlat) => {
    let index = -1, distance = TRACK_SNAP_METERS;
    track.forEach((point, i) => { const d = straightMeters(point, target); if (d < distance) { index = i; distance = d; } });
    return index;
  };
  for (const end of ['last', 'first'] as const) {
    const stop = terminals[end], shapeEnd = end === 'last' ? path.at(-1)! : path[0];
    if (distanceToPath(stop, path) <= CORRIDOR_SNAP_METERS) continue;
    let piece: Lonlat[] | null = null;
    for (const forward of [true, false]) {
      for (const points of tracks) {
        const track = points.map(lonlat), from = nearest(track, shapeEnd), to = nearest(track, stop);
        if (from < 0 || to < 0 || from === to) continue;
        // Oriented from the shape's end to the platform, without the point the shape already ends on.
        const ahead = from < to ? track.slice(from + 1, to + 1) : track.slice(to, from).reverse();
        if ((end === 'last') !== forward ? from < to : from > to) continue;
        if (pathMeters([shapeEnd, ...ahead]) > MAX_TERMINAL_EXTENSION_METERS) continue;
        piece = ahead; break;
      }
      if (piece) break;
    }
    if (!piece) continue;
    path = end === 'last' ? [...path, ...piece] : [...[...piece].reverse(), ...path];
    changed = true;
  }
  return changed ? path.map((point, i) => toPoint(point, i + 1)) : null;
}
const isTram = (routeType: number) => routeType === 0 || (routeType >= 900 && routeType < 1000);
const isRail = (routeType: number) => [0, 1, 2, 5, 7, 12].includes(routeType) || (routeType >= 100 && routeType < 200) || (routeType >= 400 && routeType < 500) || (routeType >= 900 && routeType < 1000) || routeType === 1400;

let routed: RoutedSegments | null | undefined;
let corridors: Corridor[] | undefined;
let extensions: ShapeExtension[] | undefined;
/** Reviewed OSM tracks and the shapes matched onto them: every tram, and Euskotren trains through the Matiko – Kukullaga tunnel. */
const TRACK_SETS: { file: string; options: TrackOptions; applies: (operatorId: string, routeType: number) => boolean }[] = [
  { file: TRAM_TRACKS_FILE, options: TRAM_TRACK_OPTIONS, applies: (_, routeType) => isTram(routeType) },
  { file: RAIL_TRACKS_FILE, options: RAIL_TRACK_OPTIONS, applies: (operatorId, routeType) => operatorId === 'euskotren' && isRail(routeType) && !isTram(routeType) },
];
let trackSets: { network: TrackNetwork; ways: number; stations: TrackStation[]; applies: (operatorId: string, routeType: number) => boolean }[] | undefined;
const load = <T>(file: string, fallback: T): T => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; } };
/** Version of the repair datasets, so a parsed-feed cache built without them is not reused. */
export function shapeRepairVersion() {
  routed ??= load<RoutedSegments | null>(ROUTED_SEGMENTS_FILE, null);
  corridors ??= load<{ corridors: Corridor[] }>(CORRIDORS_FILE, { corridors: [] }).corridors;
  extensions ??= load<{ extensions: ShapeExtension[] }>(EXTENSIONS_FILE, { extensions: [] }).extensions;
  trackSets ??= TRACK_SETS.map(({ file, options, applies }) => {
    const { ways, stations = [] } = load<{ ways: TrackWay[]; stations?: TrackStation[] }>(file, { ways: [] });
    return { network: new TrackNetwork(ways, options), ways: ways.length, stations, applies };
  });
  return `repairs-v4:${routed?.generatedAt ?? 'none'}:${corridors.length}:${extensions.length}:${trackSets.map((set) => `${set.ways}+${set.stations.length}`).join(':')}`;
}
const MIN_ON_TRACK_METERS = 50;
/**
 * The stretches of a shape, in metres along it, drawn on the reviewed tracks: the vehicle
 * runs there on its own track and needs no diagrammatic offset to keep off the other direction.
 */
export function onTrackStretches(coordinates: Lonlat[], cumulative: number[]): { from: number; to: number }[] {
  shapeRepairVersion();
  const networks = trackSets!.filter((set) => set.ways).map((set) => set.network);
  if (!networks.length) return [];
  const on = coordinates.map((point) => networks.some((network) => network.onTrack(point)));
  const stretches: { from: number; to: number }[] = [];
  for (let i = 1; i < coordinates.length; i++) {
    if (!on[i - 1] || !on[i]) continue;
    const last = stretches.at(-1);
    if (last && last.to === cumulative[i - 1]) last.to = cumulative[i]; else stretches.push({ from: cumulative[i - 1], to: cumulative[i] });
  }
  return stretches.filter((stretch) => stretch.to - stretch.from >= MIN_ON_TRACK_METERS);
}
const STATION_SNAP_METERS = 300;
const stationName = (name: string) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s*\/\s*/g, '/').trim();
/**
 * Move the stops of a station onto its platform on the tracks. Euskotren puts its underground
 * stations at a street entrance (Zurbaranbarri, 170 m off the track), so the train stopped at the
 * point of track nearest to it, up to 120 m from the platform. A stop named as the station
 * ("Txurdinaga-Bilbao" for "Txurdinaga") within 300 m of it moves; returns how many did.
 */
export function moveToPlatforms(stops: GtfsStop[], stations: TrackStation[]) {
  let moved = 0;
  for (const stop of stops) {
    const name = stationName(stop.name);
    const station = stations.find((item) => (name === stationName(item.name) || name.startsWith(stationName(item.name) + '-')) && straightMeters([stop.longitude, stop.latitude], item.point) <= STATION_SNAP_METERS);
    if (!station || (stop.longitude === station.point[0] && stop.latitude === station.point[1])) continue;
    [stop.longitude, stop.latitude] = station.point;
    moved++;
  }
  return moved;
}
/** Apply every repair to every shape of a feed; returns how many shapes changed. */
export function repairShapes(gtfs: BizkaibusGtfs, operatorId: string) {
  shapeRepairVersion();
  let repaired = 0;
  for (const set of trackSets!) if (set.stations.length) {
    const served = new Set<string>();
    for (const trip of gtfs.trips.values()) if (set.applies(operatorId, gtfs.routes.get(trip.routeId)?.routeType ?? 3)) for (const time of gtfs.tripStops.get(trip.tripId) ?? []) served.add(time.stopId);
    moveToPlatforms([...served].flatMap((stopId) => gtfs.stops.get(stopId) ?? []), set.stations);
  }
  // One trip per rail shape gives its terminal platforms; the published rail shapes are the tracks.
  const railTrips = new Map<string, GtfsTrip>();
  for (const trip of gtfs.trips.values()) if (trip.shapeId && !railTrips.has(trip.shapeId) && isRail(gtfs.routes.get(trip.routeId)?.routeType ?? 3)) railTrips.set(trip.shapeId, trip);
  const tracks = [...railTrips.keys()].map((shapeId) => gtfs.shapes.get(shapeId)).filter((points) => (points?.length ?? 0) >= 2) as GtfsShapePoint[][];
  for (const [shapeId, points] of gtfs.shapes) {
    if (points.length < 2) continue;
    let next: GtfsShapePoint[] = points;
    for (const corridor of corridors!) if (corridor.operatorId === operatorId) next = replaceCorridor(next, corridor) ?? next;
    for (const extension of extensions!) if (extension.operatorId === operatorId && extension.shapeId === shapeId) next = extendShape(next, extension) ?? next;
    const trip = railTrips.get(shapeId), stops = trip && gtfs.tripStops.get(trip.tripId);
    const first = stops?.length && gtfs.stops.get(stops[0].stopId), last = stops?.length && gtfs.stops.get(stops.at(-1)!.stopId);
    if (first && last) next = extendToTerminals(next, { first: [first.longitude, first.latitude], last: [last.longitude, last.latitude] }, tracks) ?? next;
    const routeType = trip ? gtfs.routes.get(trip.routeId)?.routeType ?? 3 : 3;
    for (const set of trackSets!) if (trip && set.ways && set.applies(operatorId, routeType)) {
      const matched = matchToTracks(next.map(lonlat), set.network);
      if (matched) next = matched.map((point, i) => toPoint(point, i + 1));
    }
    if (routed) next = routeStraightSegments(next, routed.segments) ?? next;
    if (next !== points) { gtfs.shapes.set(shapeId, next); repaired++; }
  }
  return repaired;
}
