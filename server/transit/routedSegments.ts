import fs from 'node:fs';
import path from 'node:path';
import type { BizkaibusGtfs, GtfsShapePoint } from '../providers/bizkaibus/gtfs';

/**
 * Offline repairs for operator shapes that are drawn wrong: long straight
 * segments routed along roads (server/build-routed-segments.ts) and rail
 * corridors whose published shape detours or jumps. Applied once while a feed
 * is prepared; the result is cached with the parsed feed.
 */
type Lonlat = [number, number];
export type RoutedSegments = { generatedAt: string; segments: Record<string, Lonlat[]>; rejected?: Record<string, string> };
export type Corridor = { operatorId: string; name: string; path: Lonlat[] };
export const ROUTED_SEGMENTS_FILE = path.resolve('server/cities/es-bilbao/routed-segments.json');
export const CORRIDORS_FILE = path.resolve('server/cities/es-bilbao/rail-corridors.json');

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

let routed: RoutedSegments | null | undefined;
let corridors: Corridor[] | undefined;
const load = <T>(file: string, fallback: T): T => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; } };
/** Version of the repair datasets, so a parsed-feed cache built without them is not reused. */
export function shapeRepairVersion() {
  routed ??= load<RoutedSegments | null>(ROUTED_SEGMENTS_FILE, null);
  corridors ??= load<{ corridors: Corridor[] }>(CORRIDORS_FILE, { corridors: [] }).corridors;
  return `repairs:${routed?.generatedAt ?? 'none'}:${corridors.length}`;
}
/** Apply both repairs to every shape of a feed; returns how many shapes changed. */
export function repairShapes(gtfs: BizkaibusGtfs, operatorId: string) {
  shapeRepairVersion();
  let repaired = 0;
  for (const [shapeId, points] of gtfs.shapes) {
    if (points.length < 2) continue;
    let next: GtfsShapePoint[] = points;
    for (const corridor of corridors!) if (corridor.operatorId === operatorId) next = replaceCorridor(next, corridor) ?? next;
    if (routed) next = routeStraightSegments(next, routed.segments) ?? next;
    if (next !== points) { gtfs.shapes.set(shapeId, next); repaired++; }
  }
  return repaired;
}
