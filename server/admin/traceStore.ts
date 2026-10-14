import type { AdapterVehicle, NormalizedVehicle } from '../../shared/transit/contracts';
import type { TransitDebugObservation, TransitDebugTrace } from '../../shared/transit/debug';
import type { Vehicle } from '../../shared/transit/network';

type Entry = {
  touchedAt: number;
  fingerprint: string;
  adapter: AdapterVehicle;
  normalized: NormalizedVehicle;
  presentation: Vehicle | null;
  history: TransitDebugObservation[];
};

const MAX_VEHICLES = 2_000;
const MAX_HISTORY = 20;
const MAX_AGE_MS = 30 * 60_000;

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class TransitDebugTraceStore {
  private readonly entries = new Map<string, Entry>();
  private readonly enabledUntil = new Map<string, number>();

  private key(cityId: string, vehicleId: string) {
    return cityId + '\n' + vehicleId;
  }

  enable(cityId: string, now = Date.now()) { this.enabledUntil.set(cityId, now + 60 * 60_000); }

  recordAdapter(cityId: string, adapterFetchedAt: number, adapter: AdapterVehicle, normalized: NormalizedVehicle | null, capturedAt: number) {
    if ((this.enabledUntil.get(cityId) ?? 0) < capturedAt) return;
    // Static simulations can be reconstructed from the presentation snapshot and
    // would crowd physical observations out of the bounded trace store.
    if (!normalized || normalized.sourceTimestamp === null) return;
    const key = this.key(cityId, normalized.id);
    const fingerprint = [
      normalized.sourceTimestamp,
      normalized.receivedTimestamp,
      normalized.progressMetersAlongShape,
      adapter.predictionTimestamp,
      adapter.latitude,
      adapter.longitude,
    ].join(':');
    const existing = this.entries.get(key);
    if (existing?.fingerprint === fingerprint) {
      existing.touchedAt = capturedAt;
      return;
    }
    const observation: TransitDebugObservation = {
      capturedAt,
      adapterFetchedAt,
      sourceTimestamp: normalized.sourceTimestamp,
      receivedTimestamp: normalized.receivedTimestamp,
      adapterProgress: adapter.progressMetersAlongShape,
      normalizedProgress: normalized.progressMetersAlongShape,
      presentedProgress: null,
      latitude: adapter.latitude,
      longitude: adapter.longitude,
      positionSource: normalized.positionSource,
    };
    const entry: Entry = {
      touchedAt: capturedAt,
      fingerprint,
      adapter: copy(adapter),
      normalized: copy(normalized),
      presentation: existing?.presentation ?? null,
      history: [...(existing?.history ?? []), observation].slice(-MAX_HISTORY),
    };
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.prune(capturedAt);
  }

  recordPresentation(vehicle: Vehicle, capturedAt: number) {
    if ((this.enabledUntil.get(vehicle.cityId) ?? 0) < capturedAt) return;
    const key = this.key(vehicle.cityId, vehicle.id);
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.touchedAt = capturedAt;
    entry.presentation = copy(vehicle);
    const latest = entry.history.at(-1);
    if (latest) latest.presentedProgress = vehicle.progressMetersAlongShape;
  }

  get(cityId: string, vehicleId: string, fallback: Vehicle | null, now = Date.now()): TransitDebugTrace {
    this.prune(now);
    const entry = this.entries.get(this.key(cityId, vehicleId));
    return {
      cityId,
      providerId: fallback?.providerId ?? entry?.normalized.providerId ?? '',
      vehicleId,
      generatedAt: now,
      adapter: entry ? copy(entry.adapter) : null,
      normalized: entry ? copy(entry.normalized) : null,
      presentation: entry?.presentation ? copy(entry.presentation) : fallback ? copy(fallback) : null,
      history: entry ? copy(entry.history) : [],
    };
  }

  clear() {
    this.entries.clear();
    this.enabledUntil.clear();
  }

  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (now - entry.touchedAt > MAX_AGE_MS) this.entries.delete(key);
    }
    while (this.entries.size > MAX_VEHICLES) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export const transitDebugTraceStore = new TransitDebugTraceStore();
