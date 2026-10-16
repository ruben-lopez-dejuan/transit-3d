import type { BizkaibusGtfs } from "../providers/bizkaibus/gtfs";
import { cityRegistry, defaultCityId } from '../cities';
import type { RuntimeCityPackage } from './cityPackage';
import type { NormalizedVehicle } from '../../shared/transit/contracts';
import { entityId, parseEntityId, type EntityKind } from '../../shared/transit/ids';
import { normalizeRoute, normalizeStop, normalizeTrip } from './normalization';
import { freshTimestamp, tripInstanceKey, updatedTimeline } from './realtime';
import { TransitEngine } from "./engine";
import { formatServiceDate, isServiceActive, parseGtfsTime } from "./gtfsCalendar";
import { passengerHeadsign } from './labels';
import { anchorGpsTimeline } from './gpsTimeline';
import { carryRealtimeDelay, mergeStopForecasts, timeAtProgress, type StopForecast } from './stopForecasts';
import { withStationDwell } from './stationDwell';
import { bearingDegrees, sameSpotStops } from './sameSpotStops';
import { officialNextStop, withOfficialPosition } from './officialPosition';
import { modeFor, serviceEpoch, shapeMetric, shapePacket, shiftDate, timelineFor, tripPlan } from "./plans";
import { onTrackStretches } from './routedSegments';
import type { Network, Operator, Route, Stop, Snapshot, Vehicle, Departure, LineDetail, StopDetail, TripDetail, Shape, MotionAnchor, TimelineSource } from '../../shared/transit/network';
import type { AdminCatalogDiagnostics } from '../../shared/transit/admin';
import { transitDebugTraceStore } from '../admin/traceStore';

