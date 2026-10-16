import path from 'node:path';

/**
 * Match a published shape onto reviewed OSM tracks. Euskotren draws its trams as a
 * point every 40 m, polygonal on every curve, and at the Atxuri depot alternates
 * between two tracks 20 m apart; its Matiko – Kukullaga tunnel (L3, and E1, E3 and
 * E4 through it) is a sketch that cuts corners up to 180 m. A hidden Markov model picks,
 * for every shape point, the nearby track position whose distance along the
 * network best agrees with the shape (Viterbi), so the result follows one track
 * through its curves instead of jumping between tracks.
 */
type Lonlat = [number, number];
export type TrackWay = { id: number; service?: string; direction?: 'forward' | 'backward'; path: Lonlat[] };
/** A platform on the tracks: where OSM puts the stop positions of a station (their mean). */
export type TrackStation = { name: string; ids: number[]; point: Lonlat };
export const TRAM_TRACKS_FILE = path.resolve('server/cities/es-bilbao/tram-tracks.json');
export const RAIL_TRACKS_FILE = path.resolve('server/cities/es-bilbao/rail-tracks.json');
/**
 * How a set of tracks is matched. `candidateMeters`: a shape point farther than this
 * from every track is kept as published. `runsOn`: which of two untagged parallel tracks
 * a train takes. `minMatchedShare`: the share of the shape that must lie on the tracks
 * (trams are covered whole; the rail tracks are one stretch of longer lines).
 * `deadEndMeters`: a point beyond a loose end of the tracks farther than this is not
 * on them (the line goes on where the dataset stops).
 */
export type TrackOptions = { candidateMeters: number; runsOn: 'right' | 'left'; minMatchedShare: number; deadEndMeters: number };
/** TR Bilbao and Vitoria-Gasteiz: TR draws the Atxuri – Bolueta tunnel 29 m off. */
export const TRAM_TRACK_OPTIONS: TrackOptions = { candidateMeters: 40, runsOn: 'right', minMatchedShare: .5, deadEndMeters: Infinity };
/**
 * Euskotren in Bizkaia runs on the left (euskadi.eus, Feb 2026: only the Topo ran on the right).
 * The Otxarkoaga – Kukullaga curve is drawn as a chord 177 m inside the track.
 */
export const RAIL_TRACK_OPTIONS: TrackOptions = { candidateMeters: 200, runsOn: 'left', minMatchedShare: 0, deadEndMeters: 10 };

const METERS_PER_DEGREE = 111_320;
const meters = (a: Lonlat, b: Lonlat) => Math.hypot((a[0] - b[0]) * METERS_PER_DEGREE * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), (a[1] - b[1]) * METERS_PER_DEGREE);
const MAX_CANDIDATES = 6;
const CROWDING_METERS = 40;
/** A track OSM says runs the other way, or else the one of a double track trains do not run on this way, costs this much more. */
const WRONG_TRACK_PENALTY = 6;
/** Depot, siding and crossover tracks only when the shape really goes there. */
const SERVICE_TRACK_PENALTY = 5;
const CELL_DEGREES = 0.001;
/**
 * Hopping straight across to another track costs this much: otherwise a few points
 * that fit the other track better (Salburua's terminal platform, 20 m off) would keep
 * the match on it back to the previous crossover, a kilometre on the wrong track.
 */
const HOP_PENALTY = 25;
/** Only between running tracks side by side, never among depot and siding tracks (Atxuri). */
const MAX_HOP_METERS = 8;

type Candidate = { edge: number; t: number; point: Lonlat; cost: number };

export class TrackNetwork {
  readonly nodes: Lonlat[] = [];
  /** `direction` is +1 when trams run from a to b, -1 when from b to a, 0 when unknown. */
  readonly edges: { a: number; b: number; meters: number; service: boolean; direction: number }[] = [];
  private readonly adjacency: { to: number; meters: number }[][] = [];
  private readonly incident: number[][] = [];
  private readonly cells = new Map<string, number[]>();

