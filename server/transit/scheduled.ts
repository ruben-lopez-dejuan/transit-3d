import type { BizkaibusGtfs } from "../providers/bizkaibus/gtfs";
import { positionAtProgress } from "./motionEngine";
import { tripPlan, modeFor, serviceEpoch } from "./plans";
import { formatServiceDate, getActiveTrips, parseGtfsTime, previousServiceDate } from "./gtfsCalendar";
import type { TransitVehicle } from "./types";

export function generateScheduledVehicles(gtfs: BizkaibusGtfs, now = new Date(), operatorId = "bizkaibus"): TransitVehicle[] {
  const today = formatServiceDate(now);
  const candidates = [today, previousServiceDate(today.date)].map((day) => ({ ...day, seconds: (now.getTime() - serviceEpoch(day.date, 0)) / 1000 }));
  const generated = new Map<string, TransitVehicle>();

  for (const serviceDay of candidates) {
    for (const trip of getActiveTrips(gtfs, serviceDay.date, serviceDay.weekday)) {
      if (!trip.shapeId) continue;
      const stops = gtfs.tripStops.get(trip.tripId) ?? [];
      if (stops.length < 2) continue;
      const first = parseGtfsTime(stops[0].departureTime) ?? parseGtfsTime(stops[0].arrivalTime);
      const last = parseGtfsTime(stops.at(-1)!.arrivalTime) ?? parseGtfsTime(stops.at(-1)!.departureTime);
      if (first === null || last === null || serviceDay.seconds < first || serviceDay.seconds > last) continue;
      const plan = tripPlan(gtfs, trip.tripId);
      if (!plan) continue;
      const { metric, anchors } = plan;
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
        mode: modeFor(gtfs.routes.get(trip.routeId)?.routeType ?? -1),
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
