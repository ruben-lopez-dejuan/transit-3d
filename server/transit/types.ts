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
  delaySeconds: number | null;
};

export type ProviderSnapshot = {
  operatorId: string;
  fetchedAt: number;
  sourceTimestamp: number | null;
  vehicles: TransitVehicle[];
  status: "ok" | "degraded" | "unavailable";
  error?: string;
};

export interface TransitProvider {
  readonly operatorId: string;
  getSnapshot(now?: Date): Promise<ProviderSnapshot>;
}
