import fs from 'node:fs';
import { serialize, deserialize } from 'node:v8';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';

// Bump when parser/preparation semantics change. Files are generated locally only.
const version = 4;
export function readParsedFeed(file: string, zip: string): BizkaibusGtfs | null {
  try {
    const value = deserialize(fs.readFileSync(file));
    return value.version === version && value.source === fs.statSync(zip).mtimeMs && value.feed.trips instanceof Map && value.feed.shapes instanceof Map ? value.feed : null;
  } catch { return null; }
}
export function writeParsedFeed(file: string, zip: string, feed: BizkaibusGtfs) {
  const temporary = file + '.' + process.pid + '.candidate';
  fs.writeFileSync(temporary, serialize({ version, source: fs.statSync(zip).mtimeMs, feed }));
  fs.renameSync(temporary, file);
}
