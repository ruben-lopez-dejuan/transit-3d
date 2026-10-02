import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import { parseGtfsTime } from './gtfsCalendar';

const clock = (seconds: number) => `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds % 3600 / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
/** Expand frequency templates into explicitly estimated timetable instances. */
export function expandFrequencies(gtfs: BizkaibusGtfs, rows: Record<string, string>[]) {
  const templates = new Set<string>();
  for (const row of rows) {
    const trip = gtfs.trips.get(row.trip_id), stops = gtfs.tripStops.get(row.trip_id);
    const start = parseGtfsTime(row.start_time), end = parseGtfsTime(row.end_time), headway = Number(row.headway_secs);
    const origin = parseGtfsTime(stops?.[0]?.departureTime ?? null);
    if (!trip || !stops || start === null || end === null || origin === null || !Number.isInteger(headway) || headway < 30 || end <= start || end - start > 48 * 3600) continue;
    templates.add(trip.tripId);
    for (let at = start; at < end; at += headway) {
      const id = `${trip.tripId}@${at}`;
      if (gtfs.trips.has(id)) continue;
      gtfs.trips.set(id, { ...trip, tripId: id });
      gtfs.routeTripIds.get(trip.routeId)!.push(id);
      gtfs.tripStops.set(id, stops.map((stop) => {
        const shift = (value: string | null) => { const seconds = parseGtfsTime(value); return seconds === null ? null : clock(seconds + at - origin); };
        return { ...stop, arrivalTime: shift(stop.arrivalTime), departureTime: shift(stop.departureTime) };
      }));
    }
  }
  for (const id of templates) {
    const trip = gtfs.trips.get(id)!;
    gtfs.routeTripIds.set(trip.routeId, gtfs.routeTripIds.get(trip.routeId)!.filter((value) => value !== id));
    gtfs.trips.delete(id); gtfs.tripStops.delete(id);
  }
}