/** Each city owns its caches, catalog and provider bindings. */
export function createCityNetwork(city: RuntimeCityPackage, options: { catalogWaitMs?: number } = {}) {
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
// A forecast this far from the base timeline belongs to another journey of the same vehicle.
const MAX_FORECAST_DEVIATION_MS = 3600_000;
/** Fresh provider (SIRI) stop forecasts for this vehicle's trip, in stop order and never running backwards in time. */
function cachedStopForecasts(vehicle: NormalizedVehicle, gtfs: BizkaibusGtfs, plan: NonNullable<ReturnType<typeof tripPlan>>, base: MotionAnchor[], now: Date): StopForecast[] {
  const provider = providerFor(vehicle.operatorId);
  const arrivals = provider?.enabled ? provider.arrivals : undefined;
  if (!arrivals || !vehicle.externalVehicleId) return [];
  const observedAt = vehicle.observationTimestamp;
  // A GPS fix tells which stops are already behind. Without one the estimated
  // position may lag reality, so every stop of the trip is considered.
  const observedProgress = observedAt !== null ? vehicle.observationProgressMeters ?? vehicle.progressMetersAlongShape : -Infinity;
  const result: StopForecast[] = [];
  // Walk backwards: a row for a later passage of the same vehicle (its next
  // journey) is always too late, so the earliest coherent sequence is kept.
  let nextAt = Infinity;
  for (const stop of [...plan.stops].reverse()) {
    if (stop.progress < observedProgress - 10) break;
    const forecast = arrivals.peek(gtfs, stop.stopId, vehicle.externalVehicleId);
    if (!forecast || freshTimestamp(forecast.sourceTimestamp / 1000, now.getTime()) === null || !Number.isFinite(forecast.arrival)) continue;
    const departure = Number.isFinite(forecast.departure) ? Math.max(forecast.arrival, forecast.departure!) : forecast.arrival;
    if ((observedAt !== null && forecast.arrival < observedAt) || departure > nextAt) continue;
    const expected = timeAtProgress(base, stop.progress);
    if (expected !== null && Math.abs(forecast.arrival - expected) > MAX_FORECAST_DEVIATION_MS) continue;
    result.unshift({ at: forecast.arrival, departure, progress: stop.progress, sourceTimestamp: forecast.sourceTimestamp, scheduledArrival: serviceEpoch(vehicle.serviceDate, stop.arrival, city.manifest.timezone) });
    nextAt = forecast.arrival;
  }
  return result;
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
  const onTrack = onTrackStretches(metric.coordinates, metric.cumulativeMeters);
  const result = { ...shapePacket(metric, shapeKey), underground: city.infrastructure(gtfs, operatorId, shapeId), ...(onTrack.length ? { onTrack } : {}) };
  packets.set(shapeKey, result); return result;
}
/** `dwell`: scheduled seconds between arrival and departure, when the timetable has them apart. */
type StopReference = { tripId: string; seconds: number; stopId: string; sequence: number; dwell?: number };
const stopReferences = new Map<string, StopReference[]>();
let networkCache: Promise<Network> | null = null;
let networkExpires = 0;
let snapshotCache: Promise<Snapshot> | null = null;
let snapshotExpires = 0;
let enabledState = providers.map((p) => p.enabled).join(',');
type CatalogTask = { promise: Promise<void>; result?: PromiseSettledResult<BizkaibusGtfs>; expires: number; warned?: boolean };
const catalogTasks = new Map<string, CatalogTask>();
// Parse large GTFS feeds sequentially so transient CSV allocations do not add
// up to the Node heap limit when a city starts.
let catalogLoadQueue: Promise<void> = Promise.resolve();
function checkProviderState() {
  const current = providers.map((p) => p.enabled).join(',');
  if (current !== enabledState) {
    enabledState = current; networkCache = null; snapshotCache = null;
    for (const provider of providers) if (!provider.enabled) catalogTasks.delete(provider.operatorId);
  }
}

function getNetwork(): Promise<Network> {
  checkProviderState();
  if (networkCache && Date.now() < networkExpires) return networkCache;
  networkExpires = Infinity;
  networkCache = loadNetwork().catch((error) => { networkCache = null; throw error; });
  return networkCache;
}
async function loadNetwork(): Promise<Network> {
  const operators: Operator[] = [];
  // Keep one load per provider alive across requests. A slow initial feed must
  // not hold the city catalogue (or snapshots of ready providers) hostage.
  for (const definition of definitions) {
    if (!providerFor(definition.id)?.enabled) continue;
    const existing = catalogTasks.get(definition.id);
    if (existing && Date.now() < existing.expires) continue;
    const task: CatalogTask = { promise: Promise.resolve(), expires: Infinity };
    const load = catalogLoadQueue.then(() => gtfsLoaders.get(definition.id)!());
    catalogLoadQueue = load.then(() => undefined, () => undefined);
    task.promise = load.then(
      (value) => { task.result = { status: 'fulfilled', value }; task.expires = Date.now() + 6 * 3600_000; },
      (reason: unknown) => { task.result = { status: 'rejected', reason }; task.expires = Date.now() + 60_000; },
    ).then(() => { networkCache = null; snapshotCache = null; });
    catalogTasks.set(definition.id, task);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([...catalogTasks.values()].map((task) => task.promise)),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, options.catalogWaitMs ?? 2000); }),
    ]);
  } finally { clearTimeout(timer); }
  networkExpires = Date.now() + 6 * 3600_000;
  for (const definition of definitions) {
    try {
      if (!providerFor(definition.id)?.enabled) throw new Error('Provider disabled');
      const result = catalogTasks.get(definition.id)?.result;
      if (result?.status === 'rejected') throw result.reason;
      const loading = result === undefined;
      if (loading) networkExpires = Math.min(networkExpires, Date.now() + 5000);
      const gtfs = result?.status === 'fulfilled' ? result.value : feeds.get(definition.id);
      if (!gtfs) { operators.push({ ...definition, status: 'degraded', loading: true }); continue; }
      if (feeds.get(definition.id) === gtfs) { operators.push({ ...definition, status: 'ok', loading }); continue; }
      const prefix = `${encodeURIComponent(city.manifest.id)}:${encodeURIComponent(definition.id)}:`;
      for (const store of [routeMap, stopMap, stopReferences, packets, lineGeometry]) for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
      snapshotCache = null;
      feeds.set(definition.id, gtfs);
      operators.push({ ...definition, status: "ok", loading });
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
          const arrival = parseGtfsTime(time.arrivalTime);
          const stopKey = key(definition.id, 'stop', time.stopId);
          if (!stopReferences.has(stopKey)) stopReferences.set(stopKey, []);
          stopReferences.get(stopKey)!.push({ tripId, seconds, stopId: time.stopId, sequence: time.sequence, ...(arrival !== null && arrival < seconds ? { dwell: seconds - arrival } : {}) });
        }
      }
      for (const stop of gtfs.stops.values()) {
        if (!modes.has(stop.stopId)) continue;
        const normalized = normalizeStop(stop, scope(definition.id), [...modes.get(stop.stopId)!]);
        const item: Stop = { ...normalized, key: normalized.id, stopId: stop.stopId, operatorId: definition.id };
        stopMap.set(item.key, item);
      }
    } catch (error) {
      const failedTask = catalogTasks.get(definition.id);
      if (!failedTask?.warned) {
        console.warn(`[${definition.id}] Catalog unavailable:`, error instanceof Error ? error.message : error);
        if (failedTask) failedTask.warned = true;
      }
      operators.push({ ...definition, status: "unavailable" });
      networkExpires = Math.min(networkExpires, Date.now() + 60_000);
    }
  }
  const available = new Set(operators.filter((o) => o.status !== 'unavailable').map((o) => o.id));
  const stops = [...stopMap.values()].filter((s) => available.has(s.operatorId));
  // Place shortcuts use coordinates supplied by the official transport network.
  const places = city.places(stops);
  return { city: city.manifest, operators, routes: [...routeMap.values()].filter((r) => available.has(r.operatorId)).sort((a, b) => a.shortName.localeCompare(b.shortName, 'es', { numeric: true })), stops, places };
}

