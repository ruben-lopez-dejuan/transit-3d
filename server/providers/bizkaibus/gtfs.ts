import fs from "node:fs";
import path from "node:path";

import AdmZip from "adm-zip";
import { parseGtfsDirectory } from '../../transit/gtfsParser';
export { parseGtfsDirectory } from '../../transit/gtfsParser';
import { readParsedFeed, writeParsedFeed } from '../../lib/gtfsCache';

import { downloadFile } from "../../lib/download";
import {
  BIZKAIBUS_GTFS_DIR,
  BIZKAIBUS_GTFS_URL,
  BIZKAIBUS_GTFS_ZIP,
  STATIC_GTFS_MAX_AGE_MS,
} from "./config";

export type GtfsRoute = {
  routeId: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
  routeType: number;
};

export type GtfsTrip = {
  tripId: string;
  routeId: string;
  serviceId: string;
  shapeId: string | null;
  headsign: string;
  directionId: number | null;
};

export type GtfsShapePoint = {
  longitude: number;
  latitude: number;
  sequence: number;
};

export type GtfsStop = {
  stopId: string;
  stopCode: string;
  name: string;
  latitude: number;
  longitude: number;
};

export type GtfsTripStop = {
  stopId: string;
  sequence: number;
  arrivalTime: string | null;
  departureTime: string | null;
};

export type GtfsCalendar = {
  serviceId: string;
  weekdays: boolean[];
  startDate: string;
  endDate: string;
};

export type BizkaibusGtfs = {
  routes: Map<string, GtfsRoute>;
  trips: Map<string, GtfsTrip>;
  shapes: Map<string, GtfsShapePoint[]>;
  stops: Map<string, GtfsStop>;
  tripStops: Map<string, GtfsTripStop[]>;
  routeTripIds: Map<string, string[]>;
  calendars: Map<string, GtfsCalendar>;
  calendarDates: Map<string, Map<string, 1 | 2>>;
};

let memoryCache: BizkaibusGtfs | null = null;
let memoryExpires = 0;
let loading: Promise<BizkaibusGtfs> | null = null;

function isFresh(file: string, maxAgeMs: number) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}


async function ensureGtfsFiles() {
  if (!isFresh(BIZKAIBUS_GTFS_ZIP, STATIC_GTFS_MAX_AGE_MS)) {
    console.log("[Bizkaibus] Downloading static GTFS...");

    try {
      const bytes = await downloadFile(BIZKAIBUS_GTFS_URL, BIZKAIBUS_GTFS_ZIP);
      console.log(`[Bizkaibus] Static GTFS: ${bytes} bytes.`);
    } catch (error) {
      if (!fs.existsSync(BIZKAIBUS_GTFS_ZIP)) throw error;
      console.warn('[Bizkaibus] Static refresh failed; using the cached GTFS.');
    }
  }

  const markerPath = path.join(BIZKAIBUS_GTFS_DIR, ".source-mtime");

  const sourceMtime = String(
    Math.trunc(fs.statSync(BIZKAIBUS_GTFS_ZIP).mtimeMs),
  );

  let extractedMtime = "";

  try {
    extractedMtime = fs.readFileSync(markerPath, "utf8").trim();
  } catch {
    // First extraction.
  }

  if (extractedMtime !== sourceMtime) {
    console.log("[Bizkaibus] Extracting static GTFS...");

    fs.rmSync(BIZKAIBUS_GTFS_DIR, {
      recursive: true,
      force: true,
    });

    fs.mkdirSync(BIZKAIBUS_GTFS_DIR, {
      recursive: true,
    });

    new AdmZip(BIZKAIBUS_GTFS_ZIP).extractAllTo(
      BIZKAIBUS_GTFS_DIR,
      true,
    );

    fs.writeFileSync(markerPath, sourceMtime, "utf8");
  }
}

export async function getBizkaibusGtfs(): Promise<BizkaibusGtfs> {
  if (memoryCache && Date.now() < memoryExpires) return memoryCache;
  if (loading) return loading;
  loading = loadBizkaibusGtfs().finally(() => { loading = null; });
  return loading;
}
async function loadBizkaibusGtfs(): Promise<BizkaibusGtfs> {

  await ensureGtfsFiles();
  const parsedPath = path.join(BIZKAIBUS_GTFS_DIR, 'parsed.v8');
  memoryCache = readParsedFeed(parsedPath, BIZKAIBUS_GTFS_ZIP) ?? parseGtfsDirectory(BIZKAIBUS_GTFS_DIR);
  writeParsedFeed(parsedPath, BIZKAIBUS_GTFS_ZIP, memoryCache);
  memoryExpires = Date.now() + STATIC_GTFS_MAX_AGE_MS;
  console.log(`[Bizkaibus] GTFS ready: ${memoryCache.routes.size} routes, ${memoryCache.trips.size} trips.`);
  return memoryCache;
}

