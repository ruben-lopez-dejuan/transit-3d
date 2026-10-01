import {
  MAX_MAP_MATCH_DISTANCE_METERS,
  STOP_WINDOW_MARGIN_METERS,
} from "./config";
import type {
  BizkaibusGtfs,
  GtfsShapePoint,
  GtfsTrip,
} from "./gtfs";

type Coordinate = [number, number];

type ShapeMetric = {
  coordinates: Coordinate[];
  cumulative: number[];
};

type StopAnchor = {
  stopId: string;
  sequence: number;
  progressMeters: number;
};

export type MatchResult =
  | {
      valid: true;
      longitude: number;
      latitude: number;
      bearing: number;
      distanceMeters: number;
      progressMeters: number;
    }
  | {
      valid: false;
      reason: "no-shape" | "no-candidate" | "too-far";
      distanceMeters: number | null;
    };

const metricCache = new Map<string, ShapeMetric>();
const tripAnchorCache = new Map<string, StopAnchor[]>();

const matchHistory = new Map<
  string,
  {
    shapeId: string;
    progressMeters: number;
    timestamp: number;
  }
>();

function pointToCoordinate(point: GtfsShapePoint): Coordinate {
  return [point.longitude, point.latitude];
}

function metersBetween(a: Coordinate, b: Coordinate) {
  const meanLatitude = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(meanLatitude);
  const dy = (b[1] - a[1]) * 110_540;

  return Math.hypot(dx, dy);
}

function bearingDegrees(a: Coordinate, b: Coordinate) {
  const lon1 = a[0] * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lon2 = b[0] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const dLon = lon2 - lon1;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function buildMetric(
  shapeId: string,
  points: GtfsShapePoint[],
): ShapeMetric {
  const cached = metricCache.get(shapeId);
  if (cached) return cached;

  const coordinates = points.map(pointToCoordinate);
  const cumulative = [0];

  for (let index = 1; index < coordinates.length; index++) {
    cumulative.push(
      cumulative[index - 1] +
      metersBetween(coordinates[index - 1], coordinates[index]),
    );
  }

  const metric = {
    coordinates,
    cumulative,
  };

  metricCache.set(shapeId, metric);
  return metric;
}

function projectToSegment(
  longitude: number,
  latitude: number,
  a: Coordinate,
  b: Coordinate,
) {
  const latitudeRadians = latitude * Math.PI / 180;
  const metersPerLongitudeDegree =
    111_320 * Math.cos(latitudeRadians);
  const metersPerLatitudeDegree = 110_540;

  const ax = (a[0] - longitude) * metersPerLongitudeDegree;
  const ay = (a[1] - latitude) * metersPerLatitudeDegree;
  const bx = (b[0] - longitude) * metersPerLongitudeDegree;
  const by = (b[1] - latitude) * metersPerLatitudeDegree;

  const vx = bx - ax;
  const vy = by - ay;
  const lengthSquared = vx * vx + vy * vy;

  const t =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(
            1,
            -(ax * vx + ay * vy) / lengthSquared,
          ),
        )
      : 0;

  const px = ax + t * vx;
  const py = ay + t * vy;

  return {
    t,
    distanceMeters: Math.hypot(px, py),
    longitude:
      longitude + px / metersPerLongitudeDegree,
    latitude:
      latitude + py / metersPerLatitudeDegree,
  };
}

function projectStopToShape(
  longitude: number,
  latitude: number,
  metric: ShapeMetric,
  minimumProgressMeters: number,
) {
  let best:
    | {
        progressMeters: number;
        distanceMeters: number;
      }
    | undefined;

  for (
    let index = 0;
    index < metric.coordinates.length - 1;
    index++
  ) {
    const a = metric.coordinates[index];
    const b = metric.coordinates[index + 1];

    const segmentStart = metric.cumulative[index];
    const segmentMeters = metersBetween(a, b);

    if (
      segmentStart + segmentMeters <
      minimumProgressMeters - 120
    ) {
      continue;
    }

    const projected = projectToSegment(
      longitude,
      latitude,
      a,
      b,
    );

    const progressMeters =
      segmentStart + projected.t * segmentMeters;

    if (progressMeters < minimumProgressMeters - 120) {
      continue;
    }

    if (
      !best ||
      projected.distanceMeters < best.distanceMeters
    ) {
      best = {
        progressMeters,
        distanceMeters: projected.distanceMeters,
      };
    }
  }

  return best;
}

function getTripAnchors(
  gtfs: BizkaibusGtfs,
  trip: GtfsTrip,
): StopAnchor[] {
  const cached = tripAnchorCache.get(trip.tripId);
  if (cached) return cached;

  if (!trip.shapeId) {
    tripAnchorCache.set(trip.tripId, []);
    return [];
  }

  const shape = gtfs.shapes.get(trip.shapeId);
  const stopTimes = gtfs.tripStops.get(trip.tripId) ?? [];

  if (!shape || shape.length < 2 || stopTimes.length === 0) {
    tripAnchorCache.set(trip.tripId, []);
    return [];
  }

  const metric = buildMetric(trip.shapeId, shape);
  const anchors: StopAnchor[] = [];
  let minimumProgressMeters = 0;

  for (const item of stopTimes) {
    const stop = gtfs.stops.get(item.stopId);
    if (!stop) continue;

    const projected = projectStopToShape(
      stop.longitude,
      stop.latitude,
      metric,
      minimumProgressMeters,
    );

    if (!projected) continue;

    minimumProgressMeters = Math.max(
      minimumProgressMeters,
      projected.progressMeters,
    );

    anchors.push({
      stopId: item.stopId,
      sequence: item.sequence,
      progressMeters: projected.progressMeters,
    });
  }

  tripAnchorCache.set(trip.tripId, anchors);
  return anchors;
}

