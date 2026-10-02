import type { BizkaibusGtfs } from "../providers/bizkaibus/gtfs";
import { buildShapeMetric, projectOntoShape, type ShapeMetric } from "./motionEngine";
import { formatServiceDate, parseGtfsTime } from "./gtfsCalendar";
import type { MotionAnchor, Shape } from "../../src/transit/networkTypes";

type Plan = { metric: ShapeMetric; anchors: { seconds: number; progress: number }[]; stops: { stopId: string; sequence: number; arrival: number; departure: number; progress: number }[] };
const caches = new WeakMap<BizkaibusGtfs, { metrics: Map<string, ShapeMetric>; plans: Map<string, Plan | null> }>();
function cache(gtfs: BizkaibusGtfs) {
  let value = caches.get(gtfs);
  if (!value) { value = { metrics: new Map(), plans: new Map() }; caches.set(gtfs, value); }
  return value;
}
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
  return formatServiceDate(day);
}
export function serviceEpoch(date: string, seconds: number): number {
  const noon = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)), 12);
  const offset = new Intl.DateTimeFormat("en", { timeZone: "Europe/Madrid", timeZoneName: "shortOffset" }).formatToParts(noon).find((p) => p.type === "timeZoneName")!.value;
  const match = /GMT([+-])(\d+)(?::(\d+))?/.exec(offset);
  const offsetMinutes = match ? (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === "+" ? 1 : -1) : 0;
  // GTFS defines time relative to noon minus 12h on the service date, including DST days.
  return noon - offsetMinutes * 60_000 - 43_200_000 + seconds * 1000;
}
export function timelineFor(plan: Plan, date: string, delaySeconds = 0): MotionAnchor[] {
  const origin = serviceEpoch(date, delaySeconds);
  return plan.anchors.map((anchor) => ({ at: origin + anchor.seconds * 1000, progress: anchor.progress }));
}
export function shapePacket(metric: ShapeMetric, key: string): Shape {
  const coordinates: Shape["coordinates"] = []; const cumulative: number[] = [];
  for (let i = 0; i < metric.coordinates.length; i++) {
    if (i !== 0 && i !== metric.coordinates.length - 1 && metric.cumulativeMeters[i] - cumulative.at(-1)! < 12) continue;
    coordinates.push(metric.coordinates[i]); cumulative.push(metric.cumulativeMeters[i]);
  }
  return { key, coordinates, cumulative, total: metric.totalMeters };
}
export function modeFor(routeType: number) {
  if (routeType === 0 || (routeType >= 900 && routeType < 1000)) return "tram" as const;
  if ([1, 2].includes(routeType) || (routeType >= 100 && routeType < 500)) return "rail" as const;
  if ([3, 11].includes(routeType) || (routeType >= 700 && routeType < 900)) return "bus" as const;
  return "unknown" as const;
}
