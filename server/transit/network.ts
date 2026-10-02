import { getBizkaibusGtfs, type BizkaibusGtfs } from "../providers/bizkaibus/gtfs";
import { BizkaibusProvider } from "../providers/bizkaibus/provider";
import { StaticGtfsProvider } from "../providers/staticGtfs";
import { TransitEngine } from "./engine";
import { formatServiceDate, isServiceActive, parseGtfsTime } from "./gtfsCalendar";
import { distanceMeters } from "./motionEngine";
import { passengerHeadsign, placeShortcuts } from './labels';
import { modeFor, serviceEpoch, shapeMetric, shapePacket, shiftDate, timelineFor, tripPlan } from "./plans";
import type { Network, Operator, Route, Stop, Snapshot, Vehicle, Departure, LineDetail, StopDetail, TripDetail, Shape } from "../../src/transit/networkTypes";

const definitions = [
  { id: "bizkaibus", name: "Bizkaibus", color: "#177857", realtime: true },
  { id: "bilbobus", name: "Bilbobus", color: "#c33b42", realtime: false },
  { id: "metro-bilbao", name: "Metro Bilbao", color: "#d95038", realtime: false },
  { id: "euskotren", name: "Euskotren", color: "#3275a6", realtime: false },
];
const staticProviders = [
  new StaticGtfsProvider("bilbobus", "https://opendata.euskadi.eus/transport/moveuskadi/bilbobus/gtfs_bilbobus.zip"),
  new StaticGtfsProvider("metro-bilbao", "https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfs_metro_bilbao.zip"),
  new StaticGtfsProvider("euskotren", "https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfs_euskotren.zip"),
];
const engine = new TransitEngine([new BizkaibusProvider(), ...staticProviders]);
const feeds = new Map<string, BizkaibusGtfs>();
const routeMap = new Map<string, Route>();
const stopMap = new Map<string, Stop>();
type StopReference = { tripId: string; seconds: number };
const stopReferences = new Map<string, StopReference[]>();
let networkCache: Promise<Network> | null = null;
let networkExpires = 0;
let snapshotCache: Promise<Snapshot> | null = null;
let snapshotExpires = 0;

