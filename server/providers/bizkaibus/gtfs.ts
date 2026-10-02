import fs from "node:fs";
import path from "node:path";

import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";

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

function isFresh(file: string, maxAgeMs: number) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

function readCsv(directory: string, filename: string) {
  const file = path.join(directory, filename);
  if (!fs.existsSync(file) && ["calendar.txt", "calendar_dates.txt"].includes(filename)) return [];
  return parse(
    fs.readFileSync(file, "utf8"),
    {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
    },
  ) as Record<string, string>[];
}

async function ensureGtfsFiles() {
  if (!isFresh(BIZKAIBUS_GTFS_ZIP, STATIC_GTFS_MAX_AGE_MS)) {
    console.log("[Bizkaibus] Downloading static GTFS...");

    const bytes = await downloadFile(
      BIZKAIBUS_GTFS_URL,
      BIZKAIBUS_GTFS_ZIP,
    );

    console.log(`[Bizkaibus] Static GTFS: ${bytes} bytes.`);
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
  if (memoryCache) return memoryCache;

  await ensureGtfsFiles();
  memoryCache = parseGtfsDirectory(BIZKAIBUS_GTFS_DIR);
  console.log(`[Bizkaibus] GTFS ready: ${memoryCache.routes.size} routes, ${memoryCache.trips.size} trips.`);
  return memoryCache;
}

export function parseGtfsDirectory(directory: string): BizkaibusGtfs {
  const routes = new Map<string, GtfsRoute>();
  const trips = new Map<string, GtfsTrip>();
  const shapes = new Map<string, GtfsShapePoint[]>();
  const stops = new Map<string, GtfsStop>();
  const tripStops = new Map<string, GtfsTripStop[]>();
  const routeTripIds = new Map<string, string[]>();
  const calendars = new Map<string, GtfsCalendar>();
  const calendarDates = new Map<string, Map<string, 1 | 2>>();

  for (const row of readCsv(directory, "calendar.txt")) {
    calendars.set(row.service_id, {
      serviceId: row.service_id,
      weekdays: [
        row.monday, row.tuesday, row.wednesday, row.thursday,
        row.friday, row.saturday, row.sunday,
      ].map((value) => value === "1"),
      startDate: row.start_date,
      endDate: row.end_date,
    });
  }

  for (const row of readCsv(directory, "calendar_dates.txt")) {
    const exceptionType = Number(row.exception_type);
    if (exceptionType !== 1 && exceptionType !== 2) continue;
    if (!calendarDates.has(row.service_id)) {
      calendarDates.set(row.service_id, new Map());
    }
    calendarDates.get(row.service_id)!.set(row.date, exceptionType);
  }

  for (const row of readCsv(directory, "routes.txt")) {
    routes.set(row.route_id, {
      routeId: row.route_id,
      shortName: row.route_short_name || row.route_id,
      longName: row.route_long_name || "",
      color: row.route_color || "0067A8",
      textColor: row.route_text_color || "FFFFFF",
      routeType: Number(row.route_type || 3),
    });
  }

  for (const row of readCsv(directory, "trips.txt")) {
    const trip: GtfsTrip = {
      tripId: row.trip_id,
      routeId: row.route_id,
      serviceId: row.service_id,
      shapeId: row.shape_id || null,
      headsign: row.trip_headsign || "",
      directionId: ["0", "1"].includes(row.direction_id) ? Number(row.direction_id) : null,
    };

    trips.set(trip.tripId, trip);

    if (!routeTripIds.has(trip.routeId)) {
      routeTripIds.set(trip.routeId, []);
    }

    routeTripIds.get(trip.routeId)!.push(trip.tripId);
  }

  for (const row of readCsv(directory, "stops.txt")) {
    const latitude = Number(row.stop_lat);
    const longitude = Number(row.stop_lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }

    stops.set(row.stop_id, {
      stopId: row.stop_id,
      stopCode: row.stop_code || "",
      name: row.stop_name || row.stop_id,
      latitude,
      longitude,
    });
  }

  for (const row of readCsv(directory, "stop_times.txt")) {
    if (!trips.has(row.trip_id)) continue;

    if (!tripStops.has(row.trip_id)) {
      tripStops.set(row.trip_id, []);
    }

    tripStops.get(row.trip_id)!.push({
      stopId: row.stop_id,
      sequence: Number(row.stop_sequence),
      arrivalTime: row.arrival_time || null,
      departureTime: row.departure_time || null,
    });
  }

  for (const stopTimes of tripStops.values()) {
    stopTimes.sort((a, b) => a.sequence - b.sequence);
  }

  for (const row of readCsv(directory, "shapes.txt")) {
    const longitude = Number(row.shape_pt_lon);
    const latitude = Number(row.shape_pt_lat);
    const sequence = Number(row.shape_pt_sequence);

    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(sequence)
    ) {
      continue;
    }

    if (!shapes.has(row.shape_id)) {
      shapes.set(row.shape_id, []);
    }

    shapes.get(row.shape_id)!.push({
      longitude,
      latitude,
      sequence,
    });
  }

  for (const points of shapes.values()) {
    points.sort((a, b) => a.sequence - b.sequence);
  }

  return {
    routes,
    trips,
    shapes,
    stops,
    tripStops,
    routeTripIds,
    calendars,
    calendarDates,
  };

}