  constructor(ways: TrackWay[], readonly options: TrackOptions = TRAM_TRACK_OPTIONS) {
    const ids = new Map<string, number>();
    const node = (point: Lonlat) => {
      const key = `${point[0]},${point[1]}`;
      let id = ids.get(key);
      if (id === undefined) { id = this.nodes.length; ids.set(key, id); this.nodes.push(point); this.adjacency.push([]); this.incident.push([]); }
      return id;
    };
    for (const way of ways) for (let i = 1; i < way.path.length; i++) {
      const a = node(way.path[i - 1]), b = node(way.path[i]);
      if (a === b) continue;
      const edge = this.edges.length, length = meters(this.nodes[a], this.nodes[b]);
      this.edges.push({ a, b, meters: length, service: !!way.service, direction: way.direction === 'forward' ? 1 : way.direction === 'backward' ? -1 : 0 });
      this.adjacency[a].push({ to: b, meters: length }); this.adjacency[b].push({ to: a, meters: length });
      this.incident[a].push(edge); this.incident[b].push(edge);
      const [x0, x1] = [this.nodes[a][0], this.nodes[b][0]].sort((p, q) => p - q), [y0, y1] = [this.nodes[a][1], this.nodes[b][1]].sort((p, q) => p - q);
      for (let x = Math.floor(x0 / CELL_DEGREES); x <= Math.floor(x1 / CELL_DEGREES); x++) for (let y = Math.floor(y0 / CELL_DEGREES); y <= Math.floor(y1 / CELL_DEGREES); y++) {
        const cell = `${x},${y}`;
        if (!this.cells.has(cell)) this.cells.set(cell, []);
        this.cells.get(cell)!.push(edge);
      }
    }
  }

