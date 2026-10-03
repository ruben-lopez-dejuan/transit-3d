import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import { buildShapeMetric, projectOntoShape } from './motionEngine';

/** Opt-in preparation: copy reversed shapes per trip, retaining the published geometry. */
export function orientTripShapes(gtfs: BizkaibusGtfs) {
  const decisions = new Map<string, { shapeId: string; reverse: boolean }>();
  const metrics = new Map([...gtfs.shapes].map(([id, points]) => [id, buildShapeMetric(points)]));
  let reversedTrips = 0;
  for (const trip of gtfs.trips.values()) {
    if (!trip.shapeId) continue;
    const times = gtfs.tripStops.get(trip.tripId) ?? [];
    const stopIds = times.map((s) => s.stopId), key = JSON.stringify([trip.shapeId, stopIds]);
    let decision = decisions.get(key);
    if (!decision) {
      const metric = metrics.get(trip.shapeId);
      const stops = stopIds.map((id) => gtfs.stops.get(id));
      if (!metric || stops.length < 2 || stops.some((s) => !s)) continue;
      const projections = stops.map((s) => projectOntoShape(metric, [s!.longitude, s!.latitude]));
      const first = projections[0], last = projections.at(-1);
      const decreasing = projections.slice(1).filter((p, i) => p && projections[i] && p.progressMeters < projections[i]!.progressMeters - 10).length;
      const reverse = !!first && !!last && last.progressMeters < first.progressMeters - 50 && decreasing >= (projections.length - 1) * .6;
      const shapeId = reverse ? `${trip.shapeId}:runtime-reverse` : trip.shapeId;
      if (reverse && !gtfs.shapes.has(shapeId)) gtfs.shapes.set(shapeId, [...gtfs.shapes.get(trip.shapeId)!].reverse().map((p, sequence) => ({ ...p, sequence })));
      decision = { shapeId, reverse }; decisions.set(key, decision);
    }
    trip.shapeId = decision.shapeId;
    if (decision.reverse) reversedTrips++;
    if (trip.directionId === null && stopIds.length >= 2) trip.directionId = stopIds[0].localeCompare(stopIds.at(-1)!) <= 0 ? 0 : 1;
  }
  return { reversedTrips, derivedShapes: [...gtfs.shapes.keys()].filter((s) => s.endsWith(':runtime-reverse')).length };
}
