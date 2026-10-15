import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import type { NormalizedVehicle } from '../../shared/transit/contracts';
import type { StopArrivalsAdapter } from './cityPackage';
import type { tripPlan } from './plans';
import { positionAtProgress } from './motionEngine';
import { freshTimestamp } from './realtime';

type ArrivalPeek = StopArrivalsAdapter['peek'];
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
    if (at <= observedAt || freshTimestamp(at / 1000, now.getTime()) === null) return vehicle;
    const progress = Math.max(observed, stop.progress - reading.distanceMeters);
    const pace = vehicle.speedMetersPerSecond ?? 0, travelled = (progress - observed) * 1000 / (at - observedAt);
    if (progress - (observed + pace * (at - observedAt) / 1000) < OFFICIAL_LEAD_METERS || travelled > 40) return vehicle;
    const position = positionAtProgress(plan.metric, progress);
    if (!position) return vehicle;
    return { ...vehicle, observationTimestamp: at, observationProgressMeters: progress, progressMetersAlongShape: progress, previousObservation: { at: observedAt, progress: observed }, speedMetersPerSecond: Math.max(pace, travelled), stoppedAtStop: false, longitude: position.coordinate[0], latitude: position.coordinate[1], lon: position.coordinate[0], lat: position.coordinate[1], bearing: position.bearing };
  }
  return vehicle;
}

