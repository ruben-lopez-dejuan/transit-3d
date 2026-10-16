import type { Shape } from './networkTypes';
import { positionAlong } from './motion';
import { compositionFor, type StyledVehicle } from '../../shared/transit/appearance';

export const composition = compositionFor;
/** Each car samples the track separately; offsets are a diagrammatic separation. */
/** Half the chord whose direction a car takes: it turns through a vertex instead of snapping at it. */
const HEADING_CHORD_METERS = 5;
function heading(shape: Shape, progress: number, fallback: number) {
  const behind = positionAlong(shape, progress - HEADING_CHORD_METERS)?.coordinate, ahead = positionAlong(shape, progress + HEADING_CHORD_METERS)?.coordinate;
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
/** How much of the lateral offset applies here: none on a stretch drawn on the vehicle's own track. */
function offTrack(shape: Shape, progress: number, ramp: number) {
  let factor = 1;
  for (const range of shape.onTrack ?? []) factor = Math.min(factor, smooth(Math.max(range.from - progress, progress - range.to, 0) / ramp));
  return factor;
}
export function vehiclePose(shape: Shape, progress: number, vehicle: StyledVehicle, lateralScale = 1) {
  const located = positionAlong(shape, progress); if (!located) return null;
  const position = { coordinate: located.coordinate, bearing: heading(shape, progress, located.bearing) };
  const rail = vehicle.mode === 'rail' || vehicle.mode === 'tram';
  const lateral = (vehicle.appearance?.lateralOffsetMeters ?? (rail ? 1.7 : 0)) * lateralScale * offTrack(shape, progress, ON_TRACK_RAMP_METERS * Math.max(1, lateralScale));
  const angle = position.bearing * Math.PI / 180;
  const coordinate: [number, number] = [position.coordinate[0] + lateral * Math.cos(angle) / (111320 * Math.cos(position.coordinate[1] * Math.PI / 180)), position.coordinate[1] - lateral * Math.sin(angle) / 110540];
  const { depth, slope, tunnel } = trackDepth(shape, progress);
  // `buried`: how much of the car is below ground, 0 on the surface to 1 inside the tunnel.
  // `slope`: metres of descent per metre travelled, so a car can follow the gradient.
  return { coordinate, bearing: position.bearing, altitude: depth ? -depth : 0, slope, buried: Math.min(1, depth / COVER_METERS), underground: tunnel && depth >= COVER_METERS };
}
