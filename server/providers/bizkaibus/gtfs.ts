import fs from "node:fs";
import path from "node:path";

import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";

import { downloadFile } from "../../lib/download";
import {
  BIZKAIBUS_GTFS_DIR,
  BIZKAIBUS_GTFS_URL,
  BIZKAIBUS_GTFS_ZIP,
} from "./config";

export type GtfsRoute = {
  routeId: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
};

export type GtfsTrip = {
  tripId: string;
  routeId: string;
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
};

export type BizkaibusGtfs = {
  routes: Map<string, GtfsRoute>;
  trips: Map<string, GtfsTrip>;
  shapes: Map<string, GtfsShapePoint[]>;
  stops: Map<string, GtfsStop>;
  tripStops: Map<string, GtfsTripStop[]>;
  routeTripIds: Map<string, string[]>;
};

const MAX_GTFS_AGE_MS = 6 * 60 * 60 * 1000;
let cache: BizkaibusGtfs | null = null;

function isFresh(file: string, maxAgeMs: number) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

function readCsv(filename: string) {
  return parse(
    fs.readFileSync(path.join(BIZKAIBUS_GTFS_DIR, filename), "utf8"),
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
  if (!isFresh(BIZKAIBUS_GTFS_ZIP, MAX_GTFS_AGE_MS)) {
    console.log("Downloading Bizkaibus GTFS...");

    const bytes = await downloadFile(
      BIZKAIBUS_GTFS_URL,
      BIZKAIBUS_GTFS_ZIP,
    );

    console.log(`Downloaded ${bytes} bytes.`);
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
    console.log("Extracting Bizkaibus GTFS...");

    fs.rmSync(BIZKAIBUS_GTFS_DIR, {
      recursive: true,
      force: true,
    });

    fs.mkdirSync(BIZKAIBUS_GTFS_DIR, { recursive: true });

    new AdmZip(BIZKAIBUS_GTFS_ZIP).extractAllTo(
      BIZKAIBUS_GTFS_DIR,
      true,
    );

    fs.writeFileSync(markerPath, sourceMtime, "utf8");
  }
}

export async function getBizkaibusGtfs(): Promise<BizkaibusGtfs> {
  if (cache) return cache;

  await ensureGtfsFiles();

  const routes = new Map<string, GtfsRoute>();
  const trips = new Map<string, GtfsTrip>();
  const shapes = new Map<string, GtfsShapePoint[]>();
  const stops = new Map<string, GtfsStop>();
  const tripStops = new Map<string, GtfsTripStop[]>();
  const routeTripIds = new Map<string, string[]>();

  for (const row of readCsv("routes.txt")) {
    routes.set(row.route_id, {
      routeId: row.route_id,
      shortName: row.route_short_name || row.route_id,
      longName: row.route_long_name || "",
      color: row.route_color || "0067A8",
      textColor: row.route_text_color || "FFFFFF",
    });
  }

  for (const row of readCsv("trips.txt")) {
    const trip: GtfsTrip = {
      tripId: row.trip_id,
      routeId: row.route_id,
      shapeId: row.shape_id || null,
      headsign: row.trip_headsign || "",
      directionId:
        row.direction_id === "" ? null : Number(row.direction_id),
    };

    trips.set(trip.tripId, trip);

    if (!routeTripIds.has(trip.routeId)) {
      routeTripIds.set(trip.routeId, []);
    }

    routeTripIds.get(trip.routeId)!.push(trip.tripId);
  }

  for (const row of readCsv("stops.txt")) {
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

  for (const row of readCsv("stop_times.txt")) {
    if (!trips.has(row.trip_id)) continue;

    if (!tripStops.has(row.trip_id)) {
      tripStops.set(row.trip_id, []);
    }

    tripStops.get(row.trip_id)!.push({
      stopId: row.stop_id,
      sequence: Number(row.stop_sequence),
    });
  }

  for (const items of tripStops.values()) {
    items.sort((a, b) => a.sequence - b.sequence);
  }

  for (const row of readCsv("shapes.txt")) {
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

  cache = {
    routes,
    trips,
    shapes,
    stops,
    tripStops,
    routeTripIds,
  };

  return cache;
}
