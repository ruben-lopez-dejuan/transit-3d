import type { BizkaibusGtfs, GtfsTripStop } from '../providers/bizkaibus/gtfs';
import { formatServiceDate, isServiceActive, parseGtfsTime } from './gtfsCalendar';
import { serviceEpoch, shiftDate, tripPlan } from './plans';
import type { MotionAnchor } from '../../shared/transit/network';

export type RealtimeEvent = { time?: number; delay?: number };
export type TripDescriptor = { tripId?: string; routeId?: string; startDate?: string; startTime?: string; scheduleRelationship?: string };
export type StopUpdate = { stopId?: string; stopSequence?: number; scheduleRelationship?: string; arrival?: RealtimeEvent; departure?: RealtimeEvent };
export type TripUpdate = { trip: TripDescriptor; timestamp?: number; delay?: number; stopTimeUpdate?: StopUpdate[] };
export type VehicleObservation = { trip?: TripDescriptor; timestamp?: number; vehicle?: { id?: string; label?: string }; position?: { latitude?: number; longitude?: number; speed?: number }; stopId?: string; currentStopSequence?: number; currentStatus?: string | number };
export type RealtimeMessage = { header?: { timestamp?: number; incrementality?: string; gtfsRealtimeVersion?: string }; entity?: { isDeleted?: boolean; tripUpdate?: TripUpdate; vehicle?: VehicleObservation }[] };
export type UpdatedStop = { stopId: string; sequence: number; arrival: number; departure: number; scheduledArrival: number; scheduledDeparture: number; arrivalRealtime: boolean; departureRealtime: boolean; skipped: boolean };
export type UpdatedTrip = { tripId: string; serviceDate: string; updatedAt: number; canceled: boolean; stops: Map<number, UpdatedStop> };
export { REALTIME_MAX_AGE_MS } from '../../shared/transit/freshness';
import { REALTIME_MAX_AGE_MS } from '../../shared/transit/freshness';
export const tripInstanceKey = (date: string, tripId: string) => `${date}:${tripId}`;

export function freshTimestamp(seconds: number | undefined, now: number): number | null {
  if (!Number.isFinite(seconds) || !seconds || seconds < 0) return null;
  const timestamp = seconds * 1000;
  return now - timestamp <= REALTIME_MAX_AGE_MS && timestamp - now <= 60_000 ? timestamp : null;
}

function matchStop(stops: GtfsTripStop[], update: StopUpdate): GtfsTripStop | null {
  if (update.stopSequence !== undefined) {
    const stop = stops.find((s) => s.sequence === update.stopSequence);
    return stop && (!update.stopId || stop.stopId === update.stopId) ? stop : null;
  }
  const matches = stops.filter((s) => s.stopId === update.stopId);
  // Repeated stations require a sequence number; proximity is not a trip identity.
  return matches.length === 1 ? matches[0] : null;
}

/** Resolve an actual service instance, including yesterday's extended-hour trips. */
export function resolveServiceDate(gtfs: BizkaibusGtfs, descriptor: TripDescriptor, now: Date, updates: StopUpdate[] = [], delay = 0, timezone = 'Europe/Madrid'): string | null {
  const trip = descriptor.tripId ? gtfs.trips.get(descriptor.tripId) : null;
  if (!trip || (descriptor.routeId && descriptor.routeId !== trip.routeId)) return null;
  const stops = gtfs.tripStops.get(trip.tripId) ?? [];
  if (!stops.length) return null;
  if (descriptor.startTime) {
    const scheduled = parseGtfsTime(stops[0].departureTime) ?? parseGtfsTime(stops[0].arrivalTime);
    if (parseGtfsTime(descriptor.startTime) !== scheduled) return null;
  }
  if (descriptor.startDate && !/^\d{8}$/.test(descriptor.startDate)) return null;
  const today = formatServiceDate(now, timezone).date;
  const candidates = descriptor.startDate ? [shiftDate(descriptor.startDate, 0)] : [-1, 0, 1].map((d) => shiftDate(today, d));
  const absolute = updates.find((u) => Number.isFinite(u.arrival?.time) || Number.isFinite(u.departure?.time));
  let best: { date: string; score: number } | null = null;
  for (const day of candidates) {
    if (descriptor.startDate && day.date !== descriptor.startDate) continue;
    if (!isServiceActive(gtfs, trip.serviceId, day.date, day.weekday)) continue;
    let score: number;
    if (absolute) {
      const stop = matchStop(stops, absolute); if (!stop) continue;
      const event = Number.isFinite(absolute.arrival?.time) ? absolute.arrival! : absolute.departure!;
      const seconds = parseGtfsTime(event === absolute.arrival ? stop.arrivalTime : stop.departureTime);
      if (seconds === null) continue;
      score = Math.abs(event.time! * 1000 - serviceEpoch(day.date, seconds + (event.delay ?? delay), timezone));
      if (score > 6 * 3600_000) continue;
    } else {
      const first = parseGtfsTime(stops[0].departureTime) ?? parseGtfsTime(stops[0].arrivalTime);
      const last = parseGtfsTime(stops.at(-1)!.arrivalTime) ?? parseGtfsTime(stops.at(-1)!.departureTime);
      if (first === null || last === null) continue;
      const start = serviceEpoch(day.date, first + delay, timezone), end = serviceEpoch(day.date, last + delay, timezone);
      score = Math.max(start - now.getTime(), now.getTime() - end, 0);
    }
    if (!best || score < best.score) best = { date: day.date, score };
  }
  return best?.date ?? null;
}

