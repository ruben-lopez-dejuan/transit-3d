import path from "node:path";

export const BIZKAIBUS_GTFS_URL =
  "https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfs_bizkaibus.zip";

export const BIZKAIBUS_REALTIME_URL =
  "https://opendata.euskadi.eus/transport/moveuskadi/bizkaibus/gtfsrt_Bizkaibus_vehicle_positions.pb";

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
