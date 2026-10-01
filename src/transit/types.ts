export type TransitRoute = {
  routeId: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
  liveCount: number;
  rawTripCount: number;
};

export type LiveVehicle = {
  entityId: string;
  vehicleId: string | null;
  tripId: string;
  routeId: string;
  routeShortName: string;
  routeLongName: string;
  routeColor: string;
  routeTextColor: string;
  headsign: string;
  directionId: number | null;
  shapeId: string;
  stopId: string | null;
  stopName: string | null;
  longitude: number;
  latitude: number;
  bearing: number;
  distanceToShapeMeters: number;
  timestamp: number | null;
};

export type RouteListResponse = {
  feedTimestamp: number | null;
  routes: TransitRoute[];
};

export type VehiclesResponse = {
  feedTimestamp: number | null;
  fetchedAtMs: number;
  vehicleCount: number;
  totalValidVehicleCount: number;
  rawVehicleCount: number;
  rejectedVehicleCount: number;
  unmatchedTripCount: number;
  vehicles: LiveVehicle[];
};

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, string | number | null>;
    geometry:
      | {
          type: "Point";
          coordinates: [number, number];
        }
      | {
          type: "LineString";
          coordinates: [number, number][];
        };
  }>;
};

export type ActiveRouteResponse = {
  route: Omit<
    TransitRoute,
    "liveCount" | "rawTripCount"
  >;
  activeTripCount: number;
  activeShapeCount: number;
  stopCount: number;
  shapes: GeoJsonFeatureCollection;
  stops: GeoJsonFeatureCollection;
};
