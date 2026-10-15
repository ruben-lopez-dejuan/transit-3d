/**
 * The stops a departure board joins to the selected one: another operator's stop
 * at the same spot (Bilbobus and the tram sharing a platform), served in the same
 * direction. The opposite platform is left out even when the feed puts it at the
 * very same coordinates (Euskotren Q1/Q2).
 */
export const SAME_SPOT_METERS = 30;
/** Platforms of one station can stand this far apart (Euskotren Q1/Q2 a few metres, longer platforms more). */
const STATION_METERS = 150;
/** Departures leaving within this angle of each other run the same way. */
const SAME_DIRECTION_DEGREES = 75;

type Point = { longitude: number; latitude: number };
type Platform = Point & { key: string; name?: string; operatorId?: string; modes?: readonly string[] };
const METERS_PER_DEGREE = 111_320;
const meters = (a: Point, b: Point) => Math.hypot((a.longitude - b.longitude) * METERS_PER_DEGREE * Math.cos(((a.latitude + b.latitude) / 2) * Math.PI / 180), (a.latitude - b.latitude) * METERS_PER_DEGREE);

/** Compass bearing from one point to another, in degrees. */
export function bearingDegrees(from: Point, to: Point) {
  const k = Math.cos(((from.latitude + to.latitude) / 2) * Math.PI / 180);
  return (Math.atan2((to.longitude - from.longitude) * k, to.latitude - from.latitude) * 180 / Math.PI + 360) % 360;
}
const apart = (a: number, b: number) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

/**
 * Two platforms of one train or metro station: Euskotren publishes each platform (Q1, Q2)
 * as its own stop with the station's name. A station serves both directions, unlike a
 * tram or bus stop on either side of a street.
 */
export function sameStation(a: Platform, b: Platform) {
  const station = (stop: Platform) => !!stop.modes?.some((mode) => mode === 'rail' || mode === 'funicular');
  return station(a) && station(b) && a.operatorId === b.operatorId && !!a.name && a.name === b.name && meters(a, b) <= STATION_METERS;
}
/**
 * The selected stop first, then the other platforms of its station, then the stops beside
 * it whose departures leave the same way. `bearings` gives the directions a stop's trips
 * leave in (towards their next stop); a stop without any is kept, as nothing says it runs
 * the other way.
 */
export function sameSpotStops<T extends Platform>(stop: T, candidates: T[], bearings: (stop: T) => number[]): T[] {
  const platforms = candidates.filter((other) => other.key !== stop.key && sameStation(stop, other));
  const own = [stop, ...platforms].flatMap(bearings);
  return [stop, ...platforms, ...candidates.filter((other) => {
    if (other.key === stop.key || platforms.includes(other) || meters(stop, other) > SAME_SPOT_METERS) return false;
    const theirs = bearings(other);
    return !own.length || !theirs.length || own.some((a) => theirs.some((b) => apart(a, b) <= SAME_DIRECTION_DEGREES));
  })];
}
