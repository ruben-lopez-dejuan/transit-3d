export type TransitMode = "bus" | "rail" | "tram" | "unknown";
export type PositionQuality = "live" | "predicted" | "scheduled";

export type TransitVehicle = {
  id: string;
  operatorId: string;
  mode: TransitMode;
  tripId: string;
  routeId: string;
  directionId: number | null;
  shapeId: string;
  progressMetersAlongShape: number;
  latitude: number;
  longitude: number;
  bearing: number;
  positionQuality: PositionQuality;
  observationTimestamp: number | null;
  predictionTimestamp: number;
  timetableTimestamp?: number | null;
  vehicleId?: string | null;
  speedMetersPerSecond?: number | null;
  observationProgressMeters?: number | null;
  previousObservation?: { at: number; progress: number } | null;
  tripIdentityQuality?: 'exact' | 'estimated';
  positionSource?: 'gps' | 'trip-updates' | 'schedule';
  delaySeconds: number | null;
};

export type ProviderSnapshot = {
  operatorId: string;
  fetchedAt: number;
  sourceTimestamp: number | null;
  vehicles: TransitVehicle[];
  status: "ok" | "degraded" | "unavailable";
  realtimeTripCount?: number;
  error?: string;
};

export interface TransitProvider {
  readonly operatorId: string;
  getSnapshot(now?: Date): Promise<ProviderSnapshot>;
}