  private project(edge: number, point: Lonlat, k: number) {
    const { a, b } = this.edges[edge], [ax, ay] = this.nodes[a], [bx, by] = this.nodes[b];
    const dx = (bx - ax) * k, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point[0] - ax) * k * dx + (point[1] - ay) * dy) / length)) : 0;
    const projected: Lonlat = [ax + t * (bx - ax), ay + t * (by - ay)];
    return { t, point: projected, distance: meters(projected, point) };
  }

  /** Nearby track positions, the nearest per stretch of track, with their emission cost. */
  candidates(point: Lonlat, heading: Lonlat | null): Candidate[] {
    const { candidateMeters, runsOn, deadEndMeters } = this.options;
    const k = Math.cos(point[1] * Math.PI / 180), found: Candidate[] = [], seen = new Set<number>();
    const cx = Math.floor(point[0] / CELL_DEGREES), cy = Math.floor(point[1] / CELL_DEGREES);
    const reach = Math.ceil(candidateMeters / (CELL_DEGREES * METERS_PER_DEGREE * k));
    for (let x = cx - reach; x <= cx + reach; x++) for (let y = cy - reach; y <= cy + reach; y++) for (const edge of this.cells.get(`${x},${y}`) ?? []) {
      if (seen.has(edge)) continue;
      seen.add(edge);
      const { t, point: projected, distance } = this.project(edge, point, k);
      if (distance > candidateMeters) continue;
      const { a, b, service } = this.edges[edge], end = t === 0 ? a : t === 1 ? b : -1;
      // Past a loose end the line goes on beyond the dataset. Far from the tracks every node
      // near the nearest point is almost as close and would crowd the other track out of the
      // candidates: there a node is a position of its own only where the track bends away on every side.
      if (end >= 0 && (this.incident[end].length === 1 ? distance > deadEndMeters
        : distance > CROWDING_METERS && this.incident[end].some((other) => this.project(other, point, k).distance < distance - .01))) continue;
      found.push({ edge, t, point: projected, cost: distance + (service ? SERVICE_TRACK_PENALTY : 0) });
    }
    found.sort((p, q) => p.cost - q.cost);
    // Neighbouring edges of one track project onto the same place; keep one of them.
    const kept: Candidate[] = [];
    for (const candidate of found) if (kept.length < MAX_CANDIDATES && kept.every((other) => meters(other.point, candidate.point) > 1)) kept.push(candidate);
    if (!heading) return kept;
    const direction = (candidate: Candidate) => { const { a, b } = this.edges[candidate.edge]; return [(this.nodes[b][0] - this.nodes[a][0]) * k, this.nodes[b][1] - this.nodes[a][1]]; };
    for (const candidate of kept) {
      const signed = this.edges[candidate.edge].direction;
      if (!signed) continue;
      const [x, y] = direction(candidate);
      if (signed * (x * heading[0] * k + y * heading[1]) < 0) candidate.cost += WRONG_TRACK_PENALTY;
    }
    // Without tags, of two parallel tracks a few metres apart the one on the far side is the other direction's.
    for (const candidate of kept) if (!this.edges[candidate.edge].direction && kept.some((other) => {
      const apart = meters(candidate.point, other.point), [ax, ay] = direction(candidate), [bx, by] = direction(other);
      const parallel = Math.abs(ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1) > .95;
      // East-north cross product of the heading and the offset to the other track: negative is to the right of travel.
      const side = heading[0] * k * (other.point[1] - candidate.point[1]) - heading[1] * (other.point[0] - candidate.point[0]) * k;
      return apart >= 1.5 && apart <= 8 && parallel && (runsOn === 'right' ? side < 0 : side > 0);
    })) candidate.cost += WRONG_TRACK_PENALTY;
    return kept;
  }

  /** Whether a point lies on a track (a matched shape is made of track nodes and points projected onto edges). */
  onTrack(point: Lonlat, toleranceMeters = .05) {
    const k = Math.cos(point[1] * Math.PI / 180), cx = Math.floor(point[0] / CELL_DEGREES), cy = Math.floor(point[1] / CELL_DEGREES);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (const edge of this.cells.get(`${x},${y}`) ?? []) if (this.project(edge, point, k).distance <= toleranceMeters) return true;
    return false;
  }

  /** Shortest paths along the tracks from one position to others, up to a distance. */
  routes(from: Candidate, targets: Candidate[], limit: number): ({ meters: number; path: Lonlat[] } | null)[] {
    const start = this.edges[from.edge], distance = new Map<number, number>(), previous = new Map<number, number>();
    distance.set(start.a, from.t * start.meters); distance.set(start.b, (1 - from.t) * start.meters);
    const open = new Set([start.a, start.b]), done = new Set<number>();
    while (open.size) {
      let node = -1;
      for (const id of open) if (node < 0 || distance.get(id)! < distance.get(node)!) node = id;
      open.delete(node); done.add(node);
      for (const { to, meters: length } of this.adjacency[node]) {
        const candidate = distance.get(node)! + length;
        if (done.has(to) || candidate > limit || candidate >= (distance.get(to) ?? Infinity)) continue;
        distance.set(to, candidate); previous.set(to, node); open.add(to);
      }
    }
    const trace = (node: number) => { const nodes: Lonlat[] = []; for (let id: number | undefined = node; id !== undefined; id = previous.get(id)) nodes.unshift(this.nodes[id]); return nodes; };
    return targets.map((target) => {
      const edge = this.edges[target.edge];
      let best: { meters: number; path: Lonlat[] } | null = null;
      if (target.edge === from.edge) best = { meters: Math.abs(target.t - from.t) * edge.meters, path: [from.point, target.point] };
      for (const [node, offset] of [[edge.a, target.t * edge.meters], [edge.b, (1 - target.t) * edge.meters]] as const) {
        const total = (distance.get(node) ?? Infinity) + offset;
        if (total <= limit && total < (best?.meters ?? Infinity)) best = { meters: total, path: [from.point, ...trace(node), target.point] };
      }
      return best;
    });
  }
}

