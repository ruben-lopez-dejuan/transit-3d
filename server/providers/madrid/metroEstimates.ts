import type { BizkaibusGtfs } from '../bizkaibus/gtfs';
import type { AdapterVehicle } from '../../../shared/transit/contracts';
import type { MotionAnchor } from '../../../shared/transit/network';
import { isFresh } from '../../../shared/transit/freshness';
import { formatServiceDate } from '../../transit/gtfsCalendar';
import { tripPlan } from '../../transit/plans';
import { positionAtProgress } from '../../transit/motionEngine';
import type { MetroBoard } from './metroFeed';

export const metroName = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
type Pattern = { key: string; tripId: string; routeId: string; directionId: number | null; shapeId: string; stops: { id: string; name: string; progress: number }[] };
export type BoardEvent = { pattern: Pattern; index: number; destinationIndex: number; destination: string; at: number; source: number; platform: string };
type Candidate = { pattern: Pattern; destination: string; events: BoardEvent[]; timeline: MotionAnchor[]; source: number; progress: number };
type Track = { id: string; candidate: Candidate; seenAt: number };

/** Correlates arrival forecasts, not physical train identities. No station → vehicle loop. */
export class MetroEstimates {
  private patterns?: { gtfs: BizkaibusGtfs; byLine: Map<string, Pattern[]> };
  private tracks = new Map<string, Track>();
  private sequence = 0;
  constructor(private readonly lineNames: ReadonlyMap<string, string>) {}
  events(gtfs: BizkaibusGtfs, boards: MetroBoard[], now: number): BoardEvent[] {
    if (this.patterns?.gtfs !== gtfs) {
      const byLine = new Map<string, Pattern[]>(), seen = new Set<string>();
      for (const trip of gtfs.trips.values()) {
        if (!trip.shapeId) continue;
        const key = `${trip.routeId}:${trip.shapeId}:${trip.headsign}`, line = gtfs.routes.get(trip.routeId)?.shortName;
        if (!line || seen.has(key)) continue;
        seen.add(key);
        const plan = tripPlan(gtfs, trip.tripId); if (!plan || plan.stops.length < 2) continue;
        const pattern: Pattern = { key, tripId: trip.tripId, routeId: trip.routeId, directionId: trip.directionId, shapeId: trip.shapeId, stops: plan.stops.map((s) => ({ id: s.stopId, name: metroName(gtfs.stops.get(s.stopId)!.name), progress: s.progress })) };
        if (!byLine.has(line)) byLine.set(line, []); byLine.get(line)!.push(pattern);
      }
      this.patterns = { gtfs, byLine }; this.tracks.clear();
    }
    const events: BoardEvent[] = [];
    for (const board of boards) {
      if (!isFresh(board.sourceTimestamp, now)) continue;
      const line = this.lineNames.get(board.line); if (!line) continue;
      const station = metroName(board.station), destination = metroName(board.destination);
      const options = (this.patterns.byLine.get(line) ?? []).flatMap((pattern) => pattern.stops.flatMap((stop, index) => {
        if (stop.name !== station) return [];
        let end = pattern.stops.findIndex((s, i) => i > index && s.name === destination);
        // A newer official line endpoint may lie beyond the old GTFS geometry.
        // Infer direction only when the other endpoint is this pattern's origin;
        // cover the known segment, never invent the extension (e.g. L3 El Casar).
        const endpoints = (board.lineName ?? '').split('-').map(metroName);
        if (end < 0 && endpoints.length === 2 && endpoints.includes(destination) && !pattern.stops.some((s) => s.name === destination) && endpoints.find((name) => name !== destination) === pattern.stops[0].name && index < pattern.stops.length - 1) end = pattern.stops.length - 1;
        if (end < 0) return [];
        return [{ pattern, index, end, distance: pattern.stops[end].progress - stop.progress }];
      })).sort((a, b) => a.distance - b.distance);
      const best = options[0];
      // Ambiguous direction at a loop/branch is omitted rather than assigned from platform number.
      if (!best || options[1] && options[1].pattern.key !== best.pattern.key && Math.abs(options[1].distance - best.distance) < 100) continue;
      for (const at of board.arrivals) if (at >= now - 60_000) events.push({ pattern: best.pattern, index: best.index, destinationIndex: best.end, destination: board.destination, at, source: board.sourceTimestamp, platform: board.platform });
    }
    // Equivalent boards for one station/direction are one observation, not two trains.
    const unique = new Map<string, BoardEvent>();
    for (const event of events) {
      const key = `${event.pattern.key}:${event.index}:${metroName(event.destination)}:${Math.round(event.at / 60_000)}`;
      const previous = unique.get(key); if (!previous || previous.source < event.source) unique.set(key, event);
    }
    return [...unique.values()];
  }
  vehicles(gtfs: BizkaibusGtfs, boards: MetroBoard[], now: number, providerId: string): AdapterVehicle[] {
    const events = this.events(gtfs, boards, now);
    const groups = new Map<string, BoardEvent[]>();
    for (const event of events) { const key = `${event.pattern.key}:${metroName(event.destination)}`; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(event); }
    const candidates: Candidate[] = [];
    for (const group of groups.values()) {
      const chains: BoardEvent[][] = [];
      for (const event of group.sort((a, b) => a.index - b.index || a.at - b.at)) {
        const eligible = chains.filter((chain) => {
          const last = chain.at(-1)!;
          const distance = event.pattern.stops[event.index].progress - last.pattern.stops[last.index].progress;
          const elapsed = (event.at - last.at) / 1000;
          return event.index === last.index + 1 && event.index <= last.destinationIndex && distance > 20 && elapsed >= Math.max(25, distance / 30 + 20) && elapsed <= 420;
        }).sort((a, b) => (event.at - a.at(-1)!.at) - (event.at - b.at(-1)!.at));
        if (eligible[0]) eligible[0].push(event); else chains.push([event]);
      }
      for (const chain of chains) {
        if (chain.length < 2) continue; // One ETA cannot locate or identify a train.
        const first = chain[0], second = chain[1], stops = first.pattern.stops;
        const dwell = 20_000; // Explicit estimated dwell, never an observed stop.
        const distance = stops[second.index].progress - stops[first.index].progress;
        const speed = distance / Math.max(1000, second.at - first.at - dwell) * 1000;
        if (speed <= 0 || speed > 30) continue;
        const timeline: MotionAnchor[] = [];
        if (first.index > 0) {
          const previous = stops[first.index - 1], duration = (stops[first.index].progress - previous.progress) / speed * 1000;
          timeline.push({ at: first.at - duration, progress: previous.progress });
        }
        for (const event of chain) {
          timeline.push({ at: event.at, progress: stops[event.index].progress });
          timeline.push({ at: event.at + dwell, progress: stops[event.index].progress });
        }
        if (now < timeline[0].at || now > timeline.at(-1)!.at || timeline.some((a, i) => i > 0 && a.at < timeline[i - 1].at)) continue;
        const next = timeline.findIndex((a) => a.at >= now), a = timeline[Math.max(0, next - 1)], b = timeline[Math.max(0, next)];
        const fraction = Math.max(0, Math.min(1, (now - a.at) / Math.max(1, b.at - a.at)));
        candidates.push({ pattern: first.pattern, destination: first.destination, events: chain, timeline, source: Math.min(...chain.map((e) => e.source)), progress: a.progress + fraction * (b.progress - a.progress) });
      }
    }
    for (const [id, track] of this.tracks) if (!isFresh(track.candidate.source, now) || now - track.seenAt > 180_000) this.tracks.delete(id);
    const taken = new Set<string>(), vehicles: AdapterVehicle[] = [];
    for (const candidate of candidates.sort((a, b) => a.progress - b.progress)) {
      const matches = [...this.tracks.values()].filter((track) => !taken.has(track.id) && track.candidate.pattern.key === candidate.pattern.key && metroName(track.candidate.destination) === metroName(candidate.destination)).map((track) => {
        const common = candidate.events.map((e) => ({ e, old: track.candidate.events.find((p) => p.index === e.index) })).filter((p) => p.old);
        const delta = common.length ? Math.min(...common.map((p) => Math.abs(p.e.at - p.old!.at))) : Infinity;
        const elapsed = Math.max(1, (now - track.seenAt) / 1000), advance = candidate.progress - track.candidate.progress;
        return { track, delta, reasonable: advance >= -75 && advance <= elapsed * 30 + 150 };
      }).filter((m) => m.delta <= 90_000 && m.reasonable).sort((a, b) => a.delta - b.delta);
      if (matches[1] && Math.abs(matches[1].delta - matches[0].delta) < 10_000) continue;
      const id = matches[0]?.track.id ?? `${providerId}:arrival-track-${++this.sequence}`;
      if (this.tracks.size >= 1000 && !this.tracks.has(id)) continue;
      taken.add(id); this.tracks.set(id, { id, candidate, seenAt: now });
      const plan = tripPlan(gtfs, candidate.pattern.tripId)!, position = positionAtProgress(plan.metric, candidate.progress); if (!position) continue;
      const next = candidate.events.find((e) => e.at + 20_000 >= now) ?? candidate.events.at(-1)!;
      vehicles.push({ id, operatorId: providerId, mode: gtfs.routes.get(candidate.pattern.routeId)?.routeType === 0 ? 'tram' : 'rail', tripId: candidate.pattern.tripId, routeId: candidate.pattern.routeId, shapeId: candidate.pattern.shapeId, directionId: candidate.pattern.directionId, progressMetersAlongShape: candidate.progress, latitude: position.coordinate[1], longitude: position.coordinate[0], bearing: position.bearing, positionQuality: 'predicted', positionSource: 'trip-updates', observationTimestamp: null, predictionTimestamp: now, timetableTimestamp: candidate.source, serviceDate: formatServiceDate(new Date(now)).date, tripIdentityQuality: 'estimated', vehicleId: null, delaySeconds: null, maximumSpeedMetersPerSecond: 30, destination: candidate.destination, nextStopId: candidate.pattern.stops[next.index].id, motionTimeline: candidate.timeline, arrivalPredictions: candidate.events.map((e) => ({ at: e.at, progress: candidate.pattern.stops[e.index].progress, sourceTimestamp: e.source })) });
    }
    return vehicles;
  }
}
