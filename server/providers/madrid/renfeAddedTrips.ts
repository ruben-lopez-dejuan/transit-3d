import type { BizkaibusGtfs, GtfsTripStop } from '../bizkaibus/gtfs';
import { freshTimestamp, type RealtimeMessage, type TripUpdate } from '../../transit/realtime';
import { formatServiceDate } from '../../transit/gtfsCalendar';
import { invalidateTripPlan, serviceEpoch, shapeMetric, shiftDate } from '../../transit/plans';
import { projectOntoShape } from '../../transit/motionEngine';

/** Official ADDED journeys have no static trip_id. Join only the route and ordered
 * station IDs supplied by Renfe; never guess a journey from a C1/C2 display label. */
export class RenfeAddedTrips {
  private active = new Map<string, { at: number; signature: string }>();
  private feed?: BizkaibusGtfs;
  rejected = 0;
  constructor(private readonly allowedRoutes: ReadonlySet<string>, private readonly timezone = 'Europe/Madrid') {}
  prepare = (gtfs: BizkaibusGtfs, feed: RealtimeMessage | null, gps: RealtimeMessage | null, now: Date): RealtimeMessage | null => {
    if (this.feed !== gtfs) { this.active.clear(); this.feed = gtfs; }
    if (gps && freshTimestamp(gps.header?.timestamp, now.getTime()) !== null) for (const entity of gps.entity ?? []) {
      const id = entity.vehicle?.trip?.tripId, at = freshTimestamp(entity.vehicle?.timestamp, now.getTime());
      if (id && at !== null && this.active.has(id)) this.active.get(id)!.at = Math.max(this.active.get(id)!.at, at);
    }
    const bothCurrent = feed?.header?.incrementality !== 'DIFFERENTIAL' && gps?.header?.incrementality !== 'DIFFERENTIAL' && freshTimestamp(feed?.header?.timestamp, now.getTime()) !== null && freshTimestamp(gps?.header?.timestamp, now.getTime()) !== null;
    const present = new Set([...(feed?.entity ?? []).filter((e) => !e.isDeleted).map((e) => e.tripUpdate?.trip.tripId), ...(gps?.entity ?? []).filter((e) => !e.isDeleted && freshTimestamp(e.vehicle?.timestamp, now.getTime()) !== null).map((e) => e.vehicle?.trip?.tripId)]);
    // Two current full datasets explicitly removing a journey are not a network
    // outage. Do not leave an ADDED timetable ghost after its service disappears.
    for (const [id, state] of this.active) if (now.getTime() - state.at > 180_000 || bothCurrent && !present.has(id)) {
      gtfs.trips.delete(id); gtfs.tripStops.delete(id); invalidateTripPlan(gtfs, id);
      this.active.delete(id);
    }
    const usedServices = new Set([...this.active.keys()].map((id) => gtfs.trips.get(id)?.serviceId));
    for (const id of gtfs.calendarDates.keys()) if (id.startsWith('realtime-added:') && !usedServices.has(id)) gtfs.calendarDates.delete(id);
    if (!feed || freshTimestamp(feed.header?.timestamp, now.getTime()) === null) return feed;
    return { ...feed, entity: (feed.entity ?? []).map((entity) => {
      const update = entity.tripUpdate;
      if (!update || update.trip.scheduleRelationship !== 'ADDED' || entity.isDeleted) return entity;
      const at = freshTimestamp(update.timestamp ?? feed.header?.timestamp, now.getTime());
      if (at === null || !this.add(gtfs, update, at, now)) { this.rejected++; return entity; }
      // Internal scheduled representation of a validated official realtime journey.
      // The raw protobuf and its ADDED relationship remain untouched on disk.
      return { ...entity, tripUpdate: { ...update, trip: { ...update.trip, startTime: undefined, startDate: gtfs.trips.get(update.trip.tripId!)!.serviceId.replace(/^realtime-added:/, ''), scheduleRelationship: 'SCHEDULED' } } };
    }) };
  };
  private add(gtfs: BizkaibusGtfs, update: TripUpdate, at: number, now: Date) {
    const { tripId, routeId } = update.trip;
    if (!tripId || !routeId || !this.allowedRoutes.has(routeId) || !gtfs.routes.has(routeId) || (gtfs.trips.has(tripId) && !this.active.has(tripId))) return false;
    const raw = update.stopTimeUpdate ?? [];
    if (raw.length < 2 || raw.length > 200 || raw.some((s) => !s.stopId || !gtfs.stops.has(s.stopId) || !Number.isFinite(s.arrival?.time ?? s.departure?.time))) return false;
    const times = raw.map((s) => ({ arrival: (s.arrival?.time ?? s.departure!.time!) * 1000, departure: (s.departure?.time ?? s.arrival!.time!) * 1000 }));
    if (times.some((s, i) => s.arrival <= 0 || s.departure < s.arrival || (i > 0 && s.arrival < times[i - 1].departure))) return false;
    if (times.at(-1)!.arrival < now.getTime() - 3600_000 || times[0].departure > now.getTime() + 6 * 3600_000) return false;
    const signature = JSON.stringify([routeId, raw.map((s, i) => [s.stopId, times[i]])]);
    if (this.active.get(tripId)?.signature === signature) { this.active.get(tripId)!.at = at; return true; }
    let best: { tripId: string; score: number } | undefined;
    const seen = new Set<string>();
    // Renfe's live route_id can identify a different C7 variant from the static
    // ordered stations (observed SPECIAL_10_91677C7). Keep that official route_id,
    // but accept geometry from the same line only after matching every station.
    const route = gtfs.routes.get(routeId)!;
    const templateIds = [...gtfs.routes.values()].filter((r) => this.allowedRoutes.has(r.routeId) && r.shortName === route.shortName && r.routeType === route.routeType)
      .sort((a, b) => Number(b.routeId === routeId) - Number(a.routeId === routeId))
      .flatMap((r) => gtfs.routeTripIds.get(r.routeId) ?? []);
    for (const templateId of templateIds) {
      const trip = gtfs.trips.get(templateId); if (!trip?.shapeId || seen.has(trip.shapeId)) continue;
      const stops = gtfs.tripStops.get(templateId) ?? [];
      let cursor = 0;
      if (!raw.every((s) => { const index = stops.findIndex((p, i) => i >= cursor && p.stopId === s.stopId); cursor = index + 1; return index >= 0; })) continue;
      seen.add(trip.shapeId);
      const metric = shapeMetric(gtfs, trip.shapeId); if (!metric) continue;
      let progress = 0, score = 0, valid = true;
      for (const row of raw) {
        const stop = gtfs.stops.get(row.stopId!)!, projected = projectOntoShape(metric, [stop.longitude, stop.latitude], progress);
        if (!projected || projected.distanceMeters > 120) { valid = false; break; }
        progress = projected.progressMeters; score += projected.distanceMeters;
      }
      if (valid && (!best || score < best.score)) best = { tripId: templateId, score };
    }
    if (!best || this.active.size >= 500 && !this.active.has(tripId)) return false;
    const template = gtfs.trips.get(best.tripId)!;
    let date = update.trip.startDate ?? formatServiceDate(new Date(times[0].arrival), this.timezone).date;
    if (!/^\d{8}$/.test(date) || shiftDate(date, 0).date !== date) return false;
    // GTFS's noon-minus-12h origin can follow civil midnight on an autumn DST
    // day. The previous service date represents that early call with extended hours.
    if (!update.trip.startDate && times[0].arrival < serviceEpoch(date, 0, this.timezone)) date = shiftDate(date, -1).date;
    const origin = serviceEpoch(date, 0, this.timezone);
    if (times[0].arrival < origin || times.at(-1)!.departure - origin > 48 * 3600_000) return false;
    const time = (at: number) => { const seconds = Math.round((at - origin) / 1000); return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
    const serviceId = `realtime-added:${date}`;
    const stops: GtfsTripStop[] = raw.map((s, i) => ({ stopId: s.stopId!, sequence: s.stopSequence ?? i + 1, arrivalTime: time(times[i].arrival), departureTime: time(times[i].departure) }));
    if (stops.some((s, i) => i > 0 && s.sequence <= stops[i - 1].sequence)) return false;
    gtfs.calendarDates.set(serviceId, new Map([[date, 1]]));
    gtfs.trips.set(tripId, { ...template, tripId, routeId, serviceId, headsign: gtfs.stops.get(raw.at(-1)!.stopId!)!.name });
    gtfs.tripStops.set(tripId, stops); invalidateTripPlan(gtfs, tripId);
    this.active.set(tripId, { at, signature });
    return true;
  }
}
