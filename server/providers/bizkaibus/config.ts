import path from "node:path";

export const BIZKAIBUS_GTFS_URL =
  "https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfs_bizkaibus.zip";

// Diputación de Bizkaia direct feeds (data.ctb.eus): same vehicle and trip ids as
// the Moveuskadi mirror, about one 60 s publication cycle fresher (audit 14 Oct 2026).
export const BIZKAIBUS_REALTIME_URL =
  "https://baliabideak.bizkaia.eus/Bizkaibus/GTFSRealTime/FeedVehiculos.pb";

export const BIZKAIBUS_TRIP_UPDATES_URL =
  "https://baliabideak.bizkaia.eus/Bizkaibus/GTFSRealTime/FeedTripUpdates.pb";

export const BIZKAIBUS_CACHE_DIR = path.resolve(
  "server",
  "cache",
  "bizkaibus",
);

export const BIZKAIBUS_GTFS_ZIP = path.join(
  BIZKAIBUS_CACHE_DIR,
  "gtfs_bizkaibus.zip",
);

export const BIZKAIBUS_GTFS_DIR = path.join(
  BIZKAIBUS_CACHE_DIR,
  "gtfs",
);

export const BIZKAIBUS_REALTIME_FILE = path.join(
  BIZKAIBUS_CACHE_DIR,
  "vehicle_positions.pb",
);

export const REALTIME_REFRESH_MS = 5_000;
export const STATIC_GTFS_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const MAX_MAP_MATCH_DISTANCE_METERS = 120;
export const STOP_WINDOW_MARGIN_METERS = 350;
