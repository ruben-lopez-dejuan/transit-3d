import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import bindings from 'gtfs-realtime-bindings';
import { parse } from 'csv-parse/sync';
import { downloadFile } from '../lib/download';
import { parseGtfsDirectoryStreaming } from '../transit/gtfsParser';
import { formatServiceDate, isServiceActive } from '../transit/gtfsCalendar';
import { NapClient } from './nap';
import type { ResolvedSource } from './types';
import type { RealtimeMessage } from '../transit/realtime';
const value = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : undefined; };
const nap = value('nap'), url = value('url'), kind = value('kind') ?? 'gtfs';
if (!!nap === !!url) throw new Error('Indica exactamente --nap datasetId:fileId o --url https://...');
let resolved: ResolvedSource | undefined = url ? { url, identity: `http:${url}`, temporary: false } : undefined;
if (nap) { const match = /^(\d+):(\d+)$/.exec(nap); if (!match) throw new Error('--nap requiere datasetId:fileId'); resolved = await new NapClient().resolve({ type: 'nap', datasetId: Number(match[1]), fileId: Number(match[2]) }); }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-inspect-')), file = path.join(root, kind === 'gtfs' ? 'feed.zip' : 'feed.pb');
try {
  await downloadFile({ url: resolved!.url, headers: resolved!.headers, timeoutMs: 60_000 }, file);
  if (kind === 'gtfs') {
    const zip = new AdmZip(file), directory = path.join(root, 'tables'); fs.mkdirSync(directory);
    const names = zip.getEntries().map((entry) => entry.entryName);
    for (const table of ['agency', 'routes', 'trips', 'stops', 'stop_times', 'shapes', 'calendar', 'calendar_dates', 'frequencies', 'feed_info']) { const entry = zip.getEntry(`${table}.txt`); if (entry) fs.writeFileSync(path.join(directory, `${table}.txt`), entry.getData()); }
    const feed = await parseGtfsDirectoryStreaming(directory), date = formatServiceDate(new Date(), 'Europe/Madrid');
    const activeServices = new Set([...feed.calendars.keys(), ...feed.calendarDates.keys()].filter((id) => isServiceActive(feed, id, date.date, date.weekday)));
    const referencedStops = new Set([...feed.tripStops.values()].flatMap((calls) => calls.map((call) => call.stopId)));
    const summary = { source: resolved!.identity, bytes: fs.statSync(file).size, tables: names.filter((name) => name.endsWith('.txt')).sort(), routes: feed.routes.size, trips: feed.trips.size, stops: feed.stops.size, shapes: feed.shapes.size, activeServices: activeServices.size, routeTypes: [...new Set([...feed.routes.values()].map((route) => route.routeType))].sort((a, b) => a - b), directions: [...new Set([...feed.trips.values()].map((trip) => trip.directionId))], tripsWithoutShape: [...feed.trips.values()].filter((trip) => !trip.shapeId || !feed.shapes.has(trip.shapeId)).length, shortShapes: [...feed.shapes.values()].filter((points) => points.length < 2).length, missingReferencedStops: [...referencedStops].filter((id) => !feed.stops.has(id)).length };
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const feed = bindings.transit_realtime.FeedMessage.toObject(bindings.transit_realtime.FeedMessage.decode(fs.readFileSync(file)), { longs: Number, enums: String }) as RealtimeMessage;
    const entities = feed.entity ?? [], positions = entities.filter((entity) => entity.vehicle?.position), updates = entities.filter((entity) => entity.tripUpdate);
    const sourceSeconds = feed.header?.timestamp, sourceTimestamp = typeof sourceSeconds === 'number' ? sourceSeconds * 1000 : null;
    const tripRefs = entities.flatMap((entity) => { const trip = entity.tripUpdate?.trip ?? entity.vehicle?.trip; return trip?.tripId ? [{ tripId: trip.tripId, routeId: trip.routeId, startDate: trip.startDate }] : []; });
    let joins: { referencedTrips: number; knownTrips: number; tripJoinPercent: number | null; referencedRoutes: number; knownRoutes: number; routeJoinPercent: number | null } | undefined;
    const staticPath = value('gtfs');
    if (staticPath) {
      const zip = new AdmZip(path.resolve(staticPath));
      const rows = (name: string) => { const entry = zip.getEntry(name); if (!entry) throw new Error(`GTFS de referencia sin ${name}`); return parse(entry.getData(), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[]; };
      const knownTrips = new Set(rows('trips.txt').map((row) => row.trip_id)), knownRoutes = new Set(rows('routes.txt').map((row) => row.route_id));
      const routeRefs = tripRefs.filter((row) => row.routeId).map((row) => row.routeId!);
      joins = { referencedTrips: tripRefs.length, knownTrips: tripRefs.filter((row) => knownTrips.has(row.tripId)).length, tripJoinPercent: tripRefs.length ? Math.round(tripRefs.filter((row) => knownTrips.has(row.tripId)).length / tripRefs.length * 1000) / 10 : null, referencedRoutes: routeRefs.length, knownRoutes: routeRefs.filter((id) => knownRoutes.has(id)).length, routeJoinPercent: routeRefs.length ? Math.round(routeRefs.filter((id) => knownRoutes.has(id)).length / routeRefs.length * 1000) / 10 : null };
    }
    const entityTimestamps = entities.flatMap((entity) => [entity.vehicle?.timestamp, entity.tripUpdate?.timestamp]).filter((at): at is number => typeof at === 'number' && Number.isFinite(at)).map((at) => at * 1000);
    console.log(JSON.stringify({ source: resolved!.identity, bytes: fs.statSync(file).size, version: feed.header?.gtfsRealtimeVersion, incrementality: feed.header?.incrementality, sourceTimestamp, ageSeconds: sourceTimestamp ? Math.round((Date.now() - sourceTimestamp) / 1000) : null, oldestEntityTimestamp: entityTimestamps.length ? Math.min(...entityTimestamps) : null, newestEntityTimestamp: entityTimestamps.length ? Math.max(...entityTimestamps) : null, entities: entities.length, tripUpdates: updates.length, vehiclePositions: positions.length, withTripId: tripRefs.length, withRouteId: tripRefs.filter((row) => row.routeId).length, serviceDates: [...new Set(tripRefs.map((row) => row.startDate).filter(Boolean))], invalidCoordinates: positions.filter((entity) => { const p = entity.vehicle!.position!; return !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude!) > 90 || Math.abs(p.longitude!) > 180; }).length, joins }, null, 2));
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
