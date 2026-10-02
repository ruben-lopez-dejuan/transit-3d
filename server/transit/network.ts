import type { BizkaibusGtfs } from "../providers/bizkaibus/gtfs";
import { cityRegistry, defaultCityId } from '../cities';
import type { RuntimeCityPackage } from './cityPackage';
import type { NormalizedVehicle } from '../../shared/transit/contracts';
import { entityId, parseEntityId, type EntityKind } from '../../shared/transit/ids';
import { normalizeRoute, normalizeStop, normalizeTrip } from './normalization';
import { freshTimestamp, tripInstanceKey, updatedTimeline } from './realtime';
import { TransitEngine } from "./engine";
import { formatServiceDate, isServiceActive, parseGtfsTime } from "./gtfsCalendar";
import { distanceMeters } from "./motionEngine";
import { passengerHeadsign } from './labels';
import { anchorGpsTimeline } from './gpsTimeline';
import { modeFor, serviceEpoch, shapeMetric, shapePacket, shiftDate, timelineFor, tripPlan } from "./plans";
import type { Network, Operator, Route, Stop, Snapshot, Vehicle, Departure, LineDetail, StopDetail, TripDetail, Shape } from '../../shared/transit/network';

/** Each city owns its caches, catalog and provider bindings. */
export function createCityNetwork(city: RuntimeCityPackage) {
const definitions = city.manifest.providers;
const providers = city.providers;
const gtfsLoaders = new Map(providers.map((provider) => [provider.operatorId, () => provider.enabled ? provider.getGtfs() : Promise.reject(new Error('Provider disabled'))]));
const providerFor = (id: string) => providers.find((p) => p.operatorId === id);
const key = (providerId: string, kind: EntityKind, externalId: string) => entityId(city.manifest.id, providerId, kind, externalId);
const scope = (providerId: string) => ({ cityId: city.manifest.id, providerId });
const engine = new TransitEngine(providers);
function updateFor(operatorId: string, date: string, tripId: string) {
  const provider = providerFor(operatorId);
  const update = provider?.enabled ? provider.getUpdates?.().get(tripInstanceKey(date, tripId)) : null;
  return update && freshTimestamp(update.updatedAt / 1000, Date.now()) !== null ? update : null;
}
const feeds = new Map<string, BizkaibusGtfs>();
const routeMap = new Map<string, Route>();
const stopMap = new Map<string, Stop>();
const packets = new Map<string, Shape>();
const lineGeometry = new Map<string, Pick<LineDetail, 'shapes' | 'stops'>>();
function packet(operatorId: string, shapeId: string) {
  const shapeKey = key(operatorId, 'shape', shapeId);
  if (packets.has(shapeKey)) return packets.get(shapeKey)!;
  const gtfs = feeds.get(operatorId), metric = gtfs ? shapeMetric(gtfs, shapeId) : null;
  if (!gtfs || !metric) return null;
  const result = { ...shapePacket(metric, shapeKey), underground: city.infrastructure(gtfs, operatorId, shapeId) };
  packets.set(shapeKey, result); return result;
}
type StopReference = { tripId: string; seconds: number; stopId: string; sequence: number };
const stopReferences = new Map<string, StopReference[]>();
let networkCache: Promise<Network> | null = null;
let networkExpires = 0;
let snapshotCache: Promise<Snapshot> | null = null;
let snapshotExpires = 0;

function getNetwork(): Promise<Network> {
  if (networkCache && Date.now() < networkExpires) return networkCache;
  networkExpires = Date.now() + 6 * 3600_000;
  networkCache = loadNetwork().catch((error) => { networkCache = null; throw error; });
  return networkCache;
}
async function loadNetwork(): Promise<Network> {
  const operators: Operator[] = [];
  const loaded = await Promise.allSettled(definitions.map((definition) => gtfsLoaders.get(definition.id)!()));
  for (const [index, definition] of definitions.entries()) {
    try {
      const result = loaded[index];
      if (result.status === 'rejected') throw result.reason;
      const gtfs = result.value;
      if (feeds.get(definition.id) === gtfs) { operators.push({ ...definition, status: 'ok' }); continue; }
      const prefix = `${encodeURIComponent(city.manifest.id)}:${encodeURIComponent(definition.id)}:`;
      for (const store of [routeMap, stopMap, stopReferences, packets, lineGeometry]) for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
      snapshotCache = null;
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
        const normalized = normalizeRoute(route, scope(definition.id), definition, directions);
        const item: Route = { ...normalized, key: normalized.id, operatorId: definition.id, routeId: route.routeId, appearance: providerFor(definition.id)?.appearanceFor?.({ mode: normalized.mode, routeId: route.routeId }, route.shortName) };
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
          const stopKey = key(definition.id, 'stop', time.stopId);
          if (!stopReferences.has(stopKey)) stopReferences.set(stopKey, []);
          stopReferences.get(stopKey)!.push({ tripId, seconds, stopId: time.stopId, sequence: time.sequence });
        }
      }
      for (const stop of gtfs.stops.values()) {
        if (!modes.has(stop.stopId)) continue;
        const normalized = normalizeStop(stop, scope(definition.id), [...modes.get(stop.stopId)!]);
        const item: Stop = { ...normalized, key: normalized.id, stopId: stop.stopId, operatorId: definition.id };
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
  const places = city.places(stops);
  return { city: city.manifest, operators, routes: [...routeMap.values()].sort((a, b) => a.shortName.localeCompare(b.shortName, 'es', { numeric: true })), stops, places };
}

function enrich(vehicle: NormalizedVehicle, now: Date): Vehicle | null {
  const gtfs = feeds.get(vehicle.operatorId);
  const trip = gtfs?.trips.get(vehicle.externalTripId);
  const route = routeMap.get(vehicle.routeId);
  if (!gtfs || !trip || !route) return null;
  const serviceDate = vehicle.serviceDate;
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
      const scheduleAt = serviceEpoch(serviceDate, previous.seconds + fraction * (interval.seconds - previous.seconds), city.manifest.timezone);
      const positionAt = vehicle.observationTimestamp;
      shiftSeconds = Math.round((positionAt - scheduleAt) / 1000);
      if (Math.abs(shiftSeconds) <= 3600) { delaySeconds = shiftSeconds; delayEstimated = true; }
    }
  }
  let fullTimeline = update ? updatedTimeline(gtfs, update) ?? (plan ? timelineFor(plan, serviceDate, 0, city.manifest.timezone) : []) : plan ? timelineFor(plan, serviceDate, shiftSeconds, city.manifest.timezone) : [];
  if (vehicle.observationTimestamp !== null) {
    // The actual GPS anchors the map position; the forecasts control the following station times.
    fullTimeline = anchorGpsTimeline(fullTimeline, { at: vehicle.observationTimestamp, progress: vehicle.observationProgressMeters ?? vehicle.progressMetersAlongShape });
  }
  let nextAnchor = fullTimeline.findIndex((a) => a.at >= now.getTime());
  if (nextAnchor < 0) nextAnchor = fullTimeline.length - 1;
  const timeline = vehicle.observationTimestamp !== null ? fullTimeline.slice(0, Math.max(6, nextAnchor + 5)) : fullTimeline.slice(Math.max(0, nextAnchor - 1), nextAnchor + 5);
  const next = plan?.stops.find((s) => s.progress >= vehicle.progressMetersAlongShape + 10 && !update?.stops.get(s.sequence)?.skipped);
  const nextStop = next ? stopMap.get(key(vehicle.operatorId, 'stop', next.stopId)) : null;
  const nextUpdate = next ? update?.stops.get(next.sequence) : null;
  const siri = next ? providerFor(vehicle.operatorId)?.arrivals?.peek(gtfs, next.stopId, vehicle.vehicleId) : null;
  if (nextUpdate) { delaySeconds = nextUpdate.arrivalRealtime ? (nextUpdate.arrival - nextUpdate.scheduledArrival) / 1000 : null; delayEstimated = false; }
  const destination = passengerHeadsign(trip.headsign || route.longName, route.longName);
  return { ...vehicle, delaySeconds, delayEstimated, serviceDate, timeline, routeShortName: route.shortName, destination, nextStopId: nextStop?.id ?? null, appearance: route.appearance, routeKey: route.key, shapeKey: vehicle.shapeId, label: route.shortName, headsign: destination, color: route.color, operatorName: definitions.find((d) => d.id === vehicle.operatorId)!.name, nextStop: next && nextStop ? { key: nextStop.key, name: nextStop.name, at: siri?.arrival ?? nextUpdate?.arrival ?? serviceEpoch(serviceDate, next.arrival + shiftSeconds, city.manifest.timezone) } : null };
}
async function getPresentationSnapshot(): Promise<Snapshot> {
  await getNetwork();
  if (snapshotCache && Date.now() < snapshotExpires) return snapshotCache;
  snapshotExpires = Infinity;
  snapshotCache = engine.getSnapshot().then((snapshot) => { snapshotExpires = Date.now() + 5000; return ({ cityId: city.manifest.id, fetchedAt: snapshot.fetchedAt, vehicles: snapshot.vehicles.map((v) => enrich(v, new Date(snapshot.fetchedAt))).filter((v): v is Vehicle => v !== null), providers: snapshot.providers.map(({ vehicles: _vehicles, ...status }) => status) }); }).catch((error) => { snapshotCache = null; throw error; });
  return snapshotCache;
}

