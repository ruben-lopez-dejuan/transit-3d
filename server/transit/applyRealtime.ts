import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import { freshTimestamp, normalizeTripUpdates, resolveServiceDate, tripInstanceKey, updatedTimeline, type UpdatedTrip, type RealtimeMessage } from '../transit/realtime';
import { modeFor, timelineFor, tripPlan } from '../transit/plans';
import { positionAtProgress, projectOntoShape } from '../transit/motionEngine';
import type { TransitVehicle } from '../transit/types';
import type { MotionAnchor } from '../../shared/transit/network';
import { ObservationTracker } from '../transit/observations';
const trackers = new WeakMap<BizkaibusGtfs, ObservationTracker>();

function progressAt(anchors: MotionAnchor[], at: number) {
  if (at <= anchors[0].at) return anchors[0].progress;
  const index = anchors.findIndex((a) => a.at >= at);
  if (index < 0) return anchors.at(-1)!.progress;
  const previous = anchors[index - 1], next = anchors[index];
  const fraction = Math.max(0, Math.min(1, (at - previous.at) / Math.max(1, next.at - previous.at)));
  return previous.progress + fraction * (next.progress - previous.progress);
}

/** Apply timetables before GPS, retaining one identity per service-date/trip. */
export function applyRealtime(gtfs: BizkaibusGtfs, base: TransitVehicle[], operatorId: string, updates: Map<string, UpdatedTrip>, gps: RealtimeMessage | null, now: Date, maximumGpsSpeed?: number, timezone = 'Europe/Madrid'): TransitVehicle[] {
  let gpsObservations = trackers.get(gtfs);
  if (!gpsObservations) { gpsObservations = new ObservationTracker(); trackers.set(gtfs, gpsObservations); }
  const vehicles = new Map(base.map((v) => [v.id, { ...v }]));
  for (const update of updates.values()) {
    const id = `${operatorId}:${tripInstanceKey(update.serviceDate, update.tripId)}`;
    if (update.canceled) { vehicles.delete(id); continue; }
    const trip = gtfs.trips.get(update.tripId)!, plan = tripPlan(gtfs, trip.tripId), timeline = updatedTimeline(gtfs, update);
    if (!trip.shapeId || !plan || !timeline) continue;
    const calls = [...update.stops.values()].filter((s) => !s.skipped);
    const first = calls[0], last = calls.at(-1);
    if (!first || !last) continue;
    const current = vehicles.get(id);
    const hasFreshGps = current?.observationTimestamp != null && freshTimestamp(current.observationTimestamp / 1000, now.getTime()) !== null;
    // Delayed services can remain active after their originally scheduled arrival.
    // An estimated timetable boundary cannot erase a fresh physical observation
    // already supplied by the base adapter (Bizkaibus). Explicit cancellations still win.
    if (now.getTime() < first.departure || now.getTime() > last.arrival) {
      if (!hasFreshGps) vehicles.delete(id);
      continue;
    }
    const progress = current?.observationTimestamp !== null && current?.observationTimestamp !== undefined ? current.progressMetersAlongShape : progressAt(timeline, now.getTime());
    const position = positionAtProgress(plan.metric, progress); if (!position) continue;
    const next = calls.find((s) => s.departure >= now.getTime()) ?? last;
    const realtime = next.arrivalRealtime || next.departureRealtime;
    vehicles.set(id, { ...current, id, operatorId, tripId: trip.tripId, routeId: trip.routeId, directionId: trip.directionId, mode: modeFor(gtfs.routes.get(trip.routeId)?.routeType ?? -1), shapeId: trip.shapeId, progressMetersAlongShape: position.progressMeters, longitude: position.coordinate[0], latitude: position.coordinate[1], bearing: position.bearing, positionQuality: current?.observationTimestamp ? current.positionQuality : realtime ? 'predicted' : 'scheduled', observationTimestamp: current?.observationTimestamp ?? null, predictionTimestamp: now.getTime(), timetableTimestamp: update.updatedAt, positionSource: current?.observationTimestamp ? 'gps' : realtime ? 'trip-updates' : 'schedule', delaySeconds: realtime ? (next.arrival - next.scheduledArrival) / 1000 : null });
  }
  if (!gps || freshTimestamp(gps.header?.timestamp, now.getTime()) === null) return [...vehicles.values()];
  for (const entity of gps.entity ?? []) {
    const observation = entity.vehicle;
    if (!observation?.trip || entity.isDeleted) continue;
    const observedAt = freshTimestamp(observation.timestamp, now.getTime());
    const latitude = observation.position?.latitude, longitude = observation.position?.longitude;
    if (observedAt === null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude!) > 90 || Math.abs(longitude!) > 180) continue;
    const date = resolveServiceDate(gtfs, observation.trip, new Date(observedAt), [], 0, timezone);
    if (!date || !observation.trip.tripId) continue;
    const trip = gtfs.trips.get(observation.trip.tripId)!, update = updates.get(tripInstanceKey(date, trip.tripId));
    if (update?.canceled || !trip.shapeId) continue;
    const plan = tripPlan(gtfs, trip.tripId); if (!plan) continue;
    const previousStop = observation.currentStopSequence === undefined ? null : plan.stops.filter((s) => s.sequence < observation.currentStopSequence!).at(-1);
    if (observation.stopId && !(gtfs.tripStops.get(trip.tripId) ?? []).some((s) => s.stopId === observation.stopId)) continue;
    const projection = projectOntoShape(plan.metric, [longitude!, latitude!], previousStop?.progress ?? 0);
    if (!projection || projection.distanceMeters > 120) continue;
    const timeline = update ? updatedTimeline(gtfs, update) : timelineFor(plan, date, 0, timezone);
    const mode = modeFor(gtfs.routes.get(trip.routeId)?.routeType ?? -1);
    const key = `${operatorId}:${date}:${trip.tripId}:${trip.shapeId}`;
    const stoppedAtStop = Object.hasOwn(observation, 'currentStatus') ? observation.currentStatus === 'STOPPED_AT' || observation.currentStatus === 1 : undefined;
    const history = gpsObservations.accept(key, { at: observedAt, progress: projection.progressMeters, stoppedAtStop }, mode, now.getTime(), maximumGpsSpeed) ?? gpsObservations.latest(key, now.getTime());
    if (!history) continue;
    const progress = history.current.progress, acceptedAt = history.current.at;
    const position = positionAtProgress(plan.metric, progress); if (!position) continue;
    const id = `${operatorId}:${tripInstanceKey(date, trip.tripId)}`, previous = vehicles.get(id);
    vehicles.set(id, { ...previous, id, operatorId, tripId: trip.tripId, routeId: trip.routeId, directionId: trip.directionId, mode, shapeId: trip.shapeId, progressMetersAlongShape: position.progressMeters, longitude: position.coordinate[0], latitude: position.coordinate[1], bearing: position.bearing, positionQuality: now.getTime() - acceptedAt <= 45_000 ? 'live' : 'predicted', observationTimestamp: acceptedAt, predictionTimestamp: now.getTime(), delaySeconds: previous?.delaySeconds ?? null, timetableTimestamp: update?.updatedAt ?? null, observationProgressMeters: progress, previousObservation: history.previous, speedMetersPerSecond: history.speed, maximumSpeedMetersPerSecond: maximumGpsSpeed, stoppedAtStop: history.current.stoppedAtStop, vehicleId: observation.vehicle?.id ?? observation.vehicle?.label ?? trip.tripId, tripIdentityQuality: 'exact', positionSource: 'gps' });
  }
  return [...vehicles.values()];
}
