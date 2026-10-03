import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import bindings from 'gtfs-realtime-bindings';
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
    console.log(JSON.stringify({ source: resolved!.identity, bytes: fs.statSync(file).size, version: feed.header?.gtfsRealtimeVersion, incrementality: feed.header?.incrementality, sourceTimestamp, ageSeconds: sourceTimestamp ? Math.round((Date.now() - sourceTimestamp) / 1000) : null, entities: entities.length, tripUpdates: updates.length, vehiclePositions: positions.length, withTripId: entities.filter((entity) => entity.tripUpdate?.trip?.tripId || entity.vehicle?.trip?.tripId).length, withRouteId: entities.filter((entity) => entity.tripUpdate?.trip?.routeId || entity.vehicle?.trip?.routeId).length, invalidCoordinates: positions.filter((entity) => { const p = entity.vehicle!.position!; return !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude!) > 90 || Math.abs(p.longitude!) > 180; }).length }, null, 2));
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