async function departures(operatorId: string, references: StopReference[], now: Date, max = 12): Promise<Departure[]> {
  const gtfs = feeds.get(operatorId)!;
  const snapshot = await getPresentationSnapshot();
  const vehicles = new Map(snapshot.vehicles.map((v) => [`${v.operatorId}:${v.serviceDate}:${v.externalTripId}`, v]));
  const today = formatServiceDate(now, city.manifest.timezone).date;
  const result = new Map<string, Departure>();
  for (const delta of [-1, 0, 1]) {
    const date = shiftDate(today, delta);
    const origin = serviceEpoch(date.date, 0, city.manifest.timezone);
    for (const reference of references) {
      const trip = gtfs.trips.get(reference.tripId);
      if (!trip || !isServiceActive(gtfs, trip.serviceId, date.date, date.weekday)) continue;
      const route = routeMap.get(key(operatorId, 'route', trip.routeId))!;
      const vehicle = vehicles.get(`${operatorId}:${date.date}:${trip.tripId}`);
      const update = updateFor(operatorId, date.date, trip.tripId);
      const changed = update?.stops.get(reference.sequence);
      if (changed?.skipped) continue;
      const scheduledAt = origin + reference.seconds * 1000;
      const gpsEstimated = !update && vehicle?.tripIdentityQuality !== 'estimated' && vehicle?.positionQuality !== 'scheduled' && vehicle?.delaySeconds != null;
      const at = changed?.departure ?? scheduledAt + (gpsEstimated ? vehicle!.delaySeconds! * 1000 : 0);
      if (at < now.getTime() - 30_000 || at > now.getTime() + 6 * 3600_000) continue;
      const departureKey = `${date.date}:${trip.tripId}:${reference.sequence}`;
      const realtime = changed?.departureRealtime || update?.canceled;
      const row: Departure = { routeKey: route.key, tripId: key(operatorId, 'trip', trip.tripId), label: route.shortName, headsign: passengerHeadsign(trip.headsign || route.longName, route.longName), operatorId, at, scheduledAt, updatedAt: realtime ? update!.updatedAt : gpsEstimated ? vehicle!.observationTimestamp : null, source: realtime ? 'realtime' : gpsEstimated ? 'gps' : 'schedule', canceled: update?.canceled ?? false, quality: realtime || gpsEstimated ? 'predicted' : 'scheduled', delaySeconds: changed?.departureRealtime ? (at - scheduledAt) / 1000 : gpsEstimated ? vehicle!.delaySeconds : null };
      if (!result.has(departureKey) || at < result.get(departureKey)!.at) result.set(departureKey, row);
    }
  }
  return [...result.values()].sort((a, b) => a.at - b.at).slice(0, max);
}
async function getLine(operatorId: string, routeId: string, direction?: string): Promise<LineDetail | null> {
  await getNetwork();
  const gtfs = feeds.get(operatorId); const route = routeMap.get(key(operatorId, 'route', routeId));
  if (!gtfs || !route) return null;
  const trips = (gtfs.routeTripIds.get(routeId) ?? []).map((id) => gtfs.trips.get(id)!).filter((t) => !direction || direction === "all" || String(t.directionId ?? "unknown") === direction);
  const shapeIds = new Map<string, number>();
  for (const trip of trips) if (trip.shapeId) shapeIds.set(trip.shapeId, (shapeIds.get(trip.shapeId) ?? 0) + 1);
  const cacheKey = key(operatorId, 'route', routeId) + ':' + encodeURIComponent(direction ?? 'all');
  const cached = lineGeometry.get(cacheKey);
  const shapes = cached?.shapes ?? [...shapeIds].sort((a, b) => b[1] - a[1]).slice(0, 6).flatMap(([id]) => { const shape = packet(operatorId, id); return shape ? [shape] : []; });
  const representative = [...trips].sort((a, b) => (gtfs.tripStops.get(b.tripId)?.length ?? 0) - (gtfs.tripStops.get(a.tripId)?.length ?? 0))[0];
  const stops = cached?.stops ?? (representative ? gtfs.tripStops.get(representative.tripId) ?? [] : []).flatMap((s) => { const stop = stopMap.get(key(operatorId, 'stop', s.stopId)); return stop ? [stop] : []; });
  if (!cached) lineGeometry.set(cacheKey, { shapes, stops });
  const refs = trips.flatMap((trip) => { const first = gtfs.tripStops.get(trip.tripId)?.[0]; const seconds = first ? parseGtfsTime(first.departureTime) ?? parseGtfsTime(first.arrivalTime) : null; return seconds !== null && first ? [{ tripId: trip.tripId, seconds, stopId: first.stopId, sequence: first.sequence }] : []; });
  return { route, shapes, stops, departures: await departures(operatorId, refs, new Date()) };
}
async function getStop(operatorId: string, stopId: string): Promise<StopDetail | null> {
  const network = await getNetwork(); const stop = stopMap.get(key(operatorId, 'stop', stopId));
  if (!stop) return null;
  const nearbyStops = network.stops.filter((s) => distanceMeters([s.longitude, s.latitude], [stop.longitude, stop.latitude]) <= 80);
  const rows = await Promise.all(nearbyStops.map(async (s) => {
    const scheduled = await departures(s.operatorId, stopReferences.get(s.key) ?? [], new Date());
    const provider = providerFor(s.operatorId);
    if (!provider?.enabled || !provider.arrivals) return scheduled;
    try {
      const live = await provider.arrivals.departures(feeds.get(s.operatorId)!, s.stopId);
      const horizon = new Map<string, number>();
      live.forEach((r) => horizon.set(r.routeKey, Math.max(horizon.get(r.routeKey) ?? 0, r.at + 120_000)));
      return [...live, ...scheduled.filter((r) => r.at > (horizon.get(r.routeKey) ?? 0))].sort((a, b) => a.at - b.at);
    } catch { return scheduled; }
  }));
  const unique = new Map<string, Departure>();
  for (const row of rows.flat().sort((a, b) => a.at - b.at)) { const key = `${row.operatorId}:${row.tripId}:${row.at}`; if (!unique.has(key)) unique.set(key, row); }
  return { stop, nearbyStops, departures: [...unique.values()].slice(0, 16) };
}
async function getTrip(operatorId: string, tripId: string, serviceDate: string, vehicleId?: string): Promise<TripDetail | null> {
  await getNetwork(); const gtfs = feeds.get(operatorId);
  if (!gtfs?.trips.has(tripId) || !/^\d{8}$/.test(serviceDate)) return null;
  const snapshot = await getPresentationSnapshot();
  const vehicle = snapshot.vehicles.find((v) => v.operatorId === operatorId && v.externalTripId === tripId && v.serviceDate === serviceDate && (!vehicleId || v.id === vehicleId));
  const plan = tripPlan(gtfs, tripId); const trip = gtfs.trips.get(tripId)!;
  const update = updateFor(operatorId, serviceDate, tripId);
  const shape = trip.shapeId ? shapeMetric(gtfs, trip.shapeId) : null;
  const arrivals = providerFor(operatorId)?.enabled ? providerFor(operatorId)?.arrivals : undefined;
  if (arrivals && vehicle?.vehicleId && plan) {
    const upcoming = plan.stops.filter((s) => s.progress > vehicle.progressMetersAlongShape).slice(0, 3);
    await arrivals.warm(gtfs, upcoming.map((s) => s.stopId));
  }
  return { vehicleId: vehicle?.id ?? key(operatorId, 'vehicle', `${operatorId}:${serviceDate}:${tripId}`), trip: normalizeTrip(trip, scope(operatorId)), shape: shape && trip.shapeId ? packet(operatorId, trip.shapeId) : null, stops: (plan?.stops ?? []).flatMap((s) => { const stop = stopMap.get(key(operatorId, 'stop', s.stopId)), changed = update?.stops.get(s.sequence); const siri = arrivals?.peek(gtfs, s.stopId, vehicle?.vehicleId); return stop ? [{ ...stop, at: siri?.arrival ?? changed?.arrival ?? serviceEpoch(serviceDate, s.arrival + (vehicle?.delaySeconds ?? 0), city.manifest.timezone), progress: s.progress, skipped: changed?.skipped ?? false, realtime: !!siri || (changed?.arrivalRealtime ?? false) }] : []; }) };
}
async function getGeometries(keys: string[]): Promise<Shape[]> {
  await getNetwork();
  return keys.slice(0, 100).flatMap((id) => { const parsed = parseEntityId(id); if (!parsed || parsed.cityId !== city.manifest.id || parsed.kind !== 'shape') return []; const gtfs = feeds.get(parsed.providerId); const metric = gtfs ? shapeMetric(gtfs, parsed.externalId) : null; const shape = metric ? packet(parsed.providerId, parsed.externalId) : null; return shape ? [shape] : []; });
}
return { getNetwork, getPresentationSnapshot, getLine, getStop, getTrip, getGeometries };
}
const networks = new Map<string, ReturnType<typeof createCityNetwork>>();
export function getCityNetwork(cityId = defaultCityId) {
  let network = networks.get(cityId);
  if (!network) {
    const city = cityRegistry.getCity(cityId);
    if (!city) throw new Error('Unknown city: ' + cityId);
    network = createCityNetwork(city); networks.set(cityId, network);
  }
  return network;
}
// Existing HTTP routes and scripts retain their default-city entry points.
export const getNetwork = () => getCityNetwork().getNetwork();
export const getPresentationSnapshot = () => getCityNetwork().getPresentationSnapshot();
export const getLine = (...args: Parameters<ReturnType<typeof createCityNetwork>['getLine']>) => getCityNetwork().getLine(...args);
export const getStop = (...args: Parameters<ReturnType<typeof createCityNetwork>['getStop']>) => getCityNetwork().getStop(...args);
export const getTrip = (...args: Parameters<ReturnType<typeof createCityNetwork>['getTrip']>) => getCityNetwork().getTrip(...args);
export const getGeometries = (keys: string[]) => getCityNetwork().getGeometries(keys);
