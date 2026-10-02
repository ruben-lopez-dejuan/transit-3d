import type { MotionAnchor, Shape, Vehicle, PositionQuality } from "./networkTypes";

export function progressAt(timeline: MotionAnchor[], now: number, rail = false): number | null {
  if (!timeline.length) return null;
  if (now <= timeline[0].at) return timeline[0].progress;
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1], b = timeline[i];
    if (now > b.at) continue;
    const t = b.at > a.at ? Math.max(0, Math.min(1, (now - a.at) / (b.at - a.at))) : 1;
    // Gentle acceleration/deceleration for rail; duplicated stop anchors preserve dwell.
    const fraction = rail ? t * t * (3 - 2 * t) : t;
    return a.progress + (b.progress - a.progress) * fraction;
  }
  return timeline.at(-1)!.progress;
}
export function positionAlong(shape: Shape, progress: number) {
  const clamped = Math.max(0, Math.min(shape.total, progress));
  let low = 1, high = shape.cumulative.length - 1;
  while (low < high) { const middle = (low + high) >> 1; if (shape.cumulative[middle] < clamped) low = middle + 1; else high = middle; }
  const a = shape.coordinates[low - 1], b = shape.coordinates[low];
  if (!a || !b) return null;
  const span = shape.cumulative[low] - shape.cumulative[low - 1];
  const t = span > 0 ? (clamped - shape.cumulative[low - 1]) / span : 0;
  const coordinate: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const bearing = (Math.atan2((b[0] - a[0]) * Math.cos(coordinate[1] * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI + 360) % 360;
  return { coordinate, bearing };
}
export function positionQuality(vehicle: Vehicle, now: number): PositionQuality {
  return vehicle.positionQuality === "live" && vehicle.observationTimestamp !== null && now - vehicle.observationTimestamp > 45_000 ? "predicted" : vehicle.positionQuality;
}
export function correctionOffset(offset: number, startedAt: number, duration: number, now: number) {
  const t = Math.max(0, Math.min(1, (now - startedAt) / duration));
  return offset * (1 - t * t * (3 - 2 * t));
}
