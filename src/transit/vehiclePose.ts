import type { Shape } from './networkTypes';
import { positionAlong } from './motion';
import { compositionFor, type StyledVehicle } from '../../shared/transit/appearance';

export const composition = compositionFor;
/** Each car samples the track separately; offsets are a diagrammatic separation. */
/** Half the chord whose direction a car takes: it turns through a vertex instead of snapping at it. */
const HEADING_CHORD_METERS = 5;
/** A shape turning back by more than this at a vertex (cosine) is a reversal, not a curve. */
const REVERSAL_COSINE = -.85;
const reversalCache = new WeakMap<Shape, number[]>();
/**
 * Where a shape turns back on itself, in metres along it: a train backing out of a dead end
 * (E3 at Sondika enters the platform from Larrondo and leaves the same way towards Ola).
 */
export function reversals(shape: Shape) {
  let found = reversalCache.get(shape);
  if (found) return found;
  found = [];
  const { coordinates: points, cumulative } = shape;
  for (let i = 1; i < points.length - 1; i++) {
    // Neighbours a metre or more away, so a repeated point does not hide the turn.
    let a = i - 1, b = i + 1;
    while (a > 0 && cumulative[i] - cumulative[a] < 1) a--;
    while (b < points.length - 1 && cumulative[b] - cumulative[i] < 1) b++;
    const k = Math.cos(points[i][1] * Math.PI / 180);
    const ux = (points[i][0] - points[a][0]) * k, uy = points[i][1] - points[a][1], vx = (points[b][0] - points[i][0]) * k, vy = points[b][1] - points[i][1];
    if ((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1) < REVERSAL_COSINE) found.push(cumulative[i]);
  }
  reversalCache.set(shape, found);
  return found;
}
function heading(shape: Shape, progress: number, fallback: number) {
  let from = progress - HEADING_CHORD_METERS, to = progress + HEADING_CHORD_METERS;
  // At a reversal the chord would join the two ways of the dead end: take the one the car is on.
  const reversal = reversals(shape).find((at) => Math.abs(at - progress) < HEADING_CHORD_METERS);
  if (reversal !== undefined) [from, to] = progress <= reversal ? [reversal - 2 * HEADING_CHORD_METERS, reversal] : [reversal, reversal + 2 * HEADING_CHORD_METERS];
  const behind = positionAlong(shape, from)?.coordinate, ahead = positionAlong(shape, to)?.coordinate;
  if (!behind || !ahead || (behind[0] === ahead[0] && behind[1] === ahead[1])) return fallback;
  return (Math.atan2((ahead[0] - behind[0]) * Math.cos(ahead[1] * Math.PI / 180), ahead[1] - behind[1]) * 180 / Math.PI + 360) % 360;
}
/**
 * Track profile at a portal, after the real ones: an open cutting leads down to the tunnel
 * mouth, where the roof of the train is just under ground level, and the line keeps
 * descending to its depth inside. A smooth S curve over 360 m (at most 5 %), never a kink.
 */
export const CUTTING_METERS = 165, DESCENT_METERS = 195;
/** Tallest rail car up to its pantograph (Renfe, 3.95 m body), in metres: deeper than this the whole car is under ground. */
export const COVER_METERS = 5.1;
const smooth = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const smoothSlope = (t: number) => t <= 0 || t >= 1 ? 0 : 6 * t * (1 - t);
/** How far below ground the track runs here (metres, ≥ 0) and how fast it descends along the shape. */
export function trackDepth(shape: Shape, progress: number) {
  let depth = 0, slope = 0, tunnel = false;
  const span = CUTTING_METERS + DESCENT_METERS;
  for (const range of shape.underground ?? []) {
    if (progress < range.from - CUTTING_METERS || progress > range.to + CUTTING_METERS) continue;
    tunnel ||= progress >= range.from && progress <= range.to;
    // An underground terminus has no portal: the tunnel goes on past the end of the shape.
    const entry = range.tunnelBeforeStart ? 1 : smooth((progress - range.from + CUTTING_METERS) / span);
    const exit = range.tunnelAfterEnd ? 1 : smooth((range.to - progress + CUTTING_METERS) / span);
    const value = range.depthMeters * Math.min(entry, exit);
    if (value <= depth) continue;
    depth = value;
    slope = entry < exit ? range.depthMeters * smoothSlope((progress - range.from + CUTTING_METERS) / span) / span
      : exit < 1 ? -range.depthMeters * smoothSlope((range.to - progress + CUTTING_METERS) / span) / span : 0;
  }
  return { depth, slope, tunnel };
}
/**
 * A train slides from its diagrammatic offset onto a stretch drawn on its own track over this
 * many metres, times the widening of the model when zoomed out (so is the offset).
 */