/**
 * The shape along the tracks, or null when too little of it lies on them. Points
 * away from every track are kept, and the match restarts after them.
 */
export function matchToTracks(points: Lonlat[], network: TrackNetwork): Lonlat[] | null {
  const heading = (i: number): Lonlat | null => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    return a[0] === b[0] && a[1] === b[1] ? null : [b[0] - a[0], b[1] - a[1]];
  };
  type Layer = { candidates: Candidate[]; cost: number[]; back: number[]; paths: Lonlat[][] };
  const result: Lonlat[] = [];
  let run: Layer[] = [], matched = 0;
  const finish = () => {
    if (!run.length) return;
    const last = run.at(-1)!;
    let index = last.cost.indexOf(Math.min(...last.cost));
    const pieces: Lonlat[][] = [];
    for (let layer = run.length - 1; layer > 0; layer--) { pieces.unshift(run[layer].paths[index]); index = run[layer].back[index]; }
    result.push(...withoutReversals([run[0].candidates[index].point, ...pieces.flatMap((piece) => piece.slice(1))]));
    matched += run.length; run = [];
  };
  for (let i = 0; i < points.length; i++) {
    const candidates = network.candidates(points[i], heading(i));
    if (!candidates.length) { finish(); result.push(points[i]); continue; }
    const previous = run.at(-1);
    if (previous) {
      const straight = meters(points[i - 1], points[i]), limit = 2 * straight + 30;
      const layer: Layer = { candidates, cost: candidates.map(() => Infinity), back: candidates.map(() => -1), paths: candidates.map(() => []) };
      previous.candidates.forEach((from, a) => {
        if (!Number.isFinite(previous.cost[a])) return;
        const routes = network.routes(from, candidates, limit);
        routes.forEach((route, b) => {
          let length = route?.meters, path = route?.path, penalty = 0;
          if (!route) {
            if (network.edges[from.edge].service || network.edges[candidates[b].edge].service) return;
            // A hop: follow this track to the place beside the other track's position, then step across.
            const beside = routes.map((other, c) => other && meters(candidates[c].point, candidates[b].point) <= MAX_HOP_METERS ? other.meters : Infinity);
            length = Math.min(...beside);
            if (!Number.isFinite(length)) return;
            path = [from.point, candidates[b].point]; penalty = HOP_PENALTY;
          }
          const cost = previous.cost[a] + Math.abs(length! - straight) + penalty + candidates[b].cost;
          if (cost < layer.cost[b]) { layer.cost[b] = cost; layer.back[b] = a; layer.paths[b] = path!; }
        });
      });
      if (layer.cost.some(Number.isFinite)) { run.push(layer); continue; }
      finish();
    }
    run.push({ candidates, cost: candidates.map((candidate) => candidate.cost), back: candidates.map(() => -1), paths: candidates.map(() => []) });
  }
  finish();
  if (!matched || matched < points.length * network.options.minMatchedShare) return null;
  return result;
}

/** A train never reverses within a trip: a shape point a few metres behind the previous one makes the path double back; drop the tip. */
export function withoutReversals(points: Lonlat[]): Lonlat[] {
  const kept = points.filter((point, i) => i === 0 || meters(points[i - 1], point) > .05);
  for (let i = 1; i < kept.length - 1;) {
    const [a, b, c] = [kept[i - 1], kept[i], kept[i + 1]], k = Math.cos(b[1] * Math.PI / 180);
    const ux = (b[0] - a[0]) * k, uy = b[1] - a[1], vx = (c[0] - b[0]) * k, vy = c[1] - b[1];
    const cosine = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
    // Dropping a tip can leave two equal points; the second goes too.
    if (cosine < -0.85 || meters(b, c) <= .05) { kept.splice(i, 1); i = Math.max(1, i - 1); } else i++;
  }
  return kept;
}
