/**
 * The stops a departure board joins to the selected one: another operator's stop
 * at the same spot (Bilbobus and the tram sharing a platform), served in the same
 * direction. The opposite platform is left out even when the feed puts it at the
 * very same coordinates (Euskotren Q1/Q2).
 */
export const SAME_SPOT_METERS = 30;
/** Departures leaving within this angle of each other run the same way. */
const SAME_DIRECTION_DEGREES = 75;

type Point = { longitude: number; latitude: number };
const METERS_PER_DEGREE = 111_320;
const meters = (a: Point, b: Point) => Math.hypot((a.longitude - b.longitude) * METERS_PER_DEGREE * Math.cos(((a.latitude + b.latitude) / 2) * Math.PI / 180), (a.latitude - b.latitude) * METERS_PER_DEGREE);

/** Compass bearing from one point to another, in degrees. */
export function bearingDegrees(from: Point, to: Point) {
  const k = Math.cos(((from.latitude + to.latitude) / 2) * Math.PI / 180);
  return (Math.atan2((to.longitude - from.longitude) * k, to.latitude - from.latitude) * 180 / Math.PI + 360) % 360;
}
const apart = (a: number, b: number) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

/**
 * The selected stop first, then the stops beside it whose departures leave the same
 * way. `bearings` gives the directions a stop's trips leave in (towards their next
 * stop); a stop without any is kept, as nothing says it runs the other way.
 */
export function sameSpotStops<T extends Point & { key: string }>(stop: T, candidates: T[], bearings: (stop: T) => number[]): T[] {
  const own = bearings(stop);
  return [stop, ...candidates.filter((other) => {
    if (other.key === stop.key || meters(stop, other) > SAME_SPOT_METERS) return false;
    const theirs = bearings(other);
    return !own.length || !theirs.length || own.some((a) => theirs.some((b) => apart(a, b) <= SAME_DIRECTION_DEGREES));
  })];
}