export const ON_TRACK_RAMP_METERS = 40;
/** Beside its own track, a widened model moves this far per unit of widening, so it stays clear of the other direction. */
export const ON_TRACK_SEPARATION_METERS = 1.7;
/**
 * How much of the diagrammatic offset applies here (none on a stretch drawn on the vehicle's
 * own track), and the side of the tracks trains run on there.
 */
function offTrack(shape: Shape, progress: number, ramp: number) {
  let factor = 1, side = 1;
  for (const range of shape.onTrack ?? []) {
    const value = smooth(Math.max(range.from - progress, progress - range.to, 0) / ramp);
    if (value < factor) { factor = value; side = range.runsOn === 'left' ? -1 : 1; }
  }
  return { factor, side };
}
/**
 * Around a reversal a train runs in and out of a dead end on one track: no diagrammatic offset,
 * which would put it on the other side as it leaves, along a train's length from the turn
 * and then back to it over the ramp.
 */
export const REVERSAL_CLEAR_METERS = 100;
function offReversal(shape: Shape, progress: number, scale: number) {
  let factor = 1;
  for (const at of reversals(shape)) factor = Math.min(factor, smooth((Math.abs(progress - at) - REVERSAL_CLEAR_METERS * scale) / (ON_TRACK_RAMP_METERS * scale)));
  return factor;
}
/**
 * Where the leading end of a train is. Cars trail the leading end; a train that backs out of a
 * dead end (a reversal of its shape) leaves led by the car that arrived last, so it starts a
 * train's length further on and gives that back over the next two lengths, a little slower
 * than the timeline, instead of folding over the turn.
 */
export function leadProgress(shape: Shape, progress: number, trainMeters: number) {
  if (trainMeters <= 0) return progress;
  const span = 3 * trainMeters;
  const reversal = reversals(shape).filter((at) => at <= progress && progress < at + span).at(-1);
  return reversal === undefined ? progress : progress + trainMeters * (1 - (progress - reversal) / span);
}
export function vehiclePose(shape: Shape, progress: number, vehicle: StyledVehicle, lateralScale = 1) {
  const located = positionAlong(shape, progress); if (!located) return null;
  const position = { coordinate: located.coordinate, bearing: heading(shape, progress, located.bearing) };
  const rail = vehicle.mode === 'rail' || vehicle.mode === 'tram';
  // On its own track a train needs no offset, only what keeps it clear of the other direction
  // when the model is widened at low zoom, towards the side trains run on.
  const scale = Math.max(1, lateralScale), { factor, side } = offTrack(shape, progress, ON_TRACK_RAMP_METERS * scale);
  const offset = (vehicle.appearance?.lateralOffsetMeters ?? (rail ? 1.7 : 0)) * lateralScale * factor + (rail ? side * ON_TRACK_SEPARATION_METERS * (scale - 1) * (1 - factor) : 0);
  const lateral = offset * offReversal(shape, progress, scale);
  const angle = position.bearing * Math.PI / 180;
  const coordinate: [number, number] = [position.coordinate[0] + lateral * Math.cos(angle) / (111320 * Math.cos(position.coordinate[1] * Math.PI / 180)), position.coordinate[1] - lateral * Math.sin(angle) / 110540];
  const { depth, slope, tunnel } = trackDepth(shape, progress);
  // `buried`: how much of the car is below ground, 0 on the surface to 1 inside the tunnel.
  // `slope`: metres of descent per metre travelled, so a car can follow the gradient.
  return { coordinate, bearing: position.bearing, altitude: depth ? -depth : 0, slope, buried: Math.min(1, depth / COVER_METERS), underground: tunnel && depth >= COVER_METERS };
}