function eventDelay(event: RealtimeEvent | undefined, scheduled: number): number | null {
  // Absolute times take precedence. In particular, an explicitly supplied zero delay is data.
  if (Number.isFinite(event?.time) && event!.time! > 0) return (event!.time! * 1000 - scheduled) / 1000;
  return Number.isFinite(event?.delay) ? event!.delay! : null;
}

export function normalizeTripUpdates(gtfs: BizkaibusGtfs, feed: RealtimeMessage | null, now = new Date(), timezone = 'Europe/Madrid'): Map<string, UpdatedTrip> {
  const result = new Map<string, UpdatedTrip>();
  if (!feed || feed.header?.incrementality === 'DIFFERENTIAL' || freshTimestamp(feed.header?.timestamp, now.getTime()) === null) return result;
  for (const entity of feed.entity ?? []) {
    const update = entity.tripUpdate;
    if (!update || entity.isDeleted) continue;
    const updatedAt = freshTimestamp(update.timestamp ?? feed.header?.timestamp, now.getTime());
    if (updatedAt === null) continue;
    const relationship = update.trip.scheduleRelationship ?? 'SCHEDULED';
    if (!['SCHEDULED', 'CANCELED', 'DELETED'].includes(relationship)) continue;
    const rawStops = update.stopTimeUpdate ?? [];
    const date = resolveServiceDate(gtfs, update.trip, now, rawStops, update.delay ?? 0, timezone);
    if (!date || !update.trip.tripId) continue;
    const tripId = update.trip.tripId, key = tripInstanceKey(date, tripId);
    const canceled = relationship === 'CANCELED' || relationship === 'DELETED';
    if (canceled) { result.set(key, { tripId, serviceDate: date, updatedAt, canceled: true, stops: new Map() }); continue; }
    if (!rawStops.length) continue;
    const scheduled = gtfs.tripStops.get(tripId)!;
    const matched = new Map<number, StopUpdate>();
    let valid = true, previousSequence = -1;
    for (const stopUpdate of rawStops) {
      const stop = matchStop(scheduled, stopUpdate);
      if (!stop || stop.sequence <= previousSequence || !['SCHEDULED', 'SKIPPED', 'NO_DATA'].includes(stopUpdate.scheduleRelationship ?? 'SCHEDULED')) { valid = false; break; }
      previousSequence = stop.sequence; matched.set(stop.sequence, stopUpdate);
    }
    if (!valid) continue;
    let propagated: number | null = Number.isFinite(update.delay) ? update.delay! : null;
    const stops = new Map<number, UpdatedStop>();
    for (const stop of scheduled) {
      const arrivalSeconds = parseGtfsTime(stop.arrivalTime) ?? parseGtfsTime(stop.departureTime);
      const departureSeconds = parseGtfsTime(stop.departureTime) ?? arrivalSeconds;
      if (arrivalSeconds === null || departureSeconds === null) continue;
      const scheduledArrival = serviceEpoch(date, arrivalSeconds, timezone), scheduledDeparture = serviceEpoch(date, departureSeconds, timezone);
      const changed = matched.get(stop.sequence), skipped = changed?.scheduleRelationship === 'SKIPPED';
      if (changed?.scheduleRelationship === 'NO_DATA') propagated = null;
      const arrivalDelay = !skipped && changed?.scheduleRelationship !== 'NO_DATA' ? eventDelay(changed?.arrival, scheduledArrival) : null;
      const departureDelay = !skipped && changed?.scheduleRelationship !== 'NO_DATA' ? eventDelay(changed?.departure, scheduledDeparture) : null;
      const effectiveArrival = arrivalDelay ?? departureDelay ?? propagated;
      const effectiveDeparture = departureDelay ?? arrivalDelay ?? propagated;
      if (departureDelay !== null || arrivalDelay !== null) propagated = departureDelay ?? arrivalDelay;
      const arrival = scheduledArrival + (effectiveArrival ?? 0) * 1000;
      const departure = scheduledDeparture + (effectiveDeparture ?? 0) * 1000;
      if (departure < arrival) { valid = false; break; }
      stops.set(stop.sequence, { stopId: stop.stopId, sequence: stop.sequence, scheduledArrival, scheduledDeparture, arrival, departure, arrivalRealtime: effectiveArrival !== null, departureRealtime: effectiveDeparture !== null, skipped });
    }
    if (valid && stops.size) result.set(key, { tripId, serviceDate: date, updatedAt, canceled: false, stops });
  }
  return result;
}

export function updatedTimeline(gtfs: BizkaibusGtfs, update: UpdatedTrip): MotionAnchor[] | null {
  const plan = tripPlan(gtfs, update.tripId); if (!plan || update.canceled) return null;
  const timeline: MotionAnchor[] = [];
  for (const stop of plan.stops) {
    const effective = update.stops.get(stop.sequence);
    if (!effective || effective.skipped) continue;
    timeline.push({ at: effective.arrival, progress: stop.progress });
    if (effective.departure > effective.arrival) timeline.push({ at: effective.departure, progress: stop.progress });
  }
  return timeline.length >= 2 && timeline.every((a, i) => i === 0 || a.at >= timeline[i - 1].at) ? timeline : null;
}
