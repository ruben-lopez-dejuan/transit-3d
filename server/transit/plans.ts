import type { BizkaibusGtfs } from "../providers/bizkaibus/gtfs";
import { buildShapeMetric, projectOntoShape, type ShapeMetric } from "./motionEngine";
import { formatServiceDate, parseGtfsTime } from "./gtfsCalendar";
import type { MotionAnchor, Shape } from '../../shared/transit/network';

type Plan = { metric: ShapeMetric; anchors: { seconds: number; progress: number }[]; stops: { stopId: string; sequence: number; arrival: number; departure: number; progress: number }[] };
const caches = new WeakMap<BizkaibusGtfs, { metrics: Map<string, ShapeMetric>; plans: Map<string, Plan | null> }>();
const origins = new Map<string, number>();
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
function cache(gtfs: BizkaibusGtfs) {
  let value = caches.get(gtfs);
  if (!value) { value = { metrics: new Map(), plans: new Map() }; caches.set(gtfs, value); }
  return value;
}
/** In-memory realtime journeys may change or expire; their plan cache must expire too. */
export function invalidateTripPlan(gtfs: BizkaibusGtfs, tripId: string) { cache(gtfs).plans.delete(tripId); }
export function shapeMetric(gtfs: BizkaibusGtfs, shapeId: string) {
  const store = cache(gtfs);
  let metric = store.metrics.get(shapeId);
  if (!metric) { const points = gtfs.shapes.get(shapeId); if (!points || points.length < 2) return null; metric = buildShapeMetric(points); store.metrics.set(shapeId, metric); }
  return metric;
}
export function tripPlan(gtfs: BizkaibusGtfs, tripId: string): Plan | null {
  const store = cache(gtfs);
  if (store.plans.has(tripId)) return store.plans.get(tripId)!;
  const trip = gtfs.trips.get(tripId);
  const metric = trip?.shapeId ? shapeMetric(gtfs, trip.shapeId) : null;
  if (!metric) { store.plans.set(tripId, null); return null; }
  const stops: Plan["stops"] = [];
  const anchors: Plan["anchors"] = [];
  for (const time of gtfs.tripStops.get(tripId) ?? []) {
    const stop = gtfs.stops.get(time.stopId);
    const arrival = parseGtfsTime(time.arrivalTime) ?? parseGtfsTime(time.departureTime);
    const departure = parseGtfsTime(time.departureTime) ?? arrival;
    if (!stop || arrival === null || departure === null) continue;
    const projection = projectOntoShape(metric, [stop.longitude, stop.latitude], stops.at(-1)?.progress ?? 0);
    if (!projection || projection.distanceMeters >= 600) continue;
    stops.push({ stopId: time.stopId, sequence: time.sequence, arrival, departure: Math.max(arrival, departure), progress: projection.progressMeters });
    anchors.push({ seconds: arrival, progress: projection.progressMeters });
    if (departure > arrival) anchors.push({ seconds: departure, progress: projection.progressMeters });
  }
  // Reject inconsistent time sequences rather than moving backwards along a trip.
  const plan = anchors.length > 1 && anchors.every((a, i) => i === 0 || a.seconds >= anchors[i - 1].seconds) ? { metric, anchors, stops } : null;
  store.plans.set(tripId, plan);
  return plan;
}
export function shiftDate(date: string, delta: number) {
  const day = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)) + delta, 12));
  return { date: `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, '0')}${String(day.getUTCDate()).padStart(2, '0')}`, weekday: (day.getUTCDay() + 6) % 7 };
}
export function serviceEpoch(date: string, seconds: number, timezone = 'Europe/Madrid'): number {
  const key = timezone + ':' + date;
  if (origins.has(key)) return origins.get(key)! + seconds * 1000;
  let offsetFormatter = offsetFormatters.get(timezone);
  if (!offsetFormatter) { offsetFormatter = new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'shortOffset' }); offsetFormatters.set(timezone, offsetFormatter); }
  const noon = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)), 12);
  const offset = offsetFormatter.formatToParts(noon).find((p) => p.type === "timeZoneName")!.value;
  const match = /GMT([+-])(\d+)(?::(\d+))?/.exec(offset);
  const offsetMinutes = match ? (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === "+" ? 1 : -1) : 0;
  // GTFS defines time relative to noon minus 12h on the service date, including DST days.
  const origin = noon - offsetMinutes * 60_000 - 43_200_000;
  if (origins.size >= 64) origins.delete(origins.keys().next().value!);
  origins.set(key, origin);
  return origin + seconds * 1000;
}
export function timelineFor(plan: Plan, date: string, delaySeconds = 0, timezone = 'Europe/Madrid'): MotionAnchor[] {
  const origin = serviceEpoch(date, delaySeconds, timezone);
  return plan.anchors.map((anchor) => ({ at: origin + anchor.seconds * 1000, progress: anchor.progress }));
}
export function shapePacket(metric: ShapeMetric, key: string): Shape {
  const coordinates: Shape["coordinates"] = []; const cumulative: number[] = [];
  for (let i = 0; i < metric.coordinates.length; i++) {
    if (i !== 0 && i !== metric.coordinates.length - 1 && metric.cumulativeMeters[i] - cumulative.at(-1)! < 12) {
      const a = coordinates.at(-1)!, b = metric.coordinates[i + 1], p = metric.coordinates[i];
      const sx = Math.cos(p[1] * Math.PI / 180) * 111320, sy = 110540;
      const x = (b[0] - a[0]) * sx, y = (b[1] - a[1]) * sy;
      const px = (p[0] - a[0]) * sx, py = (p[1] - a[1]) * sy;
      const t = Math.max(0, Math.min(1, (px * x + py * y) / Math.max(.001, x * x + y * y)));
      // Keep corners even at short spacing: distance-only thinning cut across bends.
      if (Math.hypot(px - x * t, py - y * t) < .5) continue;
    }
    coordinates.push(metric.coordinates[i]); cumulative.push(metric.cumulativeMeters[i]);
  }
  return { key, coordinates, cumulative, total: metric.totalMeters };
}
export function modeFor(routeType: number) {
  if (routeType === 7 || (routeType >= 1400 && routeType < 1500)) return 'funicular' as const;
  if (routeType === 0 || (routeType >= 900 && routeType < 1000)) return "tram" as const;
  if ([1, 2].includes(routeType) || (routeType >= 100 && routeType < 500)) return "rail" as const;
  if ([3, 11].includes(routeType) || (routeType >= 700 && routeType < 900)) return "bus" as const;
  return "unknown" as const;
}
