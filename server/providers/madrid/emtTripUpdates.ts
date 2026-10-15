import type { BizkaibusGtfs } from '../bizkaibus/gtfs';
import type { RealtimeMessage, TripUpdate } from '../../transit/realtime';
import { formatServiceDate, isServiceActive, parseGtfsTime, previousServiceDate } from '../../transit/gtfsCalendar';
import { serviceEpoch, timelineFor, tripPlan } from '../../transit/plans';
import type { EmtArrival } from './emt';

/** How far from its timetable a bus may be (late, early) and still be the same journey. */
const LATE_MS = 20 * 60_000, EARLY_MS = 15 * 60_000;
/** Disagreement tolerated between EMT's metres to the stop and the matched journey's position. */
const DISTANCE_TOLERANCE = (meters: number) => 600 + meters * .25;

type Call = { tripId: string; sequence: number; seconds: number };
type Index = { stops: Map<string, string[]>; lines: Map<string, string[]>; calls: Map<string, Call[]> };
const indexes = new WeakMap<BizkaibusGtfs, Index>();
const lineName = (value: string) => value.replace(/^0+(?=\d)/, '').toUpperCase();
function indexFor(gtfs: BizkaibusGtfs): Index {
  let index = indexes.get(gtfs);
  if (!index) {
    const stops = new Map<string, string[]>(), lines = new Map<string, string[]>();
    for (const stop of gtfs.stops.values()) { const code = stop.stopCode || stop.stopId; stops.set(code, [...stops.get(code) ?? [], stop.stopId]); }
    for (const route of gtfs.routes.values()) { const name = lineName(route.shortName); lines.set(name, [...lines.get(name) ?? [], route.routeId]); }
    index = { stops, lines, calls: new Map() }; indexes.set(gtfs, index);
  }
  return index;
}
/** Every timetabled call of a route at a stop, worked out once per stop that is queried. */
function callsAt(gtfs: BizkaibusGtfs, index: Index, routeId: string, stopId: string) {
  const key = `${routeId}\n${stopId}`;
  let calls = index.calls.get(key);
  if (!calls) {
    calls = (gtfs.routeTripIds.get(routeId) ?? []).flatMap((tripId) => (gtfs.tripStops.get(tripId) ?? []).flatMap((s) => {
      const seconds = s.stopId === stopId ? parseGtfsTime(s.arrivalTime) ?? parseGtfsTime(s.departureTime) : null;
      return seconds === null ? [] : [{ tripId, sequence: s.sequence, seconds }];
    }));
    if (index.calls.size >= 2000) index.calls.clear();
    index.calls.set(key, calls);
  }
  return calls;
}

export type EmtMatch = { row: EmtArrival; tripId: string; serviceDate: string; sequence: number; stopId: string; scheduled: number; delaySeconds: number; distanceGap: number | null };

/**
 * Joins EMT's per-stop arrivals (bus, line, seconds to the stop, metres to it)
 * to the timetabled journeys those buses are running. At each stop the buses of
 * a line take that line's calls in the same order (buses do not overtake), the
 * set closest to the timetable overall. A bus counts for a journey only if it is
 * between 15 min early (night lines reach Cibeles well ahead) and 20 min late,
 * the journey has started, and EMT's metres to the stop agree with it. A bus
 * seen at several queried stops keeps one journey.
 */
