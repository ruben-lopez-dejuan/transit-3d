import type { GtfsShapePoint } from "../providers/bizkaibus/gtfs";

export type Coordinate = [longitude: number, latitude: number];
export type ShapeMetric = { coordinates: Coordinate[]; cumulativeMeters: number[]; totalMeters: number };

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const meanLat = (a[1] + b[1]) * Math.PI / 360;
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(meanLat); const dy = (b[1] - a[1]) * 110_540;
  return Math.hypot(dx, dy);
}

export function buildShapeMetric(points: GtfsShapePoint[]): ShapeMetric {
  const coordinates = points.map((point) => [point.longitude, point.latitude] as Coordinate);
  const cumulativeMeters = [0];
  for (let i = 1; i < coordinates.length; i++) cumulativeMeters.push(cumulativeMeters[i - 1] + distanceMeters(coordinates[i - 1], coordinates[i]));
  return { coordinates, cumulativeMeters, totalMeters: cumulativeMeters.at(-1) ?? 0 };
}

export function positionAtProgress(metric: ShapeMetric, progressMeters: number): { coordinate: Coordinate; bearing: number; progressMeters: number } | null {
  if (metric.coordinates.length < 2) return null;
  const progress = Math.max(0, Math.min(metric.totalMeters, progressMeters));
  let index = metric.cumulativeMeters.findIndex((end, i) => i > 0 && end >= progress);
  if (index < 1) index = metric.coordinates.length - 1;
  const startDistance = metric.cumulativeMeters[index - 1]; const segmentDistance = metric.cumulativeMeters[index] - startDistance;
  const fraction = segmentDistance > 0 ? (progress - startDistance) / segmentDistance : 0;
  const a = metric.coordinates[index - 1]; const b = metric.coordinates[index];
  const coordinate: Coordinate = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
  return { coordinate, bearing: bearingDegrees(a, b), progressMeters: progress };
}

export function projectOntoShape(metric: ShapeMetric, coordinate: Coordinate, minimumProgress = 0): { coordinate: Coordinate; progressMeters: number; distanceMeters: number; bearing: number } | null {
  let best: { coordinate: Coordinate; progressMeters: number; distanceMeters: number; bearing: number } | null = null;
  for (let i = 0; i < metric.coordinates.length - 1; i++) {
    const a = metric.coordinates[i]; const b = metric.coordinates[i + 1]; const originLat = coordinate[1] * Math.PI / 180;
    const sx = 111_320 * Math.cos(originLat); const sy = 110_540;
    const ax = (a[0] - coordinate[0]) * sx; const ay = (a[1] - coordinate[1]) * sy; const bx = (b[0] - coordinate[0]) * sx; const by = (b[1] - coordinate[1]) * sy;
    const vx = bx - ax; const vy = by - ay; const denominator = vx * vx + vy * vy;
    const t = denominator ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / denominator)) : 0;
    const projected: Coordinate = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const progressMeters = metric.cumulativeMeters[i] + t * (metric.cumulativeMeters[i + 1] - metric.cumulativeMeters[i]);
    if (progressMeters < minimumProgress) continue;
    const distance = distanceMeters(projected, coordinate);
    if (!best || distance < best.distanceMeters) best = { coordinate: projected, progressMeters, distanceMeters: distance, bearing: bearingDegrees(a, b) };
  }
  return best;
}

export function bearingDegrees(a: Coordinate, b: Coordinate): number {
  const lon1 = a[0] * Math.PI / 180; const lat1 = a[1] * Math.PI / 180; const lon2 = b[0] * Math.PI / 180; const lat2 = b[1] * Math.PI / 180;
  return (Math.atan2(Math.sin(lon2 - lon1) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)) * 180 / Math.PI + 360) % 360;
}

export function interpolateProgress(startMeters: number, endMeters: number, startedAtMs: number, endsAtMs: number, nowMs: number): number {
  if (endsAtMs <= startedAtMs) return endMeters;
  const fraction = Math.max(0, Math.min(1, (nowMs - startedAtMs) / (endsAtMs - startedAtMs))); const eased = fraction * fraction * (3 - 2 * fraction);
  return startMeters + (endMeters - startMeters) * eased;
}

export function correctedProgress(currentMeters: number, observedMeters: number, elapsedMs: number, correctionMs = 10_000): number {
  const alpha = Math.max(0, Math.min(1, elapsedMs / correctionMs));
  return currentMeters + (observedMeters - currentMeters) * alpha;
}
