import fs from 'node:fs';
import path from 'node:path';
import type { BizkaibusGtfs, GtfsShapePoint, GtfsTrip } from '../providers/bizkaibus/gtfs';

/**
 * Offline repairs for operator shapes that are drawn wrong: long straight
 * segments routed along roads (server/build-routed-segments.ts), rail
 * corridors whose published shape detours or jumps, and shapes that stop
 * short of their trips (server/import-shape-extensions.ts, or the track of
 * another shape of the feed for rail terminals). Applied once while a feed
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
const isRail = (routeType: number) => [0, 1, 2, 5, 7, 12].includes(routeType) || (routeType >= 100 && routeType < 200) || (routeType >= 400 && routeType < 500) || (routeType >= 900 && routeType < 1000) || routeType === 1400;

let routed: RoutedSegments | null | undefined;
let corridors: Corridor[] | undefined;
let extensions: ShapeExtension[] | undefined;
const load = <T>(file: string, fallback: T): T => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; } };
/** Version of the repair datasets, so a parsed-feed cache built without them is not reused. */
export function shapeRepairVersion() {
  routed ??= load<RoutedSegments | null>(ROUTED_SEGMENTS_FILE, null);
  corridors ??= load<{ corridors: Corridor[] }>(CORRIDORS_FILE, { corridors: [] }).corridors;
  extensions ??= load<{ extensions: ShapeExtension[] }>(EXTENSIONS_FILE, { extensions: [] }).extensions;
  return `repairs-v2:${routed?.generatedAt ?? 'none'}:${corridors.length}:${extensions.length}`;
}
/** Apply every repair to every shape of a feed; returns how many shapes changed. */
export function repairShapes(gtfs: BizkaibusGtfs, operatorId: string) {
  shapeRepairVersion();
  let repaired = 0;
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
    if (routed) next = routeStraightSegments(next, routed.segments) ?? next;
    if (next !== points) { gtfs.shapes.set(shapeId, next); repaired++; }
  }
  return repaired;
}
