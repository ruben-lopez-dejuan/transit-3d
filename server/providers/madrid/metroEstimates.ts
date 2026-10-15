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
/** A synthetic train: `seenAt` is its last confirming update, `progress`/`at`/`timeline` what was last published. */
type Track = { id: string; serial: number; key: string; candidate: Candidate; seenAt: number; at: number; progress: number; timeline: MotionAnchor[] };

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
    for (const event of events) { const key = groupKey(event.pattern, event.destination); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(event); }
    const candidates: Candidate[] = [], singles: BoardEvent[] = [];
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
        // One ETA cannot locate or identify a new train; it can only confirm a known one.
        if (chain.length < 2) { singles.push(chain[0]); continue; }
        const first = chain[0], second = chain[1], stops = first.pattern.stops;
        const distance = stops[second.index].progress - stops[first.index].progress;
        const speed = distance / Math.max(1000, second.at - first.at - DWELL_MS) * 1000;
        if (speed <= 0 || speed > 30) continue;
        const timeline: MotionAnchor[] = [];
        if (first.index > 0) {
          const previous = stops[first.index - 1], duration = (stops[first.index].progress - previous.progress) / speed * 1000;
          timeline.push({ at: first.at - duration, progress: previous.progress });
        }
        for (const event of chain) {
          timeline.push({ at: event.at, progress: stops[event.index].progress });
          timeline.push({ at: event.at + DWELL_MS, progress: stops[event.index].progress });
        }
        if (now < timeline[0].at || now > timeline.at(-1)!.at || timeline.some((a, i) => i > 0 && a.at < timeline[i - 1].at)) continue;
        candidates.push({ pattern: first.pattern, destination: first.destination, events: chain, timeline, source: Math.min(...chain.map((e) => e.source)), progress: progressAt(timeline, now) });
      }
    }
    // A train lives while recent boards confirm it. Its oldest board may age out
    // (boards are emitted at different times); that alone does not end the train.
    for (const [id, track] of this.tracks) if (!isFresh(Math.max(...track.candidate.events.map((e) => e.source)), now) || now - track.seenAt > TRACK_MEMORY_MS) this.tracks.delete(id);
    // Each update is matched to the train it most plausibly continues: where that
    // train's previous timeline puts it now. Trains of one direction never swap,
    // so the closest pairs are assigned first, and a shared station ETA confirms.
    const pairs: { candidate: Candidate; track: Track; cost: number }[] = [];
    for (const candidate of candidates) for (const track of this.tracks.values()) {
      if (track.key !== groupKey(candidate.pattern, candidate.destination)) continue;
      const shared = candidate.events.some((e) => track.candidate.events.some((p) => p.index === e.index && Math.abs(p.at - e.at) <= 90_000));
      const gap = candidate.progress - expected(track, now);
      if (gap < -(shared ? 700 : 400) || gap > (shared ? 1000 : 600)) continue;
      pairs.push({ candidate, track, cost: Math.abs(gap) - (shared ? 300 : 0) });
    }
    const matched = new Map<Candidate, Track>(), taken = new Set<Track>();
    for (const pair of pairs.sort((a, b) => a.cost - b.cost)) if (!matched.has(pair.candidate) && !taken.has(pair.track)) { matched.set(pair.candidate, pair.track); taken.add(pair.track); }
    // What each train will show this round: a matched or new chain (rank 2), a
    // lone ETA continuing it (rank 1) or its previous timeline (rank 0).
    type Plan = { track: Track; candidate: Candidate; timeline: MotionAnchor[]; rank: number; position: number };
    const plans: Plan[] = [];
    for (const candidate of candidates) {
      let track = matched.get(candidate);
      if (!track) {
        if (this.tracks.size >= 1000) continue;
        track = { id: `${providerId}:arrival-track-${++this.sequence}`, serial: this.sequence, key: groupKey(candidate.pattern, candidate.destination), candidate, seenAt: now, at: now, progress: 0, timeline: candidate.timeline };
        this.tracks.set(track.id, track);
      }
      plans.push({ track, candidate, timeline: candidate.timeline, rank: 2, position: candidate.progress });
    }
    const usedSingles = new Set<BoardEvent>(), planned = new Set(plans.map((p) => p.track));
    for (const track of this.tracks.values()) {
      if (planned.has(track)) continue;
      const position = expected(track, now), stops = track.candidate.pattern.stops, next = stops.findIndex((s) => s.progress > position + 10);
      // A lone ETA at the station this train is heading to keeps it alive with
      // the new time, e.g. on the last stretch before a terminus or when the
      // board of the following station is missing.
      const due = next < 0 ? null : timeAt(track.timeline, stops[next].progress);
      const single = next < 0 ? undefined : singles.find((e) => !usedSingles.has(e) && groupKey(e.pattern, e.destination) === track.key && e.index === next && e.at + DWELL_MS > now
        && (stops[next].progress - position) / Math.max(1, (e.at - now) / 1000) <= 30 && (due === null || Math.abs(e.at - due) <= 150_000));
      if (single) {
        usedSingles.add(single);
        const start = [...track.timeline].reverse().find((a) => a.at <= now) ?? { at: now, progress: position };
        const arrival = Math.max(single.at, start.at + 1000);
        const timeline = [{ at: start.at, progress: Math.min(start.progress, stops[next].progress) }, { at: arrival, progress: stops[next].progress }, { at: arrival + DWELL_MS, progress: stops[next].progress }];
        plans.push({ track, candidate: { pattern: single.pattern, destination: single.destination, events: [single], timeline, source: single.source, progress: progressAt(timeline, now) }, timeline, rank: 1, position });
      } else if (now - track.seenAt <= COAST_MS && now <= track.timeline.at(-1)!.at) {
        // Briefly missing evidence (a stale board, a broken chain) is not a
        // vanished train: it continues on its last published timeline.
        plans.push({ track, candidate: track.candidate, timeline: track.timeline, rank: 0, position });
      }
    }
    // Two trains of one direction are never a few hundred metres apart: such a
    // pair is one train seen twice. The older identity survives with the
    // stronger evidence, so a duplicate neither appears nor replaces the train.
    plans.sort((a, b) => a.track.key.localeCompare(b.track.key) || a.position - b.position);
    const merged: Plan[] = [];
    for (const plan of plans) {
      const previous = merged.at(-1);
      if (!previous || previous.track.key !== plan.track.key || plan.position - previous.position >= SAME_TRAIN_METERS) { merged.push(plan); continue; }
      const [older, newer] = previous.track.serial < plan.track.serial ? [previous, plan] : [plan, previous], evidence = newer.rank > older.rank ? newer : older;
      this.tracks.delete(newer.track.id);
      merged[merged.length - 1] = { ...evidence, track: older.track, position: older.position };
    }
    const vehicles: AdapterVehicle[] = [];
    for (const { track, candidate, timeline, rank } of merged) {
      // Continue from where the train was last shown: a later ETA never moves it
      // backwards (it waits there) nor teleports it ahead (it catches up).
      // Small differences are left to the map's own smoothing: a correction
      // re-anchors the motion at this instant, which the map draws as a restart.
      const floor = track.at < now ? expected(track, now) : track.progress, offset = progressAt(timeline, now) - floor;
      const advance = (offset + floor - track.progress) / ((now - track.at) / 1000);
      const held = track.at >= now ? timeline : offset < -HOLD_TOLERANCE_METERS ? holdAt(timeline, floor) : offset > 1 && advance > CATCH_UP_SPEED ? catchUp(timeline, now, floor) : timeline;
      const progress = Math.max(floor, progressAt(held, now));
      Object.assign(track, { candidate, timeline: held, progress, at: now }, rank > 0 ? { seenAt: now } : {});
      const plan = tripPlan(gtfs, candidate.pattern.tripId)!, position = positionAtProgress(plan.metric, progress); if (!position) continue;
      const upcoming = candidate.events.filter((e) => e.at + DWELL_MS >= now && candidate.pattern.stops[e.index].progress >= progress - 10);
      const nextStop = upcoming[0] ? candidate.pattern.stops[upcoming[0].index] : candidate.pattern.stops.find((s) => s.progress >= progress - 10) ?? candidate.pattern.stops.at(-1)!;
      vehicles.push({ id: track.id, operatorId: providerId, mode: gtfs.routes.get(candidate.pattern.routeId)?.routeType === 0 ? 'tram' : 'rail', tripId: candidate.pattern.tripId, routeId: candidate.pattern.routeId, shapeId: candidate.pattern.shapeId, directionId: candidate.pattern.directionId, progressMetersAlongShape: progress, latitude: position.coordinate[1], longitude: position.coordinate[0], bearing: position.bearing, positionQuality: 'predicted', positionSource: 'trip-updates', observationTimestamp: null, predictionTimestamp: now, timetableTimestamp: candidate.source, serviceDate: formatServiceDate(new Date(now)).date, tripIdentityQuality: 'estimated', vehicleId: null, delaySeconds: null, maximumSpeedMetersPerSecond: 30, destination: candidate.destination, nextStopId: nextStop.id, motionTimeline: held, arrivalPredictions: upcoming.map((e) => ({ at: e.at, progress: candidate.pattern.stops[e.index].progress, sourceTimestamp: e.source })) });
    }
    return vehicles;
  }
}

