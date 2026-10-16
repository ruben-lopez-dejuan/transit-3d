import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import type { NormalizedVehicle } from '../../shared/transit/contracts';
import type { StopArrivalsAdapter } from './cityPackage';
import type { tripPlan } from './plans';
import { positionAtProgress } from './motionEngine';
import { freshTimestamp } from './realtime';
import { GPS_LIVE_MAX_AGE_MS, OFFICIAL_STOP_MAX_AGE_MS } from '../../shared/transit/freshness';

type ArrivalPeek = StopArrivalsAdapter['peek'];
type Plan = NonNullable<ReturnType<typeof tripPlan>>;
/** A bus this close past a stop may still be at it: GPS and stop positions are a few metres off. */
export const AT_STOP_METERS = 15;
/** How much further ahead than its GPS (extrapolated at its pace) the operator must place a bus to be believed. */
const OFFICIAL_LEAD_METERS = 250;
/**
 * The operator's passing times (Bizkaibus) give the metres a bus has left to a stop when they
 * are queried; its GPS arrives 60–90 s late. On fast roads (the Artxanda tunnels) that left the
 * drawn bus kilometres behind while the app already said it was arriving. When the operator puts
 * the bus clearly further ahead, that is its latest position, so the map agrees with "Llegando".
 */
export function withOfficialPosition(vehicle: NormalizedVehicle, gtfs: BizkaibusGtfs, plan: NonNullable<ReturnType<typeof tripPlan>>, now: Date, peek: ArrivalPeek): NormalizedVehicle {
  if (vehicle.observationTimestamp == null || !vehicle.externalVehicleId) return vehicle;
  const observedAt = vehicle.observationTimestamp, observed = vehicle.observationProgressMeters ?? vehicle.progressMetersAlongShape;
  // The first stop ahead with a reading: the nearest stop gives the most precise metres.
  for (const stop of plan.stops) {
    if (stop.progress < observed - 30) continue;
    const reading = peek(gtfs, stop.stopId, vehicle.externalVehicleId);
    if (reading?.distanceMeters == null) continue;
    const at = reading.sourceTimestamp;
    // Only a late GPS needs it (Bizkaibus, 60–90 s); a recent one (Bilbobus, ~25 s) already says where the bus is.
    if (at - observedAt <= GPS_LIVE_MAX_AGE_MS || freshTimestamp(at / 1000, now.getTime()) === null) return vehicle;
    const progress = Math.max(observed, stop.progress - reading.distanceMeters);
    const pace = vehicle.speedMetersPerSecond ?? 0, travelled = (progress - observed) * 1000 / (at - observedAt);
    if (progress - (observed + pace * (at - observedAt) / 1000) < OFFICIAL_LEAD_METERS || travelled > 40) return vehicle;
    const position = positionAtProgress(plan.metric, progress);
    if (!position) return vehicle;
    return { ...vehicle, observationTimestamp: at, observationProgressMeters: progress, progressMetersAlongShape: progress, previousObservation: { at: observedAt, progress: observed }, speedMetersPerSecond: Math.max(pace, travelled), stoppedAtStop: false, longitude: position.coordinate[0], latitude: position.coordinate[1], lon: position.coordinate[0], lat: position.coordinate[1], bearing: position.bearing };
  }
  return vehicle;
}

/**
 * The freshest passing time naming this bus. The stop panels list a bus at every stop still ahead of
 * it and drop it once it leaves, with the metres it has left. Stops are queried at different times,
 * so the freshest reading decides (the nearest stop among equals: the most precise metres). A newer
 * GPS fix rules out stops it has already reached.
 */
function freshestReading(vehicle: NormalizedVehicle, gtfs: BizkaibusGtfs, plan: Plan, now: Date, peek: ArrivalPeek) {
  if (!vehicle.externalVehicleId) return null;
  const observedAt = vehicle.observationTimestamp, observed = vehicle.observationProgressMeters ?? vehicle.progressMetersAlongShape;
  let best: { stop: Plan['stops'][number]; at: number; floor: number; progress: number } | null = null;
  for (const stop of plan.stops) {
    const reading = peek(gtfs, stop.stopId, vehicle.externalVehicleId);
    if (reading?.distanceMeters == null) continue;
    const at = reading.sourceTimestamp;
    if (now.getTime() - at > OFFICIAL_STOP_MAX_AGE_MS || at - now.getTime() > 60_000 || (best && at <= best.at)) continue;
    const floor = observedAt === null ? -Infinity : observedAt > at ? observed : observed - AT_STOP_METERS;
    if (stop.progress < floor) continue;
    best = { stop, at, floor, progress: stop.progress - reading.distanceMeters };
  }
  return best;
}

/**
 * The stop the operator's passing times say a bus is heading to: the first one it has not passed
 * (at 0 minutes it is arriving or at the stop), and where they put it when queried. These bound the
 * drawn bus; they are not a position fix: readings of different stops disagree by a couple of hundred
 * metres, so as observations they made the bus run back and forth or race on an invented speed.
 */
export function officialNextStop(vehicle: NormalizedVehicle, gtfs: BizkaibusGtfs, plan: Plan, now: Date, peek: ArrivalPeek): { stopId: string; progress: number; sourceTimestamp: number; position: number } | null {
  const reading = freshestReading(vehicle, gtfs, plan, now, peek);
  if (!reading) return null;
  const position = Math.max(reading.progress - 10, reading.floor);
  const next = plan.stops.find((s) => s.progress >= position && s.progress <= reading.stop.progress);
  return next ? { stopId: next.stopId, progress: next.progress, sourceTimestamp: reading.at, position: Math.min(next.progress, Math.max(reading.progress, reading.floor)) } : null;
}
