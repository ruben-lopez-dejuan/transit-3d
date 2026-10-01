import type {
  BizkaibusGtfs,
  GtfsRoute,
  GtfsTrip,
} from "./gtfs";
import { getBizkaibusGtfs } from "./gtfs";
import { matchVehicleToTrip } from "./mapMatching";
import { getBizkaibusRealtime } from "./realtime";

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

export type BizkaibusSnapshot = {
  feedTimestamp: number | null;
  fetchedAtMs: number;
  entityCount: number;
  rawVehicleCount: number;
  validVehicleCount: number;
  rejectedVehicleCount: number;
  unmatchedTripCount: number;
  vehicles: LiveVehicle[];
  activeTripsByRoute: Map<string, Set<string>>;
};

let cache:
  | {
      realtimeFetchedAtMs: number;
      snapshot: BizkaibusSnapshot;
    }
  | null = null;

function findReferenceStop(
  gtfs: BizkaibusGtfs,
  trip: GtfsTrip,
  stopId: string | null,
  currentStopSequence: number | null,
) {
  if (stopId) {
    const direct = gtfs.stops.get(stopId);
    if (direct) return direct;
  }

  if (
    currentStopSequence === null ||
    !Number.isFinite(currentStopSequence)
  ) {
    return null;
  }

  const stopTimes = gtfs.tripStops.get(trip.tripId) ?? [];

  const exact = stopTimes.find(
    (item) => item.sequence === currentStopSequence,
  );

  if (exact) {
    return gtfs.stops.get(exact.stopId) ?? null;
  }

  let closest:
    | {
        stopId: string;
        difference: number;
      }
    | null = null;

  for (const item of stopTimes) {
    const difference = Math.abs(
      item.sequence - currentStopSequence,
    );

    if (!closest || difference < closest.difference) {
      closest = {
        stopId: item.stopId,
        difference,
      };
    }
  }

  return closest
    ? gtfs.stops.get(closest.stopId) ?? null
    : null;
}

export async function getBizkaibusSnapshot(): Promise<BizkaibusSnapshot> {
  const [gtfs, realtime] = await Promise.all([
    getBizkaibusGtfs(),
    getBizkaibusRealtime(),
  ]);

  if (
    cache &&
    cache.realtimeFetchedAtMs === realtime.fetchedAtMs
  ) {
    return cache.snapshot;
  }

  const vehicles: LiveVehicle[] = [];
  const activeTripsByRoute = new Map<string, Set<string>>();

  let unmatchedTripCount = 0;
  let rejectedVehicleCount = 0;

  for (const raw of realtime.vehicles) {
    if (!raw.tripId) {
      unmatchedTripCount++;
      continue;
    }

    const trip = gtfs.trips.get(raw.tripId);

    if (!trip) {
      unmatchedTripCount++;
      continue;
    }

    if (!activeTripsByRoute.has(trip.routeId)) {
      activeTripsByRoute.set(trip.routeId, new Set());
    }

    activeTripsByRoute.get(trip.routeId)!.add(trip.tripId);

    const route = gtfs.routes.get(trip.routeId);

    if (!route || !trip.shapeId) {
      rejectedVehicleCount++;
      continue;
    }

    const vehicleKey =
      raw.vehicleId ||
      raw.entityId ||
      `${raw.tripId}:${raw.rawLongitude}:${raw.rawLatitude}`;

    const matched = matchVehicleToTrip(
      gtfs,
      vehicleKey,
      raw.rawLongitude,
      raw.rawLatitude,
      trip,
      raw.timestamp,
      raw.stopId,
      raw.currentStopSequence,
    );

    if (!matched.valid) {
      rejectedVehicleCount++;
      continue;
    }

    const referenceStop = findReferenceStop(
      gtfs,
      trip,
      raw.stopId,
      raw.currentStopSequence,
    );

    vehicles.push({
      entityId: raw.entityId,
      vehicleId: raw.vehicleId,
      tripId: trip.tripId,
      routeId: trip.routeId,
      routeShortName: route.shortName,
      routeLongName: route.longName,
      routeColor: route.color,
      routeTextColor: route.textColor,
      headsign: trip.headsign,
      directionId: trip.directionId,
      shapeId: trip.shapeId,
      stopId: referenceStop?.stopId ?? raw.stopId,
      stopName: referenceStop?.name ?? null,
      longitude: matched.longitude,
      latitude: matched.latitude,
      bearing: matched.bearing,
      distanceToShapeMeters: matched.distanceMeters,
      timestamp: raw.timestamp,
    });
  }

  const snapshot: BizkaibusSnapshot = {
    feedTimestamp: realtime.feedTimestamp,
    fetchedAtMs: realtime.fetchedAtMs,
    entityCount: realtime.entityCount,
    rawVehicleCount: realtime.vehicles.length,
    validVehicleCount: vehicles.length,
    rejectedVehicleCount,
    unmatchedTripCount,
    vehicles,
    activeTripsByRoute,
  };

  cache = {
    realtimeFetchedAtMs: realtime.fetchedAtMs,
    snapshot,
  };

  return snapshot;
}

