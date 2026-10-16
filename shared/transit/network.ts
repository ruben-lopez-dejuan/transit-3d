import type { NormalizedVehicle, NormalizedRoute, NormalizedStop, NormalizedTrip, NormalizedProviderSnapshot, ProviderDefinition, TransitMode, PositionQuality, CityManifest } from './contracts';
export type { TransitMode, PositionQuality };
export type Operator = ProviderDefinition & { status: 'ok' | 'degraded' | 'unavailable'; loading?: boolean };
// Compatibility names are retained in the UI payload. key === id; routeId/stopId are external API lookup IDs.
export type Route = NormalizedRoute & { key: string; operatorId: string; routeId: string };
export type Stop = NormalizedStop & { key: string; operatorId: string; stopId: string };
export type Place = { id: string; name: string; longitude: number; latitude: number };
export type Network = { city: CityManifest; operators: Operator[]; routes: Route[]; stops: Stop[]; places: Place[] };
export type MotionAnchor = { at: number; progress: number };
/** Which source drives a vehicle's upcoming stop times, in precedence order after GPS. */
export type TimelineSource = 'siri' | 'gtfs-rt' | 'provider' | 'gps-schedule' | 'schedule';
export type Vehicle = NormalizedVehicle & { routeKey: string; shapeKey: string; label: string; headsign: string; color: string; operatorName: string; timeline: MotionAnchor[];
  /** The timetable was shifted to pass through the GPS fix: its pace is commercial speed, not a schedule to catch up with. */
  gpsAnchoredTimeline?: boolean; timelineSource?: TimelineSource; nextStop: { key: string; name: string; at: number } | null; delayEstimated: boolean;
  /**
   * The stop the operator's passing times say the bus has not reached yet (Bizkaibus), and where
   * they put it when queried (`position`): the bus is drawn between the two.
   */
  officialNextStop?: { key: string; progress: number; sourceTimestamp: number; position: number } | null };
export type Snapshot = { cityId: string; fetchedAt: number; serverTime?: number; vehicles: Vehicle[]; providers: Omit<NormalizedProviderSnapshot, 'vehicles'>[] };
/**
 * underground: stretches in tunnel, in metres along the shape. tunnelBeforeStart/tunnelAfterEnd:
 * the tunnel goes on past that end of the shape (an underground terminus), so there is no portal there.
 * onTrack: stretches drawn on the vehicle's own track (matched onto OSM tracks): no lateral offset there.
 */
export type Shape = { key: string; coordinates: [number, number][]; cumulative: number[]; total: number; underground?: { from: number; to: number; depthMeters: number; approximate: boolean; tunnelBeforeStart?: boolean; tunnelAfterEnd?: boolean }[]; onTrack?: { from: number; to: number }[] };
export type Departure = { routeKey: string; tripId: string; label: string; headsign: string; operatorId: string; at: number; quality: PositionQuality; delaySeconds: number | null; scheduledAt?: number; updatedAt?: number | null; source?: 'realtime' | 'gps' | 'schedule'; canceled?: boolean; directionId?: number | null; vehicleId?: string };
export type LineDetail = { route: Route; shapes: Shape[]; stops: Stop[]; departures: Departure[] };
export type StopDetail = { stop: Stop; nearbyStops: Stop[]; departures: Departure[] };
export type TripDetail = { vehicleId: string; trip: NormalizedTrip; stops: (Stop & { at: number | null; progress: number; skipped?: boolean; realtime?: boolean; source?: 'siri' | 'realtime' | 'gps' | 'schedule' })[]; shape: Shape | null };
