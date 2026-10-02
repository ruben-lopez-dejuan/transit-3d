import type { PositionSource, NormalizedVehicle } from './contracts';
export const REALTIME_MAX_AGE_MS = 180_000;
export const GPS_LIVE_MAX_AGE_MS = 45_000;
export function isFresh(timestamp: number | null | undefined, now: number, maximumAge = REALTIME_MAX_AGE_MS) {
  return timestamp != null && Number.isFinite(timestamp) && timestamp > 0 && now - timestamp <= maximumAge && timestamp - now <= 60_000;
}
/** Rendering a prediction never renews its source or reception timestamp. */
export function renderedPositionSource(vehicle: Pick<NormalizedVehicle, 'sourceTimestamp' | 'positionSource'>, quality: 'real' | 'interpolated' | 'estimated', now: number): PositionSource {
  if (vehicle.positionSource === 'STALE' || (vehicle.sourceTimestamp !== null && !isFresh(vehicle.sourceTimestamp, now))) return 'STALE';
  if (vehicle.positionSource === 'SCHEDULE_SIMULATION') return 'SCHEDULE_SIMULATION';
  return quality === 'real' && vehicle.positionSource === 'GPS' ? 'GPS' : quality === 'interpolated' ? 'INTERPOLATED_REALTIME' : 'PROVIDER_ESTIMATED';
}
