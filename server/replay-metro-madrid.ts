import fs from 'node:fs';
import path from 'node:path';
import { parseGtfsDirectory } from './providers/bizkaibus/gtfs';
import { parseMetroBoards, type MetroBoard } from './providers/madrid/metroFeed';
import { MetroEstimates } from './providers/madrid/metroEstimates';
import { installMetroTopology, L3_TOPOLOGY_LAYERS, type TopologyDocument } from './providers/madrid/metroTopology';
import type { AdapterVehicle } from '../shared/transit/contracts';

/**
 * Replays captured Metro de Madrid teleindicadores through MetroEstimates and
 * measures what the map would show: trains per snapshot, how long each synthetic
 * identity lasts, backward steps and impossible jumps. No network, no app.
 *
 * Capture: one XML per poll named <epoch seconds>.xml (monitor-madrid.ts --metro-captures).
 * Usage: npm run replay:metro-madrid -- <captures dir> <metro GTFS dir> <topology dir> [step seconds]
 * (the GTFS dir is server/cache/es-madrid-…/metro-madrid; topology-NN.json live in server/cache/madrid).
 */
export type IdentityStats = { snapshots: number; meanVehicles: number; ids: number; medianLifetimeSeconds: number; backwards: number; jumps: number; steps: number };

export function identityStats(frames: { at: number; vehicles: Pick<AdapterVehicle, 'id' | 'progressMetersAlongShape' | 'shapeId'>[] }[]): IdentityStats {
  const lives = new Map<string, { first: number; last: number }>(), last = new Map<string, { at: number; progress: number; shapeId: string | null }>();
  let backwards = 0, jumps = 0, steps = 0, total = 0;
  for (const frame of frames) {
    total += frame.vehicles.length;
    for (const v of frame.vehicles) {
      const life = lives.get(v.id); if (life) life.last = frame.at; else lives.set(v.id, { first: frame.at, last: frame.at });
      const previous = last.get(v.id);
      if (previous && previous.shapeId === v.shapeId && v.progressMetersAlongShape !== null) {
        const advance = v.progressMetersAlongShape - previous.progress, seconds = (frame.at - previous.at) / 1000;
        steps++;
        if (advance < -20) backwards++;
        if (seconds > 0 && advance / seconds > 25) jumps++;
      }
      if (v.progressMetersAlongShape !== null) last.set(v.id, { at: frame.at, progress: v.progressMetersAlongShape, shapeId: v.shapeId ?? null });
    }
  }
  const lifetimes = [...lives.values()].map((l) => (l.last - l.first) / 1000).sort((a, b) => a - b);
  return { snapshots: frames.length, meanVehicles: frames.length ? +(total / frames.length).toFixed(1) : 0, ids: lives.size, medianLifetimeSeconds: lifetimes[Math.floor(lifetimes.length / 2)] ?? 0, backwards, jumps, steps };
}

export const METRO_LINES = new Map([['0', 'R'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string])]);

export function replay(captures: { at: number; boards: MetroBoard[] }[], gtfs: ReturnType<typeof parseGtfsDirectory>, stepSeconds = 15, lines: ReadonlyMap<string, string> = METRO_LINES) {
  const estimator = new MetroEstimates(lines), frames: { at: number; vehicles: AdapterVehicle[] }[] = [];
  if (!captures.length) return frames;
  for (let now = captures[0].at, index = 0; now <= captures.at(-1)!.at + 30_000; now += stepSeconds * 1000) {
    while (index + 1 < captures.length && captures[index + 1].at <= now) index++;
    frames.push({ at: now, vehicles: estimator.vehicles(gtfs, captures[index].boards, now, 'metro-madrid') });
  }
  return frames;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [captureDir, gtfsDir, topologyDir] = process.argv.slice(2), step = Number(process.argv[5] ?? 15);
  const gtfs = parseGtfsDirectory(gtfsDir);
  const topology = L3_TOPOLOGY_LAYERS.map((layer) => JSON.parse(fs.readFileSync(path.join(topologyDir, `topology-${layer}.json`), 'utf8')) as TopologyDocument);
  if (!(gtfs.routeTripIds.get('4__3___') ?? []).length) { installMetroTopology(gtfs, topology[0], topology[1]); installMetroTopology(gtfs, topology[2], topology[3]); }
  const captures = fs.readdirSync(captureDir).filter((f) => /^\d+\.xml$/.test(f)).sort().flatMap((f) => {
    try { return [{ at: Number(f.slice(0, -4)) * 1000, boards: parseMetroBoards(fs.readFileSync(path.join(captureDir, f), 'utf8')) }]; } catch { return []; }
  });
  console.log(JSON.stringify({ captures: captures.length, ...identityStats(replay(captures, gtfs, step)) }));
}
