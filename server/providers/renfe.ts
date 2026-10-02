import type { BizkaibusGtfs } from './bizkaibus/gtfs';
import { buildShapeMetric, projectOntoShape } from '../transit/motionEngine';
import { StaticGtfsProvider } from './staticGtfs';

export const RENFE_GTFS_URL = 'https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip';

/** The national feed reuses C1/C2 labels across cities. Only Bilbao nucleus 60 is selected. */
export function prepareRenfeBilbao(gtfs: BizkaibusGtfs) {
  const usedStops = new Set<string>(), usedShapes = new Set<string>();
  gtfs.routeTripIds.clear();
  for (const trip of gtfs.trips.values()) {
    const times = gtfs.tripStops.get(trip.tripId) ?? [];
    const stops = times.map((t) => gtfs.stops.get(t.stopId));
    // Some national routes under nucleus 60 describe León/Guardo. Check the actual stations.
    if (!trip.routeId.startsWith('60T') || !stops.some((s) => s && s.latitude >= 42.95 && s.latitude <= 43.5 && s.longitude >= -3.65 && s.longitude <= -2.7)) {
      gtfs.trips.delete(trip.tripId); gtfs.tripStops.delete(trip.tripId); continue;
    }
    const route = gtfs.routes.get(trip.routeId)!;
    route.longName = route.longName.replace(/\s+/g, ' ');
    trip.headsign ||= stops.at(-1)?.name ?? route.longName;
    const points = trip.shapeId ? gtfs.shapes.get(trip.shapeId) : null;
    if (points && points.length >= 2) {
      const metric = buildShapeMetric(points);
      const projections = stops.map((s) => s ? projectOntoShape(metric, [s.longitude, s.latitude]) : null);
      const first = projections[0], last = projections.at(-1);
      // The published C1/C2/C4/C5 shapes run opposite to their trip's stop order.
      if (first && last && last.progressMeters < first.progressMeters) {
        const reversed = `${trip.shapeId}:reverse`;
        if (!gtfs.shapes.has(reversed)) gtfs.shapes.set(reversed, [...points].reverse().map((p, sequence) => ({ ...p, sequence })));
        trip.shapeId = reversed;
      }
      trip.directionId = first && last && last.progressMeters < first.progressMeters ? 1 : 0;
      // Through services may reference a shape covering only part of their route.
      // Keep their station timetables, but do not animate an incomplete railway path.
      if (projections.some((p) => !p || p.distanceMeters >= 600)) trip.shapeId = null;
    }
    if (trip.shapeId) usedShapes.add(trip.shapeId);
    times.forEach((s) => usedStops.add(s.stopId));
    if (!gtfs.routeTripIds.has(trip.routeId)) gtfs.routeTripIds.set(trip.routeId, []);
    gtfs.routeTripIds.get(trip.routeId)!.push(trip.tripId);
  }
  for (const id of gtfs.routes.keys()) if (!gtfs.routeTripIds.has(id)) gtfs.routes.delete(id);
  for (const id of gtfs.stops.keys()) if (!usedStops.has(id)) gtfs.stops.delete(id);
  for (const id of gtfs.shapes.keys()) if (!usedShapes.has(id)) gtfs.shapes.delete(id);
}

export const renfeProvider = new StaticGtfsProvider('renfe', RENFE_GTFS_URL, {
  includeRoute: (route) => route.routeId.startsWith('60T'), prepare: prepareRenfeBilbao,
});
