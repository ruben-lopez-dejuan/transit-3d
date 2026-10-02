import type { BizkaibusGtfs } from '../../providers/bizkaibus/gtfs';
import { tripPlan } from '../../transit/plans';
import type { Shape } from '../../../shared/transit/network';

// Metro Bilbao infrastructure maintenance specification, annex 2, pp. 78–79:
// common section + L2 in tunnel, except Etxebarri–Bolueta and Urbinaga viaduct.
// Portal boundaries and depth are visual approximations, not surveyed elevations.
const tunnels = new Set(['bolueta', 'basarrate', 'santutxu', 'casco viejo', 'abando', 'moyua', 'eliptikoa', 'indautxu', 'san mames', 'deustu', 'deusto', 'sarriko', 'san inazio', 'san ignazio', 'gurutzeta', 'ansio', 'barakaldo', 'bagatza', 'sestao', 'abatxolo', 'portugalete', 'penota', 'santurtzi', 'kabiezes']);
const normalize = (name: string) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const matches = (name: string, names: Set<string>) => [...names].some((item) => normalize(name).includes(item));
export function infrastructureFor(gtfs: BizkaibusGtfs, operatorId: string, shapeId: string): Shape['underground'] {
  if (operatorId !== 'metro-bilbao') return [];
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