function enrich(observed: NormalizedVehicle, now: Date): Vehicle | null {
  const gtfs = feeds.get(observed.operatorId);
  const trip = gtfs?.trips.get(observed.externalTripId);
  const route = routeMap.get(observed.routeId);
  if (!gtfs || !trip || !route) return null;
  const plan = tripPlan(gtfs, trip.tripId);
  const provider = providerFor(observed.operatorId), arrivals = provider?.enabled ? provider.arrivals : undefined;
  const vehicle = plan && arrivals ? withOfficialPosition(observed, gtfs, plan, now, arrivals.peek.bind(arrivals)) : observed;
  const serviceDate = vehicle.serviceDate;
  const update = updateFor(vehicle.operatorId, serviceDate, trip.tripId);
  const firstServiceStop = plan?.stops.find((stop) => !update?.stops.get(stop.sequence)?.skipped);
  // A provider timeline (Metro de Madrid) only borrows the trip as topology: its
  // static times are not a departure, e.g. the L1 template starts at 01:00.
  if (firstServiceStop && !vehicle.motionTimeline) {
    const changed = update?.stops.get(firstServiceStop.sequence);
    const startsAt = changed?.departure ?? serviceEpoch(serviceDate, firstServiceStop.departure, city.manifest.timezone);
    // A physical vehicle may already be moving as deadhead or may be assigned
    // prematurely to its next block. Do not present that future public trip as
    // being in service before its first advertised departure.
    if (now.getTime() < startsAt) return null;
  }
  let shiftSeconds = vehicle.delaySeconds ?? 0;
  let delaySeconds = vehicle.delaySeconds;
  let delayEstimated = false;
  let gpsAnchoredTimeline = false;
  if (!update && plan && vehicle.positionQuality !== "scheduled" && vehicle.observationTimestamp !== null) {
    const interval = plan.anchors.find((a, i) => i > 0 && a.progress > plan.anchors[i - 1].progress && vehicle.progressMetersAlongShape >= plan.anchors[i - 1].progress - 2 && vehicle.progressMetersAlongShape <= a.progress + 2);
    if (interval) {
      const index = plan.anchors.indexOf(interval);
      const previous = plan.anchors[index - 1];
      const fraction = Math.max(0, Math.min(1, (vehicle.progressMetersAlongShape - previous.progress) / (interval.progress - previous.progress)));
      const scheduleAt = serviceEpoch(serviceDate, previous.seconds + fraction * (interval.seconds - previous.seconds), city.manifest.timezone);
      let shift = Math.round((vehicle.observationTimestamp - scheduleAt) / 1000);
      // A bus waiting at its first stop does not leave before its departure time.
      if (index === 1 && vehicle.progressMetersAlongShape <= previous.progress + 30) shift = Math.max(0, shift);
      if (Math.abs(shift) <= 3600) {
        // The shifted timetable passes through the GPS fix, so it supplies the
        // commercial pace (including stops) from the observed position onwards.
        shiftSeconds = shift; gpsAnchoredTimeline = true;
        // An estimated trip identity cannot justify publishing a delay.
        if (vehicle.tripIdentityQuality !== 'estimated') { delaySeconds = shift; delayEstimated = true; }
      }
    }
  }
  let fullTimeline = vehicle.motionTimeline ?? (update ? updatedTimeline(gtfs, update) ?? (plan ? timelineFor(plan, serviceDate, 0, city.manifest.timezone) : []) : plan ? timelineFor(plan, serviceDate, shiftSeconds, city.manifest.timezone) : []);
  // Source precedence: GPS fixes where the vehicle is, SIRI stop forecasts
  // decide its next arrivals and departures, then GTFS-RT or provider
  // estimates, and the static timetable only as fallback.
  const stopForecasts = plan ? cachedStopForecasts(vehicle, gtfs, plan, fullTimeline, now) : [];
  fullTimeline = mergeStopForecasts(fullTimeline, stopForecasts);
  // Trains stop at every station, even when the source publishes no dwell.
  if (vehicle.mode === 'rail' || vehicle.mode === 'tram') fullTimeline = withStationDwell(fullTimeline);
  if (vehicle.observationTimestamp !== null) {
    // The actual GPS anchors the map position; the forecasts control the following station times.
    fullTimeline = anchorGpsTimeline(fullTimeline, { at: vehicle.observationTimestamp, progress: vehicle.observationProgressMeters ?? vehicle.progressMetersAlongShape });
  }
  const usedForecasts = stopForecasts.filter((forecast) => fullTimeline.some((a) => a.at === forecast.at && Math.abs(a.progress - forecast.progress) <= 2));
  const usesStopForecasts = usedForecasts.length > 0 && fullTimeline.length > 1;
  const stopForecastTimestamp = usesStopForecasts ? Math.max(...usedForecasts.map((forecast) => forecast.sourceTimestamp)) : null;
  let nextAnchor = fullTimeline.findIndex((a) => a.at >= now.getTime());
  if (nextAnchor < 0) nextAnchor = fullTimeline.length - 1;
  const timeline = vehicle.observationTimestamp !== null ? fullTimeline.slice(0, Math.max(6, nextAnchor + 5)) : fullTimeline.slice(Math.max(0, nextAnchor - 1), nextAnchor + 5);
  const nativeNext = vehicle.nextStopId ? parseEntityId(vehicle.nextStopId)?.externalId : undefined;
  // The operator's passing times say which stop the bus has not reached yet; the card and the map follow them.
  const official = plan && arrivals ? officialNextStop(vehicle, gtfs, plan, now, arrivals.peek.bind(arrivals)) : null;
  const next = official ? plan?.stops.find((s) => s.stopId === official.stopId && s.progress === official.progress) : nativeNext ? plan?.stops.find((s) => s.stopId === nativeNext && s.progress >= vehicle.progressMetersAlongShape - 10) : plan?.stops.find((s) => s.progress >= vehicle.progressMetersAlongShape + 10 && !update?.stops.get(s.sequence)?.skipped);
  const nextStop = next ? stopMap.get(key(vehicle.operatorId, 'stop', next.stopId)) : null;
  const nextUpdate = next ? update?.stops.get(next.sequence) : null;
  if (nextUpdate) { delaySeconds = nextUpdate.arrivalRealtime ? (nextUpdate.arrival - nextUpdate.scheduledArrival) / 1000 : null; delayEstimated = false; }
  if (usesStopForecasts) {
    // SIRI outranks GTFS-RT and the GPS-shifted timetable for the published delay.
    // An estimated trip identity cannot justify publishing a delay at all.
    delaySeconds = vehicle.tripIdentityQuality === 'estimated' ? null : Math.round((usedForecasts[0].at - usedForecasts[0].scheduledArrival) / 1000);
    delayEstimated = false;
  }
  const destination = passengerHeadsign(vehicle.destination || trip.headsign || route.longName, route.longName);
  const nativeArrival = next ? vehicle.arrivalPredictions?.find((a) => Math.abs(a.progress - next.progress) < 2)?.at : undefined;
  const forecastArrival = next && usesStopForecasts ? usedForecasts.find((f) => Math.abs(f.progress - next.progress) <= 2)?.at ?? timeAtProgress(fullTimeline, next.progress) ?? undefined : undefined;
  const timelineSource: TimelineSource = usesStopForecasts ? 'siri' : vehicle.motionTimeline ? 'provider' : update ? 'gtfs-rt' : gpsAnchoredTimeline ? 'gps-schedule' : 'schedule';
  const nextArrival = forecastArrival ?? nativeArrival ?? nextUpdate?.arrival ?? (vehicle.motionTimeline ? null : next ? serviceEpoch(serviceDate, next.arrival + shiftSeconds, city.manifest.timezone) : null);
  const presented: Vehicle = { ...vehicle, timetableTimestamp: stopForecastTimestamp ?? vehicle.timetableTimestamp, timelineSource, arrivalPredictions: usesStopForecasts ? usedForecasts.map((forecast) => ({ at: forecast.at, progress: forecast.progress, sourceTimestamp: forecast.sourceTimestamp })) : vehicle.arrivalPredictions, delaySeconds, delayEstimated, gpsAnchoredTimeline: gpsAnchoredTimeline && !vehicle.motionTimeline && !usesStopForecasts, serviceDate, timeline, routeShortName: route.shortName, destination, nextStopId: nextStop?.id ?? null, officialNextStop: official && nextStop ? { key: nextStop.key, progress: official.progress, sourceTimestamp: official.sourceTimestamp, position: official.position } : null, appearance: vehicle.externalVehicleId ? providerFor(vehicle.operatorId)?.appearanceFor?.({ mode: vehicle.mode, routeId: trip.routeId }, route.shortName, vehicle.externalVehicleId) ?? route.appearance : route.appearance, routeKey: route.key, shapeKey: vehicle.shapeId, label: route.shortName, headsign: destination, color: route.color, operatorName: definitions.find((d) => d.id === vehicle.operatorId)!.name, nextStop: next && nextStop && nextArrival !== null ? { key: nextStop.key, name: nextStop.name, at: nextArrival } : null };
  transitDebugTraceStore.recordPresentation(presented, now.getTime());
  return presented;
}
async function getPresentationSnapshot(): Promise<Snapshot> {
  const network = await getNetwork();
  if (snapshotCache && Date.now() < snapshotExpires) return snapshotCache;
  snapshotExpires = Infinity;
  const blocked = new Map(network.operators.flatMap((o): [string, 'loading' | 'unavailable'][] => o.status === 'unavailable' ? [[o.id, 'unavailable']] : !feeds.has(o.id) ? [[o.id, 'loading']] : []));
  snapshotCache = engine.getSnapshot(new Date(), blocked).then((snapshot) => { snapshotExpires = Date.now() + 5000; return ({ cityId: city.manifest.id, fetchedAt: snapshot.fetchedAt, vehicles: snapshot.vehicles.map((v) => enrich(v, new Date(snapshot.fetchedAt))).filter((v): v is Vehicle => v !== null), providers: snapshot.providers.map(({ vehicles: _vehicles, ...status }) => status) }); }).catch((error) => { snapshotCache = null; throw error; });
  return snapshotCache;
}

