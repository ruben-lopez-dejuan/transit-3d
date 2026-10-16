import type { BizkaibusGtfs } from '../providers/bizkaibus/gtfs';
import { tripPlan } from './plans';

type CoveredVehicle = { vehicleId?: string | null; tripId: string; routeId: string; headsign: string; progressMetersAlongShape: number };
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
/** A forecast for one of the next few stops; further ahead the whole minutes say little about the pace now. */
const STOPS_AHEAD = 5;
/** The panels list two buses per line and destination, the ones nearest the stop. */
const BUSES_PER_LINE = 2;

/**
 * The fewest stops whose stop panels name every live bus (Bizkaibus passing times, Bilbobus SIRI): a stop covers the
 * two nearest approaching buses of each line and destination among those that
 * have it within their next STOPS_AHEAD stops. Greedy set cover.
 */
export function coveringStops(gtfs: BizkaibusGtfs, vehicles: CoveredVehicle[]) {
  const approaching = new Map<string, { vehicleId: string; group: string; distance: number }[]>();
  const ids = new Set<string>();
  for (const vehicle of vehicles) {
    if (!vehicle.vehicleId || ids.has(vehicle.vehicleId)) continue;
    // The last stop gives no forecast for a bus ending its trip there (Bizkaibus matchPassingTimes).
    const ahead = tripPlan(gtfs, vehicle.tripId)?.stops.slice(0, -1).filter((s) => s.progress > vehicle.progressMetersAlongShape + 10).slice(0, STOPS_AHEAD) ?? [];
    if (!ahead.length) continue;
    ids.add(vehicle.vehicleId);
    for (const stop of ahead) {
      if (!approaching.has(stop.stopId)) approaching.set(stop.stopId, []);
      approaching.get(stop.stopId)!.push({ vehicleId: vehicle.vehicleId, group: `${vehicle.routeId}:${normalize(vehicle.headsign)}`, distance: stop.progress - vehicle.progressMetersAlongShape });
    }
  }
  const covers = new Map([...approaching].map(([stopId, buses]) => {
    const groups = new Map<string, typeof buses>();
    for (const bus of buses) { if (!groups.has(bus.group)) groups.set(bus.group, []); groups.get(bus.group)!.push(bus); }
    return [stopId, new Set([...groups.values()].flatMap((group) => group.sort((a, b) => a.distance - b.distance).slice(0, BUSES_PER_LINE).map((bus) => bus.vehicleId)))];
  }));
  const uncovered = new Set(ids), stopIds: string[] = [];
  while (uncovered.size) {
    let best: string | null = null, gain = 0;
    for (const [stopId, covered] of covers) {
      let count = 0; for (const id of covered) if (uncovered.has(id)) count++;
      if (count > gain) { best = stopId; gain = count; }
    }
    if (!best) break;
    stopIds.push(best);
    for (const id of covers.get(best)!) uncovered.delete(id);
    covers.delete(best);
  }
  return { stopIds, covered: ids.size - uncovered.size };
}