function getProgressWindow(
  gtfs: BizkaibusGtfs,
  trip: GtfsTrip,
  stopId: string | null,
  currentStopSequence: number | null,
) {
  const anchors = getTripAnchors(gtfs, trip);
  if (anchors.length === 0) return null;

  let index = -1;

  if (stopId) {
    index = anchors.findIndex(
      (anchor) => anchor.stopId === stopId,
    );
  }

  if (
    index < 0 &&
    currentStopSequence !== null &&
    Number.isFinite(currentStopSequence)
  ) {
    index = anchors.findIndex(
      (anchor) =>
        anchor.sequence === currentStopSequence,
    );

    if (index < 0) {
      let bestDelta = Number.POSITIVE_INFINITY;

      for (let candidate = 0; candidate < anchors.length; candidate++) {
        const delta = Math.abs(
          anchors[candidate].sequence - currentStopSequence,
        );

        if (delta < bestDelta) {
          bestDelta = delta;
          index = candidate;
        }
      }
    }
  }

  if (index < 0) return null;

  const previous = anchors[Math.max(0, index - 1)];
  const next =
    anchors[Math.min(anchors.length - 1, index + 1)];

  return {
    min: Math.max(
      0,
      previous.progressMeters - STOP_WINDOW_MARGIN_METERS,
    ),
    max:
      next.progressMeters + STOP_WINDOW_MARGIN_METERS,
  };
}

export function matchVehicleToTrip(
  gtfs: BizkaibusGtfs,
  vehicleKey: string,
  rawLongitude: number,
  rawLatitude: number,
  trip: GtfsTrip,
  timestamp: number | null,
  stopId: string | null,
  currentStopSequence: number | null,
): MatchResult {
  if (!trip.shapeId) {
    return {
      valid: false,
      reason: "no-shape",
      distanceMeters: null,
    };
  }

  const shape = gtfs.shapes.get(trip.shapeId);

  if (!shape || shape.length < 2) {
    return {
      valid: false,
      reason: "no-shape",
      distanceMeters: null,
    };
  }

  const metric = buildMetric(trip.shapeId, shape);

  const progressWindow = getProgressWindow(
    gtfs,
    trip,
    stopId,
    currentStopSequence,
  );

  const previous = matchHistory.get(vehicleKey);

  const candidates: Array<{
    longitude: number;
    latitude: number;
    distanceMeters: number;
    progressMeters: number;
    bearing: number;
    score: number;
  }> = [];

  for (
    let index = 0;
    index < metric.coordinates.length - 1;
    index++
  ) {
    const a = metric.coordinates[index];
    const b = metric.coordinates[index + 1];

    const segmentStart = metric.cumulative[index];
    const segmentMeters = metersBetween(a, b);

    const projected = projectToSegment(
      rawLongitude,
      rawLatitude,
      a,
      b,
    );

    const progressMeters =
      segmentStart + projected.t * segmentMeters;

    if (
      progressWindow &&
      (
        progressMeters < progressWindow.min ||
        progressMeters > progressWindow.max
      )
    ) {
      continue;
    }

    let score = projected.distanceMeters;

    if (
      previous &&
      previous.shapeId === trip.shapeId
    ) {
      const delta =
        progressMeters - previous.progressMeters;

      const elapsedSeconds = Math.max(
        1,
        (timestamp ?? previous.timestamp) -
          previous.timestamp,
      );

      if (delta < -60) {
        score += 700 + Math.abs(delta) * 1.5;
      }

      const plausibleForwardMeters = Math.max(
        250,
        elapsedSeconds * 30 + 120,
      );

      if (delta > plausibleForwardMeters) {
        score +=
          500 +
          (delta - plausibleForwardMeters) * 0.9;
      }
    }

    candidates.push({
      longitude: projected.longitude,
      latitude: projected.latitude,
      distanceMeters: projected.distanceMeters,
      progressMeters,
      bearing: bearingDegrees(a, b),
      score,
    });
  }

  if (candidates.length === 0) {
    return {
      valid: false,
      reason: "no-candidate",
      distanceMeters: null,
    };
  }

  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];

  if (
    best.distanceMeters >
    MAX_MAP_MATCH_DISTANCE_METERS
  ) {
    return {
      valid: false,
      reason: "too-far",
      distanceMeters: best.distanceMeters,
    };
  }

  matchHistory.set(vehicleKey, {
    shapeId: trip.shapeId,
    progressMeters: best.progressMeters,
    timestamp: timestamp ?? 0,
  });

  return {
    valid: true,
    longitude: best.longitude,
    latitude: best.latitude,
    bearing: best.bearing,
    distanceMeters: best.distanceMeters,
    progressMeters: best.progressMeters,
  };
}
