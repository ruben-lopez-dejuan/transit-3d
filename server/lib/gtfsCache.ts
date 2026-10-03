import fs from 'node:fs';
import { serialize, deserialize } from 'node:v8';
import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';

// Bump when parser/preparation semantics change. Files are generated locally only.
const version = 5;
export function readParsedFeed(file: string, zip: string, variant: string | null = null): BizkaibusGtfs | null {
  try {
    const value = deserialize(fs.readFileSync(file));
    return value.version === version && value.variant === variant && value.source === fs.statSync(zip).mtimeMs && value.feed.trips instanceof Map && value.feed.shapes instanceof Map ? value.feed : null;
  } catch { return null; }
}
export function writeParsedFeed(file: string, zip: string, feed: BizkaibusGtfs, variant: string | null = null) {
  const temporary = file + '.' + process.pid + '.candidate';
  fs.writeFileSync(temporary, serialize({ version, variant, source: fs.statSync(zip).mtimeMs, feed }));
  fs.renameSync(temporary, file);
}
