/** Public package/API contracts. Timestamps are Unix milliseconds; coordinates are WGS84. */
export const CITY_PACKAGE_API_VERSION = 1 as const;
export type TransitMode = 'bus' | 'rail' | 'tram' | 'funicular' | 'unknown';
export type PositionQuality = 'live' | 'predicted' | 'scheduled';
export type PositionSource = 'GPS' | 'PROVIDER_ESTIMATED' | 'INTERPOLATED_REALTIME' | 'SCHEDULE_SIMULATION' | 'STALE';
export type VehicleKind = 'bus' | 'train' | 'metro' | 'tram' | 'funicular' | 'unknown';
export type VehicleAppearance = { kind: VehicleKind; composition: { count: number; length: number; gap: number }; lateralOffsetMeters: number };
export type ProviderCapabilities = {
  staticGtfs: boolean; vehiclePositions: boolean; tripUpdates: boolean;
  serviceAlerts: boolean; occupancy: boolean; speed: boolean; bearing: boolean;
  /** Stop-level arrival predictions, independently of GTFS-RT TripUpdates. */
  stopArrivals: boolean;
  /** False for topology-only feeds whose published schedule has expired. */
  scheduledService?: boolean;
};
export type ProviderDefinition = {
  id: string; name: string; color: string; realtime: boolean; group?: string;
  capabilities: ProviderCapabilities; layers?: { name: string; mode?: TransitMode }[]; primary?: boolean;
};
export type CityManifest = {
  id: string; countryCode: string; name: string; region: string; timezone: string;
  center: [number, number]; bounds: [[number, number], [number, number]];
  providers: ProviderDefinition[]; modes: TransitMode[]; apiVersion: typeof CITY_PACKAGE_API_VERSION;
  presentation: { title: string; mapLabel: string; searchLabel: string; initialZoom: number; brandMark: string };
};
/** Existing source-adapter format. External feed IDs are local to this adapter. */
export type AdapterVehicle = {
  id: string; operatorId: string; mode: TransitMode; tripId: string; routeId: string;
  directionId: number | null; shapeId: string; progressMetersAlongShape: number;
  latitude: number; longitude: number; bearing: number; positionQuality: PositionQuality;
  observationTimestamp: number | null; predictionTimestamp: number; receivedTimestamp?: number | null; serviceDate?: string;
  timetableTimestamp?: number | null; vehicleId?: string | null; speedMetersPerSecond?: number | null;
  maximumSpeedMetersPerSecond?: number; stoppedAtStop?: boolean; observationProgressMeters?: number | null;
  previousObservation?: { at: number; progress: number } | null; tripIdentityQuality?: 'exact' | 'estimated';
  positionSource?: 'gps' | 'trip-updates' | 'schedule'; delaySeconds: number | null;
  /** Native adapters supply supported anchors independently of a static timetable. */
  motionTimeline?: { at: number; progress: number }[];
  /** Provider arrival forecasts only; inferred approach/dwell anchors are excluded. */
  arrivalPredictions?: { at: number; progress: number; sourceTimestamp: number }[];
  destination?: string; nextStopId?: string;
};
export type AdapterSnapshot = {
  operatorId: string; fetchedAt: number; sourceTimestamp: number | null; receivedTimestamp?: number | null;
  vehicles: AdapterVehicle[]; status: 'ok' | 'degraded' | 'unavailable'; realtimeTripCount?: number; realtimeArrivalCount?: number; error?: string;
};
export interface SourceAdapter { readonly operatorId: string; getSnapshot(now?: Date): Promise<AdapterSnapshot>; }
/** IDs and references here are city/provider namespaced; external IDs are explicitly separate. */
export type NormalizedVehicle = Omit<AdapterVehicle, 'routeId' | 'tripId' | 'shapeId' | 'positionSource' | 'serviceDate' | 'receivedTimestamp' | 'destination' | 'nextStopId'> & {
  cityId: string; providerId: string; routeId: string; tripId: string; shapeId: string;
  externalRouteId: string; externalTripId: string; externalShapeId: string; externalVehicleId?: string | null; serviceDate: string;
  routeShortName: string; destination: string; lat: number; lon: number; speed?: number | null;
  sourceTimestamp: number | null; receivedTimestamp: number | null; nextStopId?: string | null; occupancy?: string | number | null;
  status: 'IN_SERVICE' | 'STOPPED' | 'STALE'; positionSource: PositionSource; appearance?: VehicleAppearance;
};
export type NormalizedRoute = {
  id: string; cityId: string; providerId: string; externalId: string; shortName: string; longName: string;
  mode: TransitMode; color: string; textColor: string; directions: { id: string; name: string }[]; appearance?: VehicleAppearance;
};
export type NormalizedStop = {
  id: string; cityId: string; providerId: string; externalId: string; name: string;
  longitude: number; latitude: number; modes: TransitMode[];
};
export type NormalizedTrip = {
  id: string; cityId: string; providerId: string; externalId: string; routeId: string; shapeId: string | null;
  serviceId: string; destination: string; directionId: number | null;
};
export type ProviderHealth = {
  cityId: string; providerId: string; state: 'healthy' | 'degraded' | 'stale' | 'unavailable';
  checkedTimestamp: number; sourceTimestamp: number | null; receivedTimestamp: number | null;
  lastSuccessTimestamp: number | null; error?: string;
};
export type NormalizedProviderSnapshot = Omit<AdapterSnapshot, 'vehicles' | 'sourceTimestamp' | 'receivedTimestamp'> & {
  cityId: string; providerId: string; sourceTimestamp: number | null; receivedTimestamp: number | null;
  vehicles: NormalizedVehicle[]; health: ProviderHealth; capabilities: ProviderCapabilities;
};
export interface TransitProvider {
  readonly cityId: string; readonly operatorId: string; readonly definition: ProviderDefinition; readonly health: ProviderHealth;
  enabled: boolean; getSnapshot(now?: Date): Promise<NormalizedProviderSnapshot>;
}
export interface CityPackage { readonly manifest: CityManifest; readonly providers: readonly TransitProvider[]; }
