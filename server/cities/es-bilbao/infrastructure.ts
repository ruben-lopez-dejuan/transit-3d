import type { BizkaibusGtfs } from '../../providers/bizkaibus/gtfs';
import { tripPlan, shapeMetric, modeFor } from '../../transit/plans';
import type { Shape } from '../../../shared/transit/network';
import type { Coordinate } from '../../transit/motionEngine';
import { TunnelGeometryIndex } from '../../transit/tunnelGeometry';
import euskotrenTunnels from './euskotren-tunnels.json';
import renfeTunnels from './renfe-tunnels.json';
import metroTunnels from './metro-tunnels.json';

// Reviewed OSM tunnel geometry belongs to the city package; matching is shared.
const euskotrenTunnelIndex = new TunnelGeometryIndex(euskotrenTunnels.ways.map((way) => way.coordinates as Coordinate[]));
const renfeTunnelIndex = new TunnelGeometryIndex(renfeTunnels.ways.map((way) => way.coordinates as Coordinate[]));
const metroTunnelIndex = new TunnelGeometryIndex(metroTunnels.ways.map((way) => way.coordinates as Coordinate[]));

// Metro Bilbao infrastructure maintenance specification, annex 2, pp. 78–79:
// common section + L2 in tunnel, except Etxebarri–Bolueta and Urbinaga viaduct.
// Between two of these stations the line never comes to the surface.
const tunnels = new Set(['bolueta', 'basarrate', 'santutxu', 'casco viejo', 'abando', 'moyua', 'eliptikoa', 'indautxu', 'san mames', 'deustu', 'deusto', 'sarriko', 'san inazio', 'san ignazio', 'gurutzeta', 'ansio', 'barakaldo', 'bagatza', 'sestao', 'abatxolo', 'portugalete', 'penota', 'santurtzi', 'kabiezes']);
const normalize = (name: string) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const matches = (name: string, names: Set<string>) => [...names].some((item) => normalize(name).includes(item));
export function infrastructureFor(gtfs: BizkaibusGtfs, operatorId: string, shapeId: string): Shape['underground'] {
  const tunnelIndex = operatorId === 'euskotren' ? euskotrenTunnelIndex : operatorId === 'renfe' ? renfeTunnelIndex : operatorId === 'metro-bilbao' ? metroTunnelIndex : null;
  if (!tunnelIndex) return [];
  const trip = [...gtfs.trips.values()].find((item) => item.shapeId === shapeId);
  if (!trip || modeFor(gtfs.routes.get(trip.routeId)?.routeType ?? -1) !== 'rail') return [];
  const metric = shapeMetric(gtfs, shapeId);
  if (!metric) return [];
  const ranges = tunnelIndex.rangesFor(metric);
  return operatorId === 'metro-bilbao' ? bridgeStationGaps(ranges, metroStationRanges(gtfs, shapeId)) : ranges;
}
/**
 * Portals come from OSM. A shape drawn far off the mapped tunnel (some Metro shapes are
 * rounded to 100 m) can lose the match for a stretch, and the train would come up between
 * two underground stations: such a gap is closed when both its ends are in the same
 * stretch between underground stations.
 */
function bridgeStationGaps(ranges: NonNullable<Shape['underground']>, stations: NonNullable<Shape['underground']>) {
  const result: typeof ranges = [];
  for (const range of ranges) {
    const last = result.at(-1);
    if (last && stations.some((station) => station.from <= last.to && range.from <= station.to)) {
      last.to = range.to;
      if (range.tunnelAfterEnd) last.tunnelAfterEnd = true;
    } else result.push({ ...range });
  }
  return result;
}
function metroStationRanges(gtfs: BizkaibusGtfs, shapeId: string) {
  const trip = [...gtfs.trips.values()].find((t) => t.shapeId === shapeId);
  const stops = trip ? tripPlan(gtfs, trip.tripId)?.stops ?? [] : [];
  const ranges: NonNullable<Shape['underground']> = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    const first = gtfs.stops.get(a.stopId)?.name ?? '', second = gtfs.stops.get(b.stopId)?.name ?? '';
    const basauri = [first, second].every((n) => matches(n, new Set(['ariz', 'basauri'])));
    if (basauri || (matches(first, tunnels) && matches(second, tunnels))) ranges.push({ from: a.progress, to: b.progress, depthMeters: 12, approximate: true });
  }
  const merged: typeof ranges = [];
  for (const range of ranges) { const last = merged.at(-1); if (last && Math.abs(last.to - range.from) < 1) last.to = range.to; else merged.push({ ...range }); }
  return merged;
}
