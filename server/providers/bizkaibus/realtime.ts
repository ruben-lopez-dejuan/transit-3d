import fs from "node:fs";

import GtfsRealtimeBindings from "gtfs-realtime-bindings";

import { downloadFile } from "../../lib/download";
import {
  BIZKAIBUS_REALTIME_FILE,
  BIZKAIBUS_REALTIME_URL,
  REALTIME_REFRESH_MS,
} from "./config";

export type RawRealtimeVehicle = {
  entityId: string;
  vehicleId: string | null;
  label: string | null;
  tripId: string | null;
  rawRouteId: string | null;
  rawLatitude: number;
  rawLongitude: number;
  currentStopSequence: number | null;
  stopId: string | null;
  timestamp: number | null;
  currentStatus?: number | null;
};

export type RawRealtimeSnapshot = {
  feedTimestamp: number | null;
  fetchedAtMs: number;
  receivedTimestamp?: number | null;
  entityCount: number;
  vehicles: RawRealtimeVehicle[];
};

let cache: RawRealtimeSnapshot | null = null;
let pending: Promise<RawRealtimeSnapshot> | null = null;
let expires = 0;
let cacheLoaded = false;

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;

  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function refreshRealtime(): Promise<RawRealtimeSnapshot> {
  if (
    cache &&
    Date.now() - cache.fetchedAtMs < REALTIME_REFRESH_MS
  ) {
    return cache;
  }

  const candidate = `${BIZKAIBUS_REALTIME_FILE}.${process.pid}.candidate`;
  try {
    await downloadFile(
      BIZKAIBUS_REALTIME_URL,
      candidate,
    );
    const snapshot = decodeBizkaibusRealtime(fs.readFileSync(candidate), Date.now(), Date.now());
    fs.renameSync(candidate, BIZKAIBUS_REALTIME_FILE);
    cache = snapshot;
    return cache;
  } catch (error) {
    console.warn(
      "[Bizkaibus] Realtime refresh failed; using last valid file.",
    );
    if (cache) return cache;
    if (!fs.existsSync(BIZKAIBUS_REALTIME_FILE)) throw error;
    cache = decodeBizkaibusRealtime(fs.readFileSync(BIZKAIBUS_REALTIME_FILE), null, 0);
    return cache;
  } finally {
    try { fs.rmSync(candidate, { force: true }); } catch { /* Preserve background failure isolation. */ }
  }
}

export function decodeBizkaibusRealtime(raw: Buffer, receivedTimestamp: number | null, fetchedAtMs: number): RawRealtimeSnapshot {
  const feed =
    GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(raw),
    );
  if (!feed.header.gtfsRealtimeVersion || feed.header.incrementality === 1) throw new Error('Unsupported realtime dataset');

  const vehicles: RawRealtimeVehicle[] = [];

  for (const entity of feed.entity) {
    const vehicle = entity.vehicle;

    if (!vehicle?.position) continue;

    const rawLatitude = Number(vehicle.position.latitude);
    const rawLongitude = Number(vehicle.position.longitude);

    if (
      !Number.isFinite(rawLatitude) ||
      !Number.isFinite(rawLongitude)
    ) {
      continue;
    }

    vehicles.push({
      entityId: entity.id,
      vehicleId: vehicle.vehicle?.id ?? null,
      label: vehicle.vehicle?.label ?? null,
      tripId: vehicle.trip?.tripId ?? null,
      rawRouteId: vehicle.trip?.routeId ?? null,
      rawLatitude,
      rawLongitude,
      currentStopSequence:
        vehicle.currentStopSequence !== undefined &&
        vehicle.currentStopSequence !== null
          ? Number(vehicle.currentStopSequence)
          : null,
      stopId: vehicle.stopId ?? null,
      timestamp: toNumber(vehicle.timestamp),
      currentStatus: Object.hasOwn(vehicle, 'currentStatus') ? toNumber(vehicle.currentStatus) : null,
    });
  }

  return {
    feedTimestamp: toNumber(feed.header.timestamp),
    fetchedAtMs,
    receivedTimestamp,
    entityCount: feed.entity.length,
    vehicles,
  };

}

export async function getBizkaibusRealtime(): Promise<RawRealtimeSnapshot> {
  if (!cacheLoaded) {
    cacheLoaded = true;
    if (fs.existsSync(BIZKAIBUS_REALTIME_FILE)) {
      try { cache = decodeBizkaibusRealtime(fs.readFileSync(BIZKAIBUS_REALTIME_FILE), null, 0); }
      catch { /* Ignore corrupt cache and refresh; timestamps are still filtered by the provider. */ }
    }
  }
  if (!pending && Date.now() >= expires) {
    expires = Date.now() + REALTIME_REFRESH_MS;
    pending = refreshRealtime().catch((error) => { console.warn('[Bizkaibus] Realtime unavailable:', error.message); return cache ?? { feedTimestamp: null, fetchedAtMs: 0, entityCount: 0, vehicles: [] }; }).finally(() => { pending = null; expires = Date.now() + REALTIME_REFRESH_MS; });
  }
  return cache ?? { feedTimestamp: null, fetchedAtMs: 0, entityCount: 0, vehicles: [] };
}