const DWELL_MS = 20_000; // Explicit estimated dwell, never an observed stop.
const TRACK_MEMORY_MS = 180_000, COAST_MS = 60_000, CATCH_UP_SPEED = 25, SAME_TRAIN_METERS = 250, HOLD_TOLERANCE_METERS = 15;
const groupKey = (pattern: Pattern, destination: string) => `${pattern.key}:${metroName(destination)}`;
/** Linear position on a timeline, held at its ends. */
function progressAt(timeline: MotionAnchor[], now: number) {
  const next = timeline.findIndex((a) => a.at >= now);
  if (next <= 0) return next === 0 ? timeline[0].progress : timeline.at(-1)!.progress;
  const a = timeline[next - 1], b = timeline[next];
  return a.progress + Math.max(0, Math.min(1, (now - a.at) / Math.max(1, b.at - a.at))) * (b.progress - a.progress);
}
function timeAt(timeline: MotionAnchor[], progress: number) {
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1], b = timeline[i];
    if (a.progress <= progress && b.progress >= progress) return b.progress > a.progress ? a.at + (b.at - a.at) * (progress - a.progress) / (b.progress - a.progress) : a.at;
  }
  return null;
}
/** Where a known train should be now according to what was last published, never behind it. */
const expected = (track: Track, now: number) => Math.max(track.progress, progressAt(track.timeline, now));
/** The same timeline, waiting at `floor` until it gets there instead of reversing. */
function holdAt(timeline: MotionAnchor[], floor: number): MotionAnchor[] {
  const held: MotionAnchor[] = [];
  for (const [i, anchor] of timeline.entries()) {
    const previous = timeline[i - 1];
    if (previous && previous.progress < floor && anchor.progress > floor) held.push({ at: previous.at + (anchor.at - previous.at) * (floor - previous.progress) / (anchor.progress - previous.progress), progress: floor });
    held.push({ at: anchor.at, progress: Math.max(anchor.progress, floor) });
  }
  return held.filter((a, i) => i === 0 || a.at !== held[i - 1].at || a.progress !== held[i - 1].progress);
}
/** A timeline that is ahead of `progress` at `now` rejoins it no faster than CATCH_UP_SPEED. */
function catchUp(timeline: MotionAnchor[], now: number, progress: number): MotionAnchor[] {
  if (progressAt(timeline, now) <= progress + 1) return timeline;
  const join = timeline.findIndex((a) => a.at > now && a.progress > progress && (a.progress - progress) / ((a.at - now) / 1000) <= CATCH_UP_SPEED);
  const last = timeline.at(-1)!;
  return join < 0 ? [{ at: now, progress }, { at: now + (last.progress - progress) / CATCH_UP_SPEED * 1000, progress: last.progress }] : [{ at: now, progress }, ...timeline.slice(join)];
}
