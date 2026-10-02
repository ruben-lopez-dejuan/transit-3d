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
};

export type RawRealtimeSnapshot = {
  feedTimestamp: number | null;
  fetchedAtMs: number;
  entityCount: number;
  vehicles: RawRealtimeVehicle[];
};

let cache: RawRealtimeSnapshot | null = null;
let pending: Promise<RawRealtimeSnapshot> | null = null;
let expires = 0;

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

  try {
    await downloadFile(
      BIZKAIBUS_REALTIME_URL,
      BIZKAIBUS_REALTIME_FILE,
    );
  } catch (error) {
    if (
      !fs.existsSync(BIZKAIBUS_REALTIME_FILE) ||
      fs.statSync(BIZKAIBUS_REALTIME_FILE).size < 100
    ) {
      throw error;
    }

    console.warn(
      "[Bizkaibus] Realtime refresh failed; using last valid file.",
    );
  }

  const raw = fs.readFileSync(BIZKAIBUS_REALTIME_FILE);

  const feed =
    GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(raw),
    );

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
    });
  }

  cache = {
    feedTimestamp: toNumber(feed.header.timestamp),
    fetchedAtMs: Date.now(),
    entityCount: feed.entity.length,
    vehicles,
  };

  return cache;
}

export async function getBizkaibusRealtime(): Promise<RawRealtimeSnapshot> {
  if (!pending && Date.now() >= expires) {
    expires = Date.now() + REALTIME_REFRESH_MS;
    pending = refreshRealtime().catch((error) => { console.warn('[Bizkaibus] Realtime unavailable:', error.message); return cache ?? { feedTimestamp: null, fetchedAtMs: 0, entityCount: 0, vehicles: [] }; }).finally(() => { pending = null; expires = Date.now() + REALTIME_REFRESH_MS; });
  }
  return cache ?? { feedTimestamp: null, fetchedAtMs: 0, entityCount: 0, vehicles: [] };
}
