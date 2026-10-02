import type { BizkaibusGtfs } from "../providers/bizkaibus/gtfs";
import { buildShapeMetric, positionAtProgress, projectOntoShape } from "./motionEngine";
import { formatServiceDate, getActiveTrips, parseGtfsTime, previousServiceDate, serviceSecondsAt } from "./gtfsCalendar";
import type { TransitVehicle } from "./types";

const metricCache = new Map<string, ReturnType<typeof buildShapeMetric>>();
const anchorCache = new Map<string, Array<{ seconds: number; progress: number }>>();

export function generateScheduledVehicles(gtfs: BizkaibusGtfs, now = new Date(), operatorId = "bizkaibus"): TransitVehicle[] {
  const today = formatServiceDate(now);
  const currentSeconds = serviceSecondsAt(now);
  const candidates = [
    { ...today, seconds: currentSeconds },
    { ...previousServiceDate(today.date), seconds: currentSeconds + 86_400 },
  ];
  const generated = new Map<string, TransitVehicle>();

  for (const serviceDay of candidates) {
    for (const trip of getActiveTrips(gtfs, serviceDay.date, serviceDay.weekday)) {
      if (!trip.shapeId) continue;
      const stops = gtfs.tripStops.get(trip.tripId) ?? [];
      if (stops.length < 2) continue;
      const first = parseGtfsTime(stops[0].departureTime) ?? parseGtfsTime(stops[0].arrivalTime);
      const last = parseGtfsTime(stops.at(-1)!.arrivalTime) ?? parseGtfsTime(stops.at(-1)!.departureTime);
      if (first === null || last === null || serviceDay.seconds < first || serviceDay.seconds > last) continue;
      const shape = gtfs.shapes.get(trip.shapeId);
      if (!shape || shape.length < 2) continue;
      let metric = metricCache.get(trip.shapeId);
      if (!metric) { metric = buildShapeMetric(shape); metricCache.set(trip.shapeId, metric); }

      let anchors = anchorCache.get(trip.tripId);
      if (!anchors) {
        anchors = [];
        for (const stopTime of stops) {
          const stop = gtfs.stops.get(stopTime.stopId);
          if (!stop) continue;
          const projected = projectOntoShape(metric, [stop.longitude, stop.latitude], anchors.at(-1)?.progress ?? 0);
          if (!projected || projected.distanceMeters >= 600) continue;
          const arrival = parseGtfsTime(stopTime.arrivalTime);
          const departure = parseGtfsTime(stopTime.departureTime);
          if (arrival !== null) anchors.push({ seconds: arrival, progress: projected.progressMeters });
          if (departure !== null && departure !== arrival) anchors.push({ seconds: departure, progress: projected.progressMeters });
        }
        anchors.sort((a, b) => a.seconds - b.seconds);
        anchorCache.set(trip.tripId, anchors);
      }
      if (anchors.length < 2 || serviceDay.seconds < anchors[0].seconds || serviceDay.seconds > anchors.at(-1)!.seconds) continue;

      let nextIndex = anchors.findIndex((anchor) => anchor.seconds >= serviceDay.seconds);
      if (nextIndex < 1) nextIndex = 1;
      const previous = anchors[nextIndex - 1];
      const next = anchors[nextIndex];
      const span = Math.max(1, next.seconds - previous.seconds);
      const fraction = Math.max(0, Math.min(1, (serviceDay.seconds - previous.seconds) / span));
      const progress = previous.progress + (next.progress - previous.progress) * fraction;
      const position = positionAtProgress(metric, progress);
      if (!position) continue;
      generated.set(trip.tripId, {
        id: `${operatorId}:${serviceDay.date}:${trip.tripId}`,
        operatorId,
        mode: gtfs.routes.get(trip.routeId)?.routeType === 0 ? "tram" : [1, 2, 4, 5, 6, 7].includes(gtfs.routes.get(trip.routeId)?.routeType ?? 3) ? "rail" : (gtfs.routes.has(trip.routeId) ? "bus" : "unknown"),
        tripId: trip.tripId,
        routeId: trip.routeId,
        directionId: trip.directionId,
        shapeId: trip.shapeId,
        progressMetersAlongShape: position.progressMeters,
        latitude: position.coordinate[1],
        longitude: position.coordinate[0],
        bearing: position.bearing,
        positionQuality: "scheduled",
        observationTimestamp: null,
        predictionTimestamp: now.getTime(),
        delaySeconds: null,
      });
    }
  }
  return [...generated.values()];
}
