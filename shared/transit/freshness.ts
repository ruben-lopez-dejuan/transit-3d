import type { PositionSource, NormalizedVehicle } from './contracts';
/**
 * Moveuskadi republishes every feed in a batch every 2 min with data already
 * 60-80 s old (audit 14 Oct 2026), so valid data reaches ~200 s before the next
 * batch, plus up to 30 s of server and client refresh. A 180 s limit expired it
 * on every cycle and made vehicles flap between GPS, estimate and timetable.
 */
export const REALTIME_MAX_AGE_MS = 270_000;
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