export function getNetwork(): Promise<Network> {
  if (networkCache && Date.now() < networkExpires) return networkCache;
  networkExpires = Date.now() + 6 * 3600_000;
  networkCache = loadNetwork().catch((error) => { networkCache = null; throw error; });
  return networkCache;
}
async function loadNetwork(): Promise<Network> {
  const operators: Operator[] = [];
  const loaded = await Promise.allSettled(definitions.map((definition) => feeds.has(definition.id)
    ? Promise.resolve(feeds.get(definition.id)!)
    : definition.id === "bizkaibus" ? getBizkaibusGtfs() : staticProviders.find((p) => p.operatorId === definition.id)!.getGtfs()));
  for (const [index, definition] of definitions.entries()) {
    try {
      if (feeds.has(definition.id)) { operators.push({ ...definition, status: "ok" }); continue; }
      const result = loaded[index];
      if (result.status === 'rejected') throw result.reason;
      const gtfs = result.value;
      feeds.set(definition.id, gtfs);
      operators.push({ ...definition, status: "ok" });
      for (const route of gtfs.routes.values()) {
        const counts = new Map<string, Map<string, number>>();
        for (const id of gtfs.routeTripIds.get(route.routeId) ?? []) {
          const trip = gtfs.trips.get(id)!;
          const direction = String(trip.directionId ?? "unknown");
          if (!counts.has(direction)) counts.set(direction, new Map());
          const headsigns = counts.get(direction)!;
          headsigns.set(trip.headsign, (headsigns.get(trip.headsign) ?? 0) + 1);
        }
        const directions = [...counts].map(([id, names]) => ({ id, name: passengerHeadsign([...names].sort((a, b) => b[1] - a[1])[0]?.[0] || "Recorrido", route.longName) }));
        const item: Route = { ...route, key: `${definition.id}:${route.routeId}`, operatorId: definition.id, mode: modeFor(route.routeType), color: /^#?[a-f\d]{6}$/i.test(route.color) ? `#${route.color.replace("#", "")}` : definition.color, textColor: `#${route.textColor.replace("#", "")}`, directions };
        routeMap.set(item.key, item);
      }
      const modes = new Map<string, Set<Route["mode"]>>();
      for (const [tripId, times] of gtfs.tripStops) {
        const trip = gtfs.trips.get(tripId)!;
        const mode = modeFor(gtfs.routes.get(trip.routeId)?.routeType ?? -1);
        for (const time of times) {
          if (!modes.has(time.stopId)) modes.set(time.stopId, new Set());
          modes.get(time.stopId)!.add(mode);
          const seconds = parseGtfsTime(time.departureTime) ?? parseGtfsTime(time.arrivalTime);
          if (seconds === null) continue;
          const key = `${definition.id}:${time.stopId}`;
          if (!stopReferences.has(key)) stopReferences.set(key, []);
          stopReferences.get(key)!.push({ tripId, seconds });
        }
      }
      for (const stop of gtfs.stops.values()) {
        if (!modes.has(stop.stopId)) continue;
        const item: Stop = { ...stop, key: `${definition.id}:${stop.stopId}`, operatorId: definition.id, modes: [...modes.get(stop.stopId)!] };
        stopMap.set(item.key, item);
      }
    } catch (error) {
      console.warn(`[${definition.id}] Catalog unavailable:`, error instanceof Error ? error.message : error);
      operators.push({ ...definition, status: "unavailable" });
      networkExpires = Math.min(networkExpires, Date.now() + 60_000);
    }
  }
  const stops = [...stopMap.values()];
  // Place shortcuts use coordinates supplied by the official transport network.
  const places = placeShortcuts(stops);
  return { operators, routes: [...routeMap.values()].sort((a, b) => a.shortName.localeCompare(b.shortName, "es", { numeric: true })), stops, places };
}

function enrich(vehicle: import("./types").TransitVehicle, now: Date): Vehicle | null {
  const gtfs = feeds.get(vehicle.operatorId);
  const trip = gtfs?.trips.get(vehicle.tripId);
  const route = routeMap.get(`${vehicle.operatorId}:${vehicle.routeId}`);
  if (!gtfs || !trip || !route) return null;
  const serviceDate = vehicle.id.split(":")[1] || formatServiceDate(now).date;
  const plan = tripPlan(gtfs, trip.tripId);
  let shiftSeconds = vehicle.delaySeconds ?? 0;
  let delaySeconds = vehicle.delaySeconds;
  let delayEstimated = false;
  if (plan && vehicle.positionQuality !== "scheduled" && vehicle.observationTimestamp !== null) {
    const interval = plan.anchors.find((a, i) => i > 0 && a.progress > plan.anchors[i - 1].progress && vehicle.progressMetersAlongShape >= plan.anchors[i - 1].progress - 2 && vehicle.progressMetersAlongShape <= a.progress + 2);
    if (interval) {
      const index = plan.anchors.indexOf(interval);
      const previous = plan.anchors[index - 1];
      const fraction = Math.max(0, Math.min(1, (vehicle.progressMetersAlongShape - previous.progress) / (interval.progress - previous.progress)));
      const scheduleAt = serviceEpoch(serviceDate, previous.seconds + fraction * (interval.seconds - previous.seconds));
      const positionAt = vehicle.positionQuality === "predicted" ? now.getTime() : vehicle.observationTimestamp;
      shiftSeconds = Math.round((positionAt - scheduleAt) / 1000);
      if (Math.abs(shiftSeconds) <= 3600) { delaySeconds = shiftSeconds; delayEstimated = true; }
    }
  }
  const fullTimeline = plan ? timelineFor(plan, serviceDate, shiftSeconds) : [];
  let nextAnchor = fullTimeline.findIndex((a) => a.at >= now.getTime());
  if (nextAnchor < 0) nextAnchor = fullTimeline.length - 1;
  const timeline = fullTimeline.slice(Math.max(0, nextAnchor - 1), nextAnchor + 5);
  const next = plan?.stops.find((s) => s.progress >= vehicle.progressMetersAlongShape + 10);
  const nextStop = next ? stopMap.get(`${vehicle.operatorId}:${next.stopId}`) : null;
  return { ...vehicle, delaySeconds, delayEstimated, serviceDate, timeline, routeKey: route.key, shapeKey: `${vehicle.operatorId}:${vehicle.shapeId}`, label: route.shortName, headsign: passengerHeadsign(trip.headsign || route.longName, route.longName), color: route.color, operatorName: definitions.find((d) => d.id === vehicle.operatorId)!.name, nextStop: next && nextStop ? { key: nextStop.key, name: nextStop.name, at: serviceEpoch(serviceDate, next.arrival + shiftSeconds) } : null };
}
export async function getPresentationSnapshot(): Promise<Snapshot> {
  await getNetwork();
  if (snapshotCache && Date.now() < snapshotExpires) return snapshotCache;
  snapshotExpires = Date.now() + 5000;
  snapshotCache = engine.getSnapshot().then((snapshot) => ({ fetchedAt: snapshot.fetchedAt, vehicles: snapshot.vehicles.map((v) => enrich(v, new Date(snapshot.fetchedAt))).filter((v): v is Vehicle => v !== null), providers: snapshot.providers.map(({ vehicles: _vehicles, ...status }) => status) })).catch((error) => { snapshotCache = null; throw error; });
  return snapshotCache;
}

async function departures(operatorId: string, references: StopReference[], now: Date, max = 12): Promise<Departure[]> {
  const gtfs = feeds.get(operatorId)!;
  const snapshot = await getPresentationSnapshot();
  const vehicles = new Map(snapshot.vehicles.map((v) => [`${v.operatorId}:${v.serviceDate}:${v.tripId}`, v]));
  const today = formatServiceDate(now).date;
  const result = new Map<string, Departure>();
  for (const delta of [-1, 0, 1]) {
    const date = shiftDate(today, delta);
    const origin = serviceEpoch(date.date, 0);
    for (const reference of references) {
      const trip = gtfs.trips.get(reference.tripId);
      if (!trip || !isServiceActive(gtfs, trip.serviceId, date.date, date.weekday)) continue;
      const route = routeMap.get(`${operatorId}:${trip.routeId}`)!;
      const vehicle = vehicles.get(`${operatorId}:${date.date}:${trip.tripId}`);
      const at = origin + (reference.seconds + (vehicle?.delaySeconds ?? 0)) * 1000;
      if (at < now.getTime() - 30_000 || at > now.getTime() + 6 * 3600_000) continue;
      const key = `${date.date}:${trip.tripId}`;
      const row: Departure = { routeKey: route.key, tripId: trip.tripId, label: route.shortName, headsign: passengerHeadsign(trip.headsign || route.longName, route.longName), operatorId, at, quality: vehicle && vehicle.positionQuality !== "scheduled" && vehicle.delaySeconds !== null ? "predicted" : "scheduled", delaySeconds: vehicle?.delaySeconds ?? null };
      if (!result.has(key) || at < result.get(key)!.at) result.set(key, row);
    }
  }
  return [...result.values()].sort((a, b) => a.at - b.at).slice(0, max);
}
export async function getLine(operatorId: string, routeId: string, direction?: string): Promise<LineDetail | null> {
  await getNetwork();
  const gtfs = feeds.get(operatorId); const route = routeMap.get(`${operatorId}:${routeId}`);
  if (!gtfs || !route) return null;
  const trips = (gtfs.routeTripIds.get(routeId) ?? []).map((id) => gtfs.trips.get(id)!).filter((t) => !direction || direction === "all" || String(t.directionId ?? "unknown") === direction);
  const shapeIds = new Map<string, number>();
  for (const trip of trips) if (trip.shapeId) shapeIds.set(trip.shapeId, (shapeIds.get(trip.shapeId) ?? 0) + 1);
  const shapes = [...shapeIds].sort((a, b) => b[1] - a[1]).slice(0, 6).flatMap(([id]) => { const metric = shapeMetric(gtfs, id); return metric ? [shapePacket(metric, `${operatorId}:${id}`)] : []; });
  const representative = [...trips].sort((a, b) => (gtfs.tripStops.get(b.tripId)?.length ?? 0) - (gtfs.tripStops.get(a.tripId)?.length ?? 0))[0];
  const stops = (representative ? gtfs.tripStops.get(representative.tripId) ?? [] : []).flatMap((s) => { const stop = stopMap.get(`${operatorId}:${s.stopId}`); return stop ? [stop] : []; });
  const refs = trips.flatMap((trip) => { const first = gtfs.tripStops.get(trip.tripId)?.[0]; const seconds = first ? parseGtfsTime(first.departureTime) ?? parseGtfsTime(first.arrivalTime) : null; return seconds !== null ? [{ tripId: trip.tripId, seconds }] : []; });
  return { route, shapes, stops, departures: await departures(operatorId, refs, new Date()) };
}
export async function getStop(operatorId: string, stopId: string): Promise<StopDetail | null> {
  const network = await getNetwork(); const stop = stopMap.get(`${operatorId}:${stopId}`);
  if (!stop) return null;
  const nearbyStops = network.stops.filter((s) => distanceMeters([s.longitude, s.latitude], [stop.longitude, stop.latitude]) <= 80);
  const rows = await Promise.all(nearbyStops.map((s) => departures(s.operatorId, stopReferences.get(s.key) ?? [], new Date())));
  const unique = new Map<string, Departure>();
  for (const row of rows.flat().sort((a, b) => a.at - b.at)) { const key = `${row.operatorId}:${row.tripId}:${row.at}`; if (!unique.has(key)) unique.set(key, row); }
  return { stop, nearbyStops, departures: [...unique.values()].slice(0, 16) };
}
export async function getTrip(operatorId: string, tripId: string, serviceDate: string): Promise<TripDetail | null> {
  await getNetwork(); const gtfs = feeds.get(operatorId);
  if (!gtfs?.trips.has(tripId) || !/^\d{8}$/.test(serviceDate)) return null;
  const snapshot = await getPresentationSnapshot();
  const vehicle = snapshot.vehicles.find((v) => v.operatorId === operatorId && v.tripId === tripId && v.serviceDate === serviceDate);
  const plan = tripPlan(gtfs, tripId); const trip = gtfs.trips.get(tripId)!;
  const shape = trip.shapeId ? shapeMetric(gtfs, trip.shapeId) : null;
  return { vehicleId: vehicle?.id ?? `${operatorId}:${serviceDate}:${tripId}`, shape: shape && trip.shapeId ? shapePacket(shape, `${operatorId}:${trip.shapeId}`) : null, stops: (plan?.stops ?? []).flatMap((s) => { const stop = stopMap.get(`${operatorId}:${s.stopId}`); return stop ? [{ ...stop, at: serviceEpoch(serviceDate, s.arrival + (vehicle?.delaySeconds ?? 0)), progress: s.progress }] : []; }) };
}
export async function getGeometries(keys: string[]): Promise<Shape[]> {
  await getNetwork();
  return keys.slice(0, 100).flatMap((key) => { const separator = key.indexOf(":"); const operatorId = key.slice(0, separator); const shapeId = key.slice(separator + 1); const gtfs = feeds.get(operatorId); const metric = gtfs ? shapeMetric(gtfs, shapeId) : null; return metric ? [shapePacket(metric, key)] : []; });
}
