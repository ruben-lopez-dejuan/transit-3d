import fs from 'node:fs';
import path from 'node:path';
import bindings from 'gtfs-realtime-bindings';
import { downloadFile } from './lib/download';
import { primary, regionalSources, renfeSource } from './cities/es-bilbao/sources';
import { gtfsLoaders } from './cities/es-bilbao/providers';
import { BIZKAIBUS_REALTIME_URL } from './providers/bizkaibus/config';
import { normalizeTripUpdates, resolveServiceDate, freshTimestamp, type RealtimeMessage } from './transit/realtime';
import { applyRealtime } from './transit/applyRealtime';
import { bilbobusPositionTimestamp, BILBOBUS_POSITIONS } from './providers/bilbobus';

// One sample per source. No animation, polling loop or timestamp correction.
const sources = [{ id: 'bizkaibus', tripUpdates: 'https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfsrt_bizkaibus_trip_updates.pb', vehiclePositions: BIZKAIBUS_REALTIME_URL }, ...primary, renfeSource, ...regionalSources.filter((s) => s.tripUpdates || s.vehiclePositions)];
const directory = path.resolve('server/cache/audit/euskadi');
const reports: Record<string, unknown>[] = [];
const report = (value: Record<string, unknown>) => { reports.push(value); console.log(JSON.stringify(value)); };
await Promise.all(sources.map(async (source) => {
  let gtfs;
  try { gtfs = await gtfsLoaders.get(source.id)!(); }
  catch (error) { report({ provider: source.id, kind: 'staticGtfs', error: String(error) }); return; }
  await Promise.all((['tripUpdates', 'vehiclePositions'] as const).map(async (kind) => {
    const url = source[kind]; if (!url) return;
    try {
      const file = path.join(directory, `${source.id}-${kind}.pb`);
      const bytes = await downloadFile(url, file), now = new Date();
      const feed = bindings.transit_realtime.FeedMessage.toObject(bindings.transit_realtime.FeedMessage.decode(fs.readFileSync(file)), { longs: Number, enums: String }) as RealtimeMessage;
      const entities = feed.entity ?? [];
      const descriptors = entities.map((e) => e.tripUpdate?.trip ?? e.vehicle?.trip);
      const matching = descriptors.filter((d) => d?.tripId && gtfs.trips.has(d.tripId));
      const updates = normalizeTripUpdates(gtfs, feed, now);
      const positions = applyRealtime(gtfs, [], source.id, new Map(), feed, now);
      const freshEntities = entities.filter((e) => freshTimestamp(e.tripUpdate ? e.tripUpdate.timestamp ?? feed.header?.timestamp : e.vehicle?.timestamp, now.getTime()) !== null);
      report({ provider: source.id, kind, bytes, sampledAt: now.toISOString(), headerAgeSeconds: feed.header?.timestamp ? Math.round(now.getTime() / 1000 - feed.header.timestamp) : null, entities: entities.length, freshEntities: freshEntities.length, matchingTrips: matching.length, normalizedUpdates: updates.size, normalizedPositions: positions.length, sampleTrip: descriptors[0], sampleTimestamp: entities[0]?.tripUpdate?.timestamp ?? entities[0]?.vehicle?.timestamp ?? null, unmatchedTrip: descriptors.find((d) => d?.tripId && !gtfs.trips.has(d.tripId))?.tripId, resolvedSampleDate: entities[0]?.tripUpdate ? resolveServiceDate(gtfs, entities[0].tripUpdate.trip, now, entities[0].tripUpdate.stopTimeUpdate) : null });
    } catch (error) { report({ provider: source.id, kind, error: String(error) }); }
  }));
}));
for (const line of ['18', 'G1']) {
  try {
    const response = await fetch(`${BILBOBUS_POSITIONS}/${line}/IDA`, { signal: AbortSignal.timeout(8000) });
    const data = await response.json() as { rows?: { Instante: string }[] };
    const now = Date.now(), rows = data.rows ?? [];
    report({ provider: 'bilbobus', line, sampledAt: new Date(now).toISOString(), httpStatus: response.status, rows: rows.length, fresh: rows.filter((r) => freshTimestamp((bilbobusPositionTimestamp(r.Instante, now) ?? 0) / 1000, now) !== null).length, sampleTimestamp: rows[0]?.Instante ?? null });
  } catch (error) { report({ provider: 'bilbobus', line, error: String(error) }); }
}
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(reports, null, 2));
