import fs from 'node:fs';
import { serialize, deserialize } from 'node:v8';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';

// Bump when parser/preparation semantics change. Files are generated locally only.
const version = 6;
const maxCacheBytes = 24 * 1024 * 1024;
const maxModelEntries = 100_000;
export function readParsedFeed(file: string, zip: string, variant: string | null = null): BizkaibusGtfs | null {
  try {
    // Deserializing a very large V8 blob is synchronous and used to make the
    // whole API unresponsive (or exhaust its heap) while Madrid was starting.
    if (fs.statSync(file).size > maxCacheBytes) return null;
    const value = deserialize(fs.readFileSync(file));
    return value.version === version && value.variant === variant && value.source === fs.statSync(zip).mtimeMs && value.feed.trips instanceof Map && value.feed.shapes instanceof Map ? value.feed : null;
  } catch { return null; }
}
export function writeParsedFeed(file: string, zip: string, feed: BizkaibusGtfs, variant: string | null = null) {
  let entries = feed.routes.size + feed.trips.size + feed.stops.size + feed.calendars.size;
  for (const values of feed.shapes.values()) { entries += values.length; if (entries > maxModelEntries) return false; }
  for (const values of feed.tripStops.values()) { entries += values.length; if (entries > maxModelEntries) return false; }
  const temporary = file + '.' + process.pid + '.candidate';
  fs.writeFileSync(temporary, serialize({ version, variant, source: fs.statSync(zip).mtimeMs, feed }));
  fs.renameSync(temporary, file);
  return true;
}