export async function getActiveRoutes() {
  const [gtfs, snapshot] = await Promise.all([
    getBizkaibusGtfs(),
    getBizkaibusSnapshot(),
  ]);

  const validCounts = new Map<string, number>();

  for (const vehicle of snapshot.vehicles) {
    validCounts.set(
      vehicle.routeId,
      (validCounts.get(vehicle.routeId) ?? 0) + 1,
    );
  }

  return [...snapshot.activeTripsByRoute.keys()]
    .map((routeId) => {
      const route = gtfs.routes.get(routeId);

      if (!route) return null;

      return {
        ...route,
        liveCount: validCounts.get(routeId) ?? 0,
        rawTripCount:
          snapshot.activeTripsByRoute.get(routeId)?.size ?? 0,
      };
    })
    .filter(
      (
        route,
      ): route is GtfsRoute & {
        liveCount: number;
        rawTripCount: number;
      } => route !== null,
    )
    .sort((a, b) =>
      a.shortName.localeCompare(
        b.shortName,
        "es",
        {
          numeric: true,
          sensitivity: "base",
        },
      ),
    );
}

export async function getActiveRouteData(routeId: string) {
  const [gtfs, snapshot] = await Promise.all([
    getBizkaibusGtfs(),
    getBizkaibusSnapshot(),
  ]);

  const route = gtfs.routes.get(routeId);

  if (!route) return null;

  const activeTripIds =
    snapshot.activeTripsByRoute.get(routeId) ??
    new Set<string>();

  const activeTrips = [...activeTripIds]
    .map((tripId) => gtfs.trips.get(tripId))
    .filter((trip): trip is GtfsTrip => Boolean(trip));

  const activeShapeIds = new Set(
    activeTrips
      .map((trip) => trip.shapeId)
      .filter((shapeId): shapeId is string => Boolean(shapeId)),
  );

  const shapeFeatures = [...activeShapeIds]
    .map((shapeId) => {
      const shape = gtfs.shapes.get(shapeId);

      if (!shape || shape.length < 2) {
        return null;
      }

      const representative = activeTrips.find(
        (trip) => trip.shapeId === shapeId,
      );

      return {
        type: "Feature" as const,
        properties: {
          shapeId,
          routeId,
          headsign: representative?.headsign ?? "",
        },
        geometry: {
          type: "LineString" as const,
          coordinates: shape.map(
            (point) => [
              point.longitude,
              point.latitude,
            ],
          ),
        },
      };
    })
    .filter((feature) => feature !== null);

  const stopMap = new Map<
    string,
    {
      stopId: string;
      stopCode: string;
      name: string;
      longitude: number;
      latitude: number;
      headsigns: Set<string>;
    }
  >();

  for (const trip of activeTrips) {
    const stopTimes =
      gtfs.tripStops.get(trip.tripId) ?? [];

    for (const item of stopTimes) {
      const stop = gtfs.stops.get(item.stopId);
      if (!stop) continue;

      if (!stopMap.has(stop.stopId)) {
        stopMap.set(stop.stopId, {
          stopId: stop.stopId,
          stopCode: stop.stopCode,
          name: stop.name,
          longitude: stop.longitude,
          latitude: stop.latitude,
          headsigns: new Set(),
        });
      }

      if (trip.headsign) {
        stopMap.get(stop.stopId)!.headsigns.add(
          trip.headsign,
        );
      }
    }
  }

  const stopFeatures = [...stopMap.values()].map(
    (stop) => ({
      type: "Feature" as const,
      properties: {
        stopId: stop.stopId,
        stopCode: stop.stopCode,
        name: stop.name,
        routeShortName: route.shortName,
        headsigns: [...stop.headsigns].join(" · "),
      },
      geometry: {
        type: "Point" as const,
        coordinates: [
          stop.longitude,
          stop.latitude,
        ],
      },
    }),
  );

  return {
    route,
    activeTripCount: activeTrips.length,
    activeShapeCount: shapeFeatures.length,
    stopCount: stopFeatures.length,
    shapes: {
      type: "FeatureCollection" as const,
      features: shapeFeatures,
    },
    stops: {
      type: "FeatureCollection" as const,
      features: stopFeatures,
    },
  };
}
