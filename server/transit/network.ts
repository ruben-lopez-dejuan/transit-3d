import { getBizkaibusGtfs, type BizkaibusGtfs } from "../providers/bizkaibus/gtfs";
import { BizkaibusProvider } from "../providers/bizkaibus/provider";
import { StaticGtfsProvider } from "../providers/staticGtfs";
import { renfeProvider } from '../providers/renfe';
import { bilbobusProvider } from '../providers/bilbobus';
import { RealtimeProvider } from '../providers/realtimeProvider';
import { RealtimeFeedClient } from '../providers/realtimeFeed';
import { freshTimestamp, tripInstanceKey, updatedTimeline } from './realtime';
import { TransitEngine } from "./engine";
import { formatServiceDate, isServiceActive, parseGtfsTime } from "./gtfsCalendar";
import { distanceMeters } from "./motionEngine";
import { passengerHeadsign, placeShortcuts } from './labels';
import { modeFor, serviceEpoch, shapeMetric, shapePacket, shiftDate, timelineFor, tripPlan } from "./plans";
import type { Network, Operator, Route, Stop, Snapshot, Vehicle, Departure, LineDetail, StopDetail, TripDetail, Shape } from "../../src/transit/networkTypes";

const definitions = [
  { id: "bizkaibus", name: "Bizkaibus", color: "#177857", realtime: true },
  { id: "bilbobus", name: "Bilbobus", color: "#c33b42", realtime: true },
  { id: "metro-bilbao", name: "Metro Bilbao", color: "#d95038", realtime: true },
  { id: "euskotren", name: "Euskotren", color: "#3275a6", realtime: true },
  { id: 'renfe', name: 'Renfe Cercanías', color: '#be1747', realtime: true },
];
const staticProviders = [
  renfeProvider,
  bilbobusProvider,
  new StaticGtfsProvider("metro-bilbao", "https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfs_metro_bilbao.zip"),
  new StaticGtfsProvider("euskotren", "https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfs_euskotren.zip"),
];
const realtimeProviders = [
  new RealtimeProvider(new BizkaibusProvider(), getBizkaibusGtfs, new RealtimeFeedClient('bizkaibus-tu', 'https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfsrt_bizkaibus_trip_updates.pb')),
  ...staticProviders.filter((p) => p.operatorId !== 'bilbobus').map((provider) => new RealtimeProvider(provider, () => provider.getGtfs(),
    new RealtimeFeedClient(`${provider.operatorId}-tu`, provider.operatorId === 'renfe' ? 'https://gtfsrt.renfe.com/trip_updates.pb' : `https://opendata.euskadi.eus/transport/moveuskadi/${provider.operatorId.replace('-', '_')}/gtfsrt_${provider.operatorId.replace('-', '_')}_trip_updates.pb`),
    provider.operatorId === 'renfe' ? new RealtimeFeedClient('renfe-vp', 'https://gtfsrt.renfe.com/vehicle_positions.pb') : undefined)),
];
const engine = new TransitEngine([...realtimeProviders, ...staticProviders.filter((p) => p.operatorId === 'bilbobus')]);
function updateFor(operatorId: string, date: string, tripId: string) {
  const update = realtimeProviders.find((p) => p.operatorId === operatorId)?.updates.get(tripInstanceKey(date, tripId));
  return update && freshTimestamp(update.updatedAt / 1000, Date.now()) !== null ? update : null;
}
const feeds = new Map<string, BizkaibusGtfs>();
const routeMap = new Map<string, Route>();
const stopMap = new Map<string, Stop>();
type StopReference = { tripId: string; seconds: number; stopId: string; sequence: number };
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
          stopReferences.get(key)!.push({ tripId, seconds, stopId: time.stopId, sequence: time.sequence });
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
  const update = updateFor(vehicle.operatorId, serviceDate, trip.tripId);
  let shiftSeconds = vehicle.delaySeconds ?? 0;
  let delaySeconds = vehicle.delaySeconds;
  let delayEstimated = false;
  if (!update && vehicle.tripIdentityQuality !== 'estimated' && plan && vehicle.positionQuality !== "scheduled" && vehicle.observationTimestamp !== null) {
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
  let fullTimeline = update ? updatedTimeline(gtfs, update) ?? (plan ? timelineFor(plan, serviceDate) : []) : plan ? timelineFor(plan, serviceDate, shiftSeconds) : [];
  if (update && vehicle.observationTimestamp !== null) {
    // The actual GPS anchors the map position; the forecasts control the following station times.
    fullTimeline = [{ at: now.getTime(), progress: vehicle.progressMetersAlongShape }, ...fullTimeline.filter((a) => a.at > now.getTime() && a.progress >= vehicle.progressMetersAlongShape)];
  }
  let nextAnchor = fullTimeline.findIndex((a) => a.at >= now.getTime());
  if (nextAnchor < 0) nextAnchor = fullTimeline.length - 1;
  const timeline = fullTimeline.slice(Math.max(0, nextAnchor - 1), nextAnchor + 5);
  const next = plan?.stops.find((s) => s.progress >= vehicle.progressMetersAlongShape + 10 && !update?.stops.get(s.sequence)?.skipped);
  const nextStop = next ? stopMap.get(`${vehicle.operatorId}:${next.stopId}`) : null;
  const nextUpdate = next ? update?.stops.get(next.sequence) : null;
  const siri = next && vehicle.operatorId === 'bilbobus' ? bilbobusProvider.peekArrival(vehicle.vehicleId, gtfs.stops.get(next.stopId)?.stopCode ?? '') : null;
  if (nextUpdate) { delaySeconds = nextUpdate.arrivalRealtime ? (nextUpdate.arrival - nextUpdate.scheduledArrival) / 1000 : null; delayEstimated = false; }
  return { ...vehicle, delaySeconds, delayEstimated, serviceDate, timeline, routeKey: route.key, shapeKey: `${vehicle.operatorId}:${vehicle.shapeId}`, label: route.shortName, headsign: passengerHeadsign(trip.headsign || route.longName, route.longName), color: route.color, operatorName: definitions.find((d) => d.id === vehicle.operatorId)!.name, nextStop: next && nextStop ? { key: nextStop.key, name: nextStop.name, at: siri?.arrival ?? nextUpdate?.arrival ?? serviceEpoch(serviceDate, next.arrival + shiftSeconds) } : null };
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
      const update = updateFor(operatorId, date.date, trip.tripId);
      const changed = update?.stops.get(reference.sequence);
      if (changed?.skipped) continue;
      const scheduledAt = origin + reference.seconds * 1000;
      const gpsEstimated = !update && vehicle?.tripIdentityQuality !== 'estimated' && vehicle?.positionQuality !== 'scheduled' && vehicle?.delaySeconds != null;
      const at = changed?.departure ?? scheduledAt + (gpsEstimated ? vehicle!.delaySeconds! * 1000 : 0);
      if (at < now.getTime() - 30_000 || at > now.getTime() + 6 * 3600_000) continue;
      const key = `${date.date}:${trip.tripId}:${reference.sequence}`;
      const realtime = changed?.departureRealtime || update?.canceled;
      const row: Departure = { routeKey: route.key, tripId: trip.tripId, label: route.shortName, headsign: passengerHeadsign(trip.headsign || route.longName, route.longName), operatorId, at, scheduledAt, updatedAt: realtime ? update!.updatedAt : gpsEstimated ? vehicle!.observationTimestamp : null, source: realtime ? 'realtime' : gpsEstimated ? 'gps' : 'schedule', canceled: update?.canceled ?? false, quality: realtime || gpsEstimated ? 'predicted' : 'scheduled', delaySeconds: changed?.departureRealtime ? (at - scheduledAt) / 1000 : gpsEstimated ? vehicle!.delaySeconds : null };
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
  const refs = trips.flatMap((trip) => { const first = gtfs.tripStops.get(trip.tripId)?.[0]; const seconds = first ? parseGtfsTime(first.departureTime) ?? parseGtfsTime(first.arrivalTime) : null; return seconds !== null && first ? [{ tripId: trip.tripId, seconds, stopId: first.stopId, sequence: first.sequence }] : []; });
  return { route, shapes, stops, departures: await departures(operatorId, refs, new Date()) };
}
export async function getStop(operatorId: string, stopId: string): Promise<StopDetail | null> {
  const network = await getNetwork(); const stop = stopMap.get(`${operatorId}:${stopId}`);
  if (!stop) return null;
  const nearbyStops = network.stops.filter((s) => distanceMeters([s.longitude, s.latitude], [stop.longitude, stop.latitude]) <= 80);
  const rows = await Promise.all(nearbyStops.map(async (s) => {
    const scheduled = await departures(s.operatorId, stopReferences.get(s.key) ?? [], new Date());
    if (s.operatorId !== 'bilbobus') return scheduled;
    try {
      const live = await bilbobusProvider.departures(feeds.get('bilbobus')!, feeds.get('bilbobus')!.stops.get(s.stopId)?.stopCode ?? '');
      const horizon = new Map<string, number>();
      live.forEach((r) => horizon.set(r.routeKey, Math.max(horizon.get(r.routeKey) ?? 0, r.at + 120_000)));
      return [...live, ...scheduled.filter((r) => r.at > (horizon.get(r.routeKey) ?? 0))].sort((a, b) => a.at - b.at);
    } catch { return scheduled; }
  }));
  const unique = new Map<string, Departure>();
  for (const row of rows.flat().sort((a, b) => a.at - b.at)) { const key = `${row.operatorId}:${row.tripId}:${row.at}`; if (!unique.has(key)) unique.set(key, row); }
  return { stop, nearbyStops, departures: [...unique.values()].slice(0, 16) };
}
export async function getTrip(operatorId: string, tripId: string, serviceDate: string, vehicleId?: string): Promise<TripDetail | null> {
  await getNetwork(); const gtfs = feeds.get(operatorId);
  if (!gtfs?.trips.has(tripId) || !/^\d{8}$/.test(serviceDate)) return null;
  const snapshot = await getPresentationSnapshot();
  const vehicle = snapshot.vehicles.find((v) => v.operatorId === operatorId && v.tripId === tripId && v.serviceDate === serviceDate && (!vehicleId || v.id === vehicleId));
  const plan = tripPlan(gtfs, tripId); const trip = gtfs.trips.get(tripId)!;
  const update = updateFor(operatorId, serviceDate, tripId);
  const shape = trip.shapeId ? shapeMetric(gtfs, trip.shapeId) : null;
  if (operatorId === 'bilbobus' && vehicle?.vehicleId && plan) {
    const upcoming = plan.stops.filter((s) => s.progress > vehicle.progressMetersAlongShape).slice(0, 3);
    await Promise.allSettled(upcoming.map((s) => bilbobusProvider.getArrivals(gtfs.stops.get(s.stopId)?.stopCode ?? '')));
  }
  return { vehicleId: vehicle?.id ?? `${operatorId}:${serviceDate}:${tripId}`, shape: shape && trip.shapeId ? shapePacket(shape, `${operatorId}:${trip.shapeId}`) : null, stops: (plan?.stops ?? []).flatMap((s) => { const stop = stopMap.get(`${operatorId}:${s.stopId}`), changed = update?.stops.get(s.sequence); const siri = operatorId === 'bilbobus' ? bilbobusProvider.peekArrival(vehicle?.vehicleId, gtfs.stops.get(s.stopId)?.stopCode ?? '') : null; return stop ? [{ ...stop, at: siri?.arrival ?? changed?.arrival ?? serviceEpoch(serviceDate, s.arrival + (vehicle?.delaySeconds ?? 0)), progress: s.progress, skipped: changed?.skipped ?? false, realtime: !!siri || (changed?.arrivalRealtime ?? false) }] : []; }) };
}
export async function getGeometries(keys: string[]): Promise<Shape[]> {
  await getNetwork();
  return keys.slice(0, 100).flatMap((key) => { const separator = key.indexOf(":"); const operatorId = key.slice(0, separator); const shapeId = key.slice(separator + 1); const gtfs = feeds.get(operatorId); const metric = gtfs ? shapeMetric(gtfs, shapeId) : null; return metric ? [shapePacket(metric, key)] : []; });
}