async function departures(operatorId: string, references: StopReference[], now: Date, max = 12): Promise<Departure[]> {
  if (!providerFor(operatorId)?.enabled) return [];
  const gtfs = feeds.get(operatorId)!;
  if (providerFor(operatorId)?.definition.capabilities.scheduledService === false) return [];
  const snapshot = await getPresentationSnapshot();
  // Live ADDED journeys were not present when the static stop index was built.
  // Incorporate their actual calls without rebuilding the whole city catalogue.
  const stopIds = new Set(references.map((r) => r.stopId));
  const indexed = new Set(references.map((r) => `${r.tripId}:${r.sequence}`));
  const extra: StopReference[] = [];
  for (const update of providerFor(operatorId)?.getUpdates?.().values() ?? []) for (const call of update.stops.values()) {
    if (!stopIds.has(call.stopId) || indexed.has(`${update.tripId}:${call.sequence}`)) continue;
    const time = gtfs.tripStops.get(update.tripId)?.find((s) => s.sequence === call.sequence);
    const seconds = parseGtfsTime(time?.departureTime ?? null) ?? parseGtfsTime(time?.arrivalTime ?? null);
    if (seconds !== null) { extra.push({ tripId: update.tripId, seconds, stopId: call.stopId, sequence: call.sequence }); indexed.add(`${update.tripId}:${call.sequence}`); }
  }
  references = [...references, ...extra];
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
      // While a train stands at the platform the board says "Ahora", not the minutes left until it leaves.
      const arrivalAt = changed?.arrival ?? (reference.dwell ? at - reference.dwell * 1000 : undefined);
      const realtime = changed?.departureRealtime || update?.canceled;
      const row: Departure = { routeKey: route.key, tripId: key(operatorId, 'trip', trip.tripId), label: route.shortName, headsign: passengerHeadsign(trip.headsign || route.longName, route.longName), operatorId, at, scheduledAt, updatedAt: realtime ? update!.updatedAt : gpsEstimated ? vehicle!.observationTimestamp : null, source: realtime ? 'realtime' : gpsEstimated ? 'gps' : 'schedule', canceled: update?.canceled ?? false, quality: realtime || gpsEstimated ? 'predicted' : 'scheduled', delaySeconds: changed?.departureRealtime ? (at - scheduledAt) / 1000 : gpsEstimated ? vehicle!.delaySeconds : null, ...(arrivalAt !== undefined && arrivalAt < at ? { arrivalAt } : {}) };
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
  let rows = await departures(operatorId, refs, new Date());
  const arrivals = providerFor(operatorId)?.enabled ? providerFor(operatorId)?.arrivals : undefined;
  if (arrivals) {
    // Only line origins, never a full station scan; native adapters share their cache.
    const origins = [...new Set(refs.map((r) => r.stopId))].slice(0, 2);
    const live = (await Promise.all(origins.map((id) => arrivals.departures(gtfs, id).catch(() => [])))).flat().filter((d) => d.routeKey === route.key && (!direction || direction === 'all' || String(d.directionId ?? 'unknown') === direction));
    if (live.length) { const horizon = Math.max(...live.map((r) => r.at)) + 120_000; rows = [...live, ...rows.filter((r) => r.at > horizon)].sort((a, b) => a.at - b.at).slice(0, 12); }
  }
  return { route, shapes, stops, departures: rows };
}
/** The directions a stop's trips leave in, towards their next stop (from the previous one at a terminus), one per route and direction. */
function departureBearings(stop: Stop): number[] {
  const gtfs = feeds.get(stop.operatorId), here = gtfs?.stops.get(stop.stopId);
  if (!gtfs || !here) return [];
  const seen = new Set<string>(), bearings: number[] = [];
  for (const reference of stopReferences.get(stop.key) ?? []) {
    const trip = gtfs.trips.get(reference.tripId), pattern = `${trip?.routeId}:${trip?.directionId}`;
    if (!trip || seen.has(pattern)) continue;
    seen.add(pattern);
    const times = gtfs.tripStops.get(reference.tripId) ?? [], index = times.findIndex((time) => time.sequence === reference.sequence);
    const next = gtfs.stops.get(times[index + 1]?.stopId ?? ''), previous = gtfs.stops.get(times[index - 1]?.stopId ?? '');
    if (next) bearings.push(bearingDegrees(here, next)); else if (previous) bearings.push(bearingDegrees(previous, here));
  }
  return bearings;
}
async function getStop(operatorId: string, stopId: string): Promise<StopDetail | null> {
  const network = await getNetwork(); const stop = stopMap.get(key(operatorId, 'stop', stopId));
  if (!stop) return null;
  const nearbyStops = sameSpotStops(stop, network.stops, departureBearings);
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
  if (arrivals && vehicle?.externalVehicleId && plan) {
    const upcoming = plan.stops.filter((s) => s.progress > vehicle.progressMetersAlongShape).slice(0, 3);
    await arrivals.warm(gtfs, upcoming.map((s) => s.stopId));
    // The selected trip has just populated provider forecasts. Rebuild the next
    // snapshot so the motion engine receives them immediately.
    snapshotExpires = 0;
  }
  const planned = (plan?.stops ?? []).filter((s) => stopMap.has(key(operatorId, 'stop', s.stopId)));
  const stops = carryRealtimeDelay(planned.flatMap((s) => { const stop = stopMap.get(key(operatorId, 'stop', s.stopId)), changed = update?.stops.get(s.sequence); const siri = arrivals?.peek(gtfs, s.stopId, vehicle?.externalVehicleId); const nativeAt = vehicle?.arrivalPredictions?.find((a) => Math.abs(a.progress - s.progress) < 2)?.at; const topologyOnly = providerFor(operatorId)?.definition.capabilities.scheduledService === false; return stop ? [{ ...stop, at: siri?.arrival ?? changed?.arrival ?? nativeAt ?? (vehicle?.motionTimeline || topologyOnly ? null : serviceEpoch(serviceDate, s.arrival + (vehicle?.delaySeconds ?? 0), city.manifest.timezone)), progress: s.progress, skipped: changed?.skipped ?? false, realtime: !!siri || nativeAt !== undefined || (changed?.arrivalRealtime ?? false), source: siri || (nativeAt !== undefined && vehicle?.timelineSource === 'siri') ? 'siri' as const : nativeAt !== undefined || changed?.arrivalRealtime ? 'realtime' as const : vehicle?.gpsAnchoredTimeline && vehicle.delaySeconds !== null ? 'gps' as const : 'schedule' as const }] : []; }), planned.map((s) => serviceEpoch(serviceDate, s.arrival, city.manifest.timezone)));
  return { vehicleId: vehicle?.id ?? key(operatorId, 'vehicle', `${operatorId}:${serviceDate}:${tripId}`), trip: { ...normalizeTrip(trip, scope(operatorId)), destination: vehicle?.destination || trip.headsign }, shape: shape && trip.shapeId ? packet(operatorId, trip.shapeId) : null, stops };
}
async function getGeometries(keys: string[]): Promise<Shape[]> {
  await getNetwork();
  return keys.slice(0, 100).flatMap((id) => { const parsed = parseEntityId(id); if (!parsed || parsed.cityId !== city.manifest.id || parsed.kind !== 'shape') return []; const gtfs = feeds.get(parsed.providerId); const metric = gtfs ? shapeMetric(gtfs, parsed.externalId) : null; const shape = metric ? packet(parsed.providerId, parsed.externalId) : null; return shape ? [shape] : []; });
}
function getCatalogDiagnostics(): AdminCatalogDiagnostics[] {
  return definitions.map((definition) => {
    const provider = providerFor(definition.id), feed = feeds.get(definition.id), task = catalogTasks.get(definition.id);
    const rejected = task?.result?.status === 'rejected' ? task.result.reason : undefined;
    const state: AdminCatalogDiagnostics['state'] = !provider?.enabled ? 'disabled' : feed ? 'ready' : rejected ? 'error' : 'loading';
    return {
      providerId: definition.id,
      state,
      routes: feed?.routes.size ?? 0,
      trips: feed?.trips.size ?? 0,
      stops: feed?.stops.size ?? 0,
      shapes: feed?.shapes.size ?? 0,
      services: feed ? new Set([...feed.calendars.keys(), ...feed.calendarDates.keys()]).size : 0,
      ...(rejected ? { error: rejected instanceof Error ? rejected.message : String(rejected) } : {}),
    };
  });
}
return { getNetwork, getPresentationSnapshot, getLine, getStop, getTrip, getGeometries, getCatalogDiagnostics };
}
const networks = new Map<string, ReturnType<typeof createCityNetwork>>();
export const isCityNetworkInitialized = (cityId: string) => networks.has(cityId);
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
