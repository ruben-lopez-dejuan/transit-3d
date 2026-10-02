import assert from 'node:assert/strict';
import { parseGtfsDirectory } from './providers/bizkaibus/gtfs';
import { infrastructureFor } from './cities/es-bilbao/infrastructure';
import { shapeMetric } from './transit/plans';

/** Focused offline audit of cached GTFS shapes. No server, feeds, browser or polling. */
const gtfs = parseGtfsDirectory(process.argv[2] ?? 'server/cache/euskotren');
const summary = [];
for (const route of gtfs.routes.values()) {
  const trips = [...gtfs.trips.values()].filter((trip) => trip.routeId === route.routeId);
  const shapes = [...new Set(trips.flatMap((trip) => trip.shapeId ? [trip.shapeId] : []))];
  let matches = 0, sections = 0, maximumTunnelMeters = 0;
  const directions = new Set<number | null>();
  for (const shapeId of shapes) {
    const ranges = infrastructureFor(gtfs, 'euskotren', shapeId) ?? [];
    const total = shapeMetric(gtfs, shapeId)?.totalMeters ?? 0;
    assert.ok(ranges.every((range, i) => range.from >= 0 && range.to > range.from && range.to <= total + .001 && (i === 0 || range.from >= ranges[i - 1].to)));
    if (ranges.length) {
      matches++; sections += ranges.length;
      maximumTunnelMeters = Math.max(maximumTunnelMeters, ranges.reduce((sum, range) => sum + range.to - range.from, 0));
      trips.filter((trip) => trip.shapeId === shapeId).forEach((trip) => directions.add(trip.directionId));
    }
  }
  if (['E1', 'E2', 'E3', 'E4', 'L3'].includes(route.shortName)) {
    assert.ok(matches > 0, route.shortName + ' must contain verified tunnels');
    assert.ok(directions.has(0) && directions.has(1), route.shortName + ' must match both directions');
  }
  if (route.shortName === 'L3') for (const shapeId of shapes) {
    const ranges = infrastructureFor(gtfs, 'euskotren', shapeId) ?? [];
    assert.equal(ranges.length, 1, 'L3 must be continuous underground beyond the Kukullaga portal');
    assert.ok(ranges[0].to - ranges[0].from > 4500, 'L3 must not have artificial surface gaps');
  }
  if (route.routeType === 0) assert.equal(matches, 0, 'trams must not inherit rail tunnels');
  summary.push({ line: route.shortName, shapes, matchedShapes: matches, tunnelSections: sections, maximumTunnelMeters: Math.round(maximumTunnelMeters), directions: [...directions] });
}
console.log(JSON.stringify(summary.map(({ shapes, ...row }) => ({ ...row, shapes: shapes.length })), null, 2));
