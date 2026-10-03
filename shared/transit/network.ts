import type { NormalizedVehicle, NormalizedRoute, NormalizedStop, NormalizedTrip, NormalizedProviderSnapshot, ProviderDefinition, TransitMode, PositionQuality, CityManifest } from './contracts';
export type { TransitMode, PositionQuality };
export type Operator = ProviderDefinition & { status: 'ok' | 'degraded' | 'unavailable' };
// Compatibility names are retained in the UI payload. key === id; routeId/stopId are external API lookup IDs.
export type Route = NormalizedRoute & { key: string; operatorId: string; routeId: string };
export type Stop = NormalizedStop & { key: string; operatorId: string; stopId: string };
export type Place = { id: string; name: string; longitude: number; latitude: number };
export type Network = { city: CityManifest; operators: Operator[]; routes: Route[]; stops: Stop[]; places: Place[] };
export type MotionAnchor = { at: number; progress: number };
export type Vehicle = NormalizedVehicle & { routeKey: string; shapeKey: string; label: string; headsign: string; color: string; operatorName: string; timeline: MotionAnchor[]; nextStop: { key: string; name: string; at: number } | null; delayEstimated: boolean };
export type Snapshot = { cityId: string; fetchedAt: number; serverTime?: number; vehicles: Vehicle[]; providers: Omit<NormalizedProviderSnapshot, 'vehicles'>[] };
export type Shape = { key: string; coordinates: [number, number][]; cumulative: number[]; total: number; underground?: { from: number; to: number; depthMeters: number; approximate: boolean }[] };
export type Departure = { routeKey: string; tripId: string; label: string; headsign: string; operatorId: string; at: number; quality: PositionQuality; delaySeconds: number | null; scheduledAt?: number; updatedAt?: number | null; source?: 'realtime' | 'gps' | 'schedule'; canceled?: boolean; directionId?: number | null; vehicleId?: string };
export type LineDetail = { route: Route; shapes: Shape[]; stops: Stop[]; departures: Departure[] };
export type StopDetail = { stop: Stop; nearbyStops: Stop[]; departures: Departure[] };
export type TripDetail = { vehicleId: string; trip: NormalizedTrip; stops: (Stop & { at: number | null; progress: number; skipped?: boolean; realtime?: boolean })[]; shape: Shape | null };
