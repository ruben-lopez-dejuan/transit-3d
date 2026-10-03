import fs from 'node:fs';
import path from 'node:path';
import { parse as parseStream } from 'csv-parse';
import { parse as parseSync } from 'csv-parse/sync';
import type { BizkaibusGtfs, GtfsRoute } from '../providers/bizkaibus/gtfs';
import { expandFrequencies } from './frequencies';
import { isServiceActive, type ServiceDate } from './gtfsCalendar';
import { serviceEpoch } from './plans';

// Parse dependencies first so large national feeds can be filtered while they
// are streamed instead of retaining unrelated stops and shapes until the end.
const tables = ['calendar', 'calendar_dates', 'routes', 'trips', 'stop_times', 'stops', 'shapes', 'frequencies'] as const;
type Table = typeof tables[number];
const optional = new Set<Table>(['calendar', 'calendar_dates', 'frequencies']);
const options = {
  columns: (headers: string[]) => headers.map((header) => header.trim()),
  cast: (value: string) => value.trim(),
  skip_empty_lines: true, bom: true, relax_column_count: true, relax_quotes: true,
};

/** Both readers use identical normalization; the streaming reader retains only the GTFS model. */
type FrequencyWindow = { from: number; to: number; timezone: string };
function builder(includeRoute: (route: GtfsRoute) => boolean, serviceDates?: ServiceDate[], frequencyWindow?: FrequencyWindow) {
  const feed: BizkaibusGtfs = {
    routes: new Map(), trips: new Map(), shapes: new Map(), stops: new Map(),
    tripStops: new Map(), routeTripIds: new Map(), calendars: new Map(), calendarDates: new Map(),
  };
  const frequencies: Record<string, string>[] = [];
  const referencedStops = new Set<string>();
  const referencedShapes = new Set<string>();
  function add(table: Table, row: Record<string, string>) {
    switch (table) {
      case 'calendar':
        feed.calendars.set(row.service_id, { serviceId: row.service_id,
          weekdays: [row.monday, row.tuesday, row.wednesday, row.thursday, row.friday, row.saturday, row.sunday].map((value) => value === '1'),
          startDate: row.start_date, endDate: row.end_date });
        break;
      case 'calendar_dates': {
        const type = Number(row.exception_type);
        if (type !== 1 && type !== 2) return;
        if (!feed.calendarDates.has(row.service_id)) feed.calendarDates.set(row.service_id, new Map());
        feed.calendarDates.get(row.service_id)!.set(row.date, type);
        break;
      }
      case 'routes': {
        const route: GtfsRoute = { routeId: row.route_id, shortName: row.route_short_name || row.route_id,
          longName: row.route_long_name || '', color: row.route_color || '0067A8',
          textColor: row.route_text_color || 'FFFFFF', routeType: Number(row.route_type || 3) };
        if (includeRoute(route)) feed.routes.set(route.routeId, route);
        break;
      }
      case 'trips': {
        if (!feed.routes.has(row.route_id) || (serviceDates && !serviceDates.some(({ date, weekday }) => isServiceActive(feed, row.service_id, date, weekday)))) return;
        const trip = { tripId: row.trip_id, routeId: row.route_id, serviceId: row.service_id,
          shapeId: row.shape_id || null, headsign: row.trip_headsign || '',
          directionId: ['0', '1'].includes(row.direction_id) ? Number(row.direction_id) : null };
        feed.trips.set(trip.tripId, trip);
        if (trip.shapeId) referencedShapes.add(trip.shapeId);
        if (!feed.routeTripIds.has(trip.routeId)) feed.routeTripIds.set(trip.routeId, []);
        feed.routeTripIds.get(trip.routeId)!.push(trip.tripId);
        break;
      }
      case 'stops': {
        if (!referencedStops.has(row.stop_id)) return;
        const latitude = Number(row.stop_lat), longitude = Number(row.stop_lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        feed.stops.set(row.stop_id, { stopId: row.stop_id, stopCode: row.stop_code || '', name: row.stop_name || row.stop_id, latitude, longitude });
        break;
      }
      case 'stop_times':
        if (!feed.trips.has(row.trip_id)) return;
        referencedStops.add(row.stop_id);
        if (!feed.tripStops.has(row.trip_id)) feed.tripStops.set(row.trip_id, []);
        feed.tripStops.get(row.trip_id)!.push({ stopId: row.stop_id, sequence: Number(row.stop_sequence),
          arrivalTime: row.arrival_time || null, departureTime: row.departure_time || null });
        break;
      case 'shapes': {
        if (!referencedShapes.has(row.shape_id)) return;
        const longitude = Number(row.shape_pt_lon), latitude = Number(row.shape_pt_lat), sequence = Number(row.shape_pt_sequence);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(sequence)) return;
        if (!feed.shapes.has(row.shape_id)) feed.shapes.set(row.shape_id, []);
        feed.shapes.get(row.shape_id)!.push({ longitude, latitude, sequence });
        break;
      }
      case 'frequencies': if (feed.trips.has(row.trip_id)) frequencies.push(row); break;
    }
  }
  function finish() {
    for (const calls of feed.tripStops.values()) calls.sort((a, b) => a.sequence - b.sequence);
    for (const points of feed.shapes.values()) points.sort((a, b) => a.sequence - b.sequence);
    expandFrequencies(feed, frequencies, (trip, seconds) => !frequencyWindow || Boolean(serviceDates?.some(({ date, weekday }) => isServiceActive(feed, trip.serviceId, date, weekday) && serviceEpoch(date, seconds, frequencyWindow.timezone) >= frequencyWindow.from && serviceEpoch(date, seconds, frequencyWindow.timezone) <= frequencyWindow.to)));
    return feed;
  }
  return { add, finish };
}

export function parseGtfsDirectory(directory: string, includeRoute: (route: GtfsRoute) => boolean = () => true, serviceDates?: ServiceDate[]): BizkaibusGtfs {
  const model = builder(includeRoute, serviceDates);
  for (const table of tables) {
    const file = path.join(directory, `${table}.txt`);
    if (optional.has(table) && !fs.existsSync(file)) continue;
    for (const row of parseSync(fs.readFileSync(file, 'utf8'), options) as Record<string, string>[]) model.add(table, row);
  }
  return model.finish();
}

export async function parseGtfsDirectoryStreaming(directory: string, includeRoute: (route: GtfsRoute) => boolean = () => true, serviceDates?: ServiceDate[], frequencyWindow?: FrequencyWindow): Promise<BizkaibusGtfs> {
  const model = builder(includeRoute, serviceDates, frequencyWindow);
  for (const table of tables) {
    const file = path.join(directory, `${table}.txt`);
    if (optional.has(table) && !fs.existsSync(file)) continue;
    const source = fs.createReadStream(file), parser = parseStream(options);
    source.on('error', (error) => parser.destroy(error));
    source.pipe(parser);
    try {
      for await (const row of parser) model.add(table, row as Record<string, string>);
    } finally {
      source.destroy(); parser.destroy();
    }
  }
  return model.finish();
}
