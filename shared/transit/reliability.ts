import type { ProviderCapabilities } from './contracts';
import type { Departure, Vehicle } from './network';
import { isFresh } from './freshness';

/**
 * Reliability is what the public map shows: how much a position or an arrival
 * time can be trusted, independently of how it was computed. The technical
 * classification below (feed kind, position basis, timing basis) is kept for
 * the admin console and for deciding that level.
 */
export type ReliabilityLevel = 'high' | 'medium' | 'low';

/** How a provider feeds data into the map, from strongest to weakest. */
export type FeedKind = 'vehicle-positions' | 'arrival-predictions' | 'schedule-only';

/** What places a vehicle on the map. */
export type PositionBasis =
  /** A physical location fix published by the vehicle (GPS, AVL). */
  | 'gps'
  /** Live arrival predictions per stop or station, without a location fix (Metro Bilbao). */
  | 'realtime-arrivals'
  /** An operator estimate of positions (arrival boards in minutes, Metro Madrid). */
  | 'operator-estimate'
  /** The static timetable alone. */
  | 'schedule';

/** What sets an arrival time. */
export type ArrivalBasis = 'realtime' | 'gps-shifted' | 'schedule';

export type VehicleReliability = { level: ReliabilityLevel; basis: PositionBasis; ageMs: number | null; identityEstimated: boolean };
export type ArrivalReliability = { level: ReliabilityLevel; basis: ArrivalBasis };

export function feedKind(capabilities: Pick<ProviderCapabilities, 'vehiclePositions' | 'tripUpdates' | 'stopArrivals'>): FeedKind {
  return capabilities.vehiclePositions ? 'vehicle-positions' : capabilities.tripUpdates || capabilities.stopArrivals ? 'arrival-predictions' : 'schedule-only';
}

type ReliabilityInput = Pick<Vehicle, 'observationTimestamp' | 'timetableTimestamp' | 'sourceTimestamp' | 'positionQuality' | 'positionSource' | 'timelineSource' | 'tripIdentityQuality'>;

export function positionBasis(vehicle: ReliabilityInput): PositionBasis {
  if (vehicle.observationTimestamp !== null) return 'gps';
  if (vehicle.positionQuality === 'scheduled' || vehicle.positionSource === 'SCHEDULE_SIMULATION') return 'schedule';
  if (vehicle.timelineSource === 'provider') return 'operator-estimate';
  return 'realtime-arrivals';
}

/**
 * A fresh GPS fix or fresh live arrival predictions are both trusted: Metro
 * predictions are timed by the signalling to the second. A GPS bus whose service
 * we had to deduce (Bilbobus publishes no trip) is still exactly where its GPS
 * says; only its timetable is uncertain, which the arrival level covers. An
 * operator position estimate is approximate. The timetable and any expired
 * realtime are not trusted. Freshness uses the same 270 s limit as
 * the rest of the pipeline, so the level never flaps on each publication cycle.
 */
export function vehicleReliability(vehicle: ReliabilityInput, now: number): VehicleReliability {
  const basis = positionBasis(vehicle);
  const timestamp = basis === 'gps' ? vehicle.observationTimestamp : basis === 'schedule' ? null : vehicle.timetableTimestamp ?? vehicle.sourceTimestamp;
  const ageMs = timestamp != null ? Math.max(0, now - timestamp) : null;
  const identityEstimated = vehicle.tripIdentityQuality === 'estimated';
  const stale = vehicle.positionSource === 'STALE' || (timestamp != null && !isFresh(timestamp, now));
  const level: ReliabilityLevel = basis === 'schedule' || stale ? 'low' : basis === 'operator-estimate' ? 'medium' : 'high';
  return { level, basis, ageMs, identityEstimated };
}

/** Departures and stop times: an operator prediction, the timetable shifted by the GPS delay, or the timetable. */
export function arrivalReliability(source: Departure['source'] | 'siri' | undefined, updatedAt: number | null | undefined, now: number): ArrivalReliability {
  const expired = !!updatedAt && !isFresh(updatedAt, now);
  if (!expired && (source === 'realtime' || source === 'siri')) return { level: 'high', basis: 'realtime' };
  if (!expired && source === 'gps') return { level: 'medium', basis: 'gps-shifted' };
  return { level: 'low', basis: 'schedule' };
}

/** Public wording. Technical sources (GPS feeds, SIRI, GTFS-RT) are named only in the admin console. */
export const RELIABILITY_LABELS: Record<ReliabilityLevel, string> = { high: 'Tiempo real', medium: 'Aproximado', low: 'Horario' };
