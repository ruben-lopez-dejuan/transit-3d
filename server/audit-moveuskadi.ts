import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import bindings from 'gtfs-realtime-bindings';
import { createHash } from 'node:crypto';
import { downloadFile } from './lib/download';
import { parseGtfsDirectory } from './providers/bizkaibus/gtfs';
import { normalizeTripUpdates } from './transit/realtime';

type Resource = { name: string; url: string };
const root = path.resolve('server/cache/audit');
const index = JSON.parse(fs.readFileSync(path.join(root, 'static-index.json'), 'utf8')).data as Record<string, Resource[]>;
const rtIndex = JSON.parse(fs.readFileSync(path.join(root, 'realtime-index.json'), 'utf8')).data as Record<string, Resource[]>;
const excluded = new Set(['BilboBus', 'BizkaiBus', 'Metro Bilbao', 'Euskotren', 'RENFE Cercanias', 'RENFE Media']);
const queue = Object.entries(index).filter(([name]) => !excluded.has(name));
const results: Record<string, unknown>[] = [];
async function bytes(url: string) {
  const file = path.join(root, `resource-${createHash('sha1').update(url).digest('hex')}`);
  await downloadFile(url, file);
  return fs.readFileSync(file);
}
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const [name, resources] = queue.shift()!;
    const source = resources[0], id = source.name.replace(/^gtfs_/, '').replace(/\.zip$/, '').replace(/_/g, '-');
    const directory = path.resolve('server/cache', id); fs.mkdirSync(directory, { recursive: true });
    try {
      const started = performance.now(), zipBytes = await bytes(source.url); fs.writeFileSync(path.join(directory, 'gtfs.zip'), zipBytes);
      const zip = new AdmZip(zipBytes), counts: Record<string, number> = {};
      for (const table of ['routes', 'trips', 'stops', 'stop_times', 'shapes', 'calendar', 'calendar_dates']) {
        const entry = zip.getEntry(`${table}.txt`);
        counts[table] = entry ? parse(entry.getData().toString('utf8'), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }).length : 0;
        if (entry) fs.writeFileSync(path.join(directory, `${table}.txt`), entry.getData());
      }
      const usable = counts.routes > 0 && counts.trips > 0 && counts.shapes > 1 && counts.stop_times > 1 && counts.calendar + counts.calendar_dates > 0;
      const data = usable ? parseGtfsDirectory(directory) : null;
      const realtime = [];
      for (const resource of (rtIndex[name] ?? []).filter((r) => /vehicle.position|trip.update|position.bin|tripUpdate.bin/i.test(r.name))) {
        try {
          const buffer = await bytes(resource.url);
          const feed = bindings.transit_realtime.FeedMessage.toObject(bindings.transit_realtime.FeedMessage.decode(buffer), { longs: Number, enums: String });
          fs.writeFileSync(path.join(root, `${id}-${resource.name.replace(/\W/g, '_')}.json`), JSON.stringify(feed));
          const entities = feed.entity ?? [], trips = entities.flatMap((e: any) => [e.tripUpdate?.trip?.tripId ?? e.vehicle?.trip?.tripId]).filter(Boolean);
          const joined = trips.filter((tripId: string) => data?.trips.has(tripId)).length;
          const times = entities.flatMap((e: any) => [e.vehicle?.timestamp ?? e.tripUpdate?.timestamp ?? feed.header?.timestamp]).filter(Boolean);
          realtime.push({ url: resource.url, name: resource.name, bytes: buffer.length, entities: entities.length, timestamp: feed.header?.timestamp, ageSeconds: feed.header?.timestamp ? Date.now() / 1000 - feed.header.timestamp : null, matchingTrips: joined, normalizedTrips: data && /trip.update/i.test(resource.name) ? normalizeTripUpdates(data, feed, new Date()).size : 0, observationTimes: [...new Set(times)].slice(0, 10) });
        } catch (error) { realtime.push({ url: resource.url, name: resource.name, error: String(error) }); }
      }
      const report = { id, name, url: source.url, usable, bytes: zipBytes.length, counts, realtime, elapsedMs: Math.round(performance.now() - started), routes: data ? [...data.routes.values()].map((r) => ({ id: r.routeId, label: r.shortName, mode: r.routeType })) : [] };
      results.push(report); console.log(JSON.stringify(report));
    } catch (error) { const report = { id, name, url: source.url, usable: false, error: String(error) }; results.push(report); console.log(JSON.stringify(report)); }
  }
}));
fs.writeFileSync(path.join(root, 'moveuskadi-audit.json'), JSON.stringify(results, null, 2));