export function matchEmtArrivals(gtfs: BizkaibusGtfs, rows: EmtArrival[], now: number, timezone = 'Europe/Madrid'): EmtMatch[] {
  const index = indexFor(gtfs), today = formatServiceDate(new Date(now), timezone), dates = [today, previousServiceDate(today.date)];
  const usedTrips = new Set<string>(), byBus = new Map<string, EmtMatch>(), matches: EmtMatch[] = [];
  const groups = new Map<string, EmtArrival[]>();
  for (const row of rows) groups.set(`${lineName(row.line)}\n${row.stop}`, [...groups.get(`${lineName(row.line)}\n${row.stop}`) ?? [], row]);
  for (const group of [...groups.values()].sort((a, b) => Math.min(...a.map((r) => r.at)) - Math.min(...b.map((r) => r.at)))) {
    const ordered = group.sort((a, b) => a.at - b.at), routes = index.lines.get(lineName(ordered[0].line)) ?? [], stops = index.stops.get(ordered[0].stop) ?? [];
    if (routes.length !== 1) continue;
    const options = ordered.map((row) => {
      const previous = byBus.get(row.bus);
      return stops.flatMap((stopId) => callsAt(gtfs, index, routes[0], stopId).flatMap((call) => dates.flatMap(({ date, weekday }) => {
        const trip = gtfs.trips.get(call.tripId)!;
        if (!isServiceActive(gtfs, trip.serviceId, date, weekday)) return [];
        const scheduled = serviceEpoch(date, call.seconds, timezone), lateness = row.at - scheduled;
        if (lateness > LATE_MS || lateness < -EARLY_MS) return [];
        if (previous ? previous.tripId !== call.tripId || previous.serviceDate !== date : usedTrips.has(`${date}:${call.tripId}`)) return [];
        const option: EmtMatch = { row, tripId: call.tripId, serviceDate: date, sequence: call.sequence, stopId, scheduled, delaySeconds: Math.round(lateness / 1000), distanceGap: null };
        return consistent(gtfs, option, timezone) ? [option] : [];
      })));
    });
    // Order-preserving choice for this line and stop: each bus takes a later call
    // than the bus before it, or none; fewest unmatched buses, then least deviation.
    let best: { picked: (EmtMatch | null)[]; missing: number; deviation: number } = { picked: ordered.map(() => null), missing: ordered.length, deviation: 0 };
    const search = (i: number, after: number, picked: (EmtMatch | null)[], missing: number, deviation: number) => {
      if (missing > best.missing || missing === best.missing && deviation >= best.deviation && i > 0) return;
      if (i === ordered.length) { best = { picked: [...picked], missing, deviation }; return; }
      for (const option of options[i]) if (option.scheduled > after && !picked.some((p) => p?.tripId === option.tripId && p.serviceDate === option.serviceDate)) search(i + 1, option.scheduled, [...picked, option], missing, deviation + Math.abs(option.delaySeconds));
      search(i + 1, after, [...picked, null], missing + 1, deviation);
    };
    if (options.length <= 6) search(0, -Infinity, [], 0, 0);
    for (const match of best.picked) if (match) { usedTrips.add(`${match.serviceDate}:${match.tripId}`); byBus.set(match.row.bus, match); matches.push(match); }
  }
  return matches;
}
/** The journey must already be under way when EMT answered, and put the bus about where EMT does. */
function consistent(gtfs: BizkaibusGtfs, option: EmtMatch, timezone: string) {
  const plan = tripPlan(gtfs, option.tripId), stop = plan?.stops.find((s) => s.sequence === option.sequence);
  if (!plan || !stop) return false;
  // Where this journey puts the bus when EMT answered, shifted by the delay EMT implies.
  const timeline = timelineFor(plan, option.serviceDate, option.delaySeconds, timezone), at = option.row.sourceTimestamp;
  if (at < timeline[0].at) return false; // Still on its previous journey or at the terminus.
  if (option.row.distanceMeters == null) return true;
  const next = timeline.findIndex((a) => a.at >= at), a = timeline[Math.max(0, next - 1)], b = timeline[next < 0 ? timeline.length - 1 : next];
  const expected = next < 0 ? timeline.at(-1)!.progress : a.progress + (b.progress - a.progress) * Math.min(1, (at - a.at) / Math.max(1, b.at - a.at));
  option.distanceGap = Math.round(stop.progress - option.row.distanceMeters - expected);
  return Math.abs(option.distanceGap) <= DISTANCE_TOLERANCE(option.row.distanceMeters);
}

/** The joined arrivals as GTFS-RT TripUpdates: the whole journey carries the delay EMT gives for its stop. */
export function emtTripUpdates(gtfs: BizkaibusGtfs, rows: EmtArrival[], now: number, timezone = 'Europe/Madrid'): RealtimeMessage | null {
  if (!rows.length) return null;
  const updates = new Map<string, TripUpdate>();
  for (const match of matchEmtArrivals(gtfs, rows, now, timezone).sort((a, b) => a.sequence - b.sequence)) {
    const key = `${match.serviceDate}:${match.tripId}`;
    const update = updates.get(key) ?? { trip: { tripId: match.tripId, startDate: match.serviceDate, scheduleRelationship: 'SCHEDULED' }, vehicle: { id: match.row.bus }, timestamp: match.row.sourceTimestamp / 1000, delay: match.delaySeconds, stopTimeUpdate: [] };
    update.stopTimeUpdate!.push({ stopId: match.stopId, stopSequence: match.sequence, arrival: { time: Math.round(match.row.at / 1000) } });
    update.timestamp = Math.max(update.timestamp!, match.row.sourceTimestamp / 1000);
    updates.set(key, update);
  }
  return { header: { timestamp: Math.max(...rows.map((r) => r.sourceTimestamp)) / 1000, incrementality: 'FULL_DATASET' }, entity: [...updates.values()].map((tripUpdate) => ({ tripUpdate })) };
}
