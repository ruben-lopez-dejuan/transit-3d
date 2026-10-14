import type { MotionAnchor } from '../../shared/transit/network';

/** Illustrative stop at a station whose published arrival equals its departure. */
export const STATION_DWELL_MS = 20_000;

/**
 * Rail timetables and ETAs often publish arrival = departure at intermediate
 * stations, so a train drawn from them only touches each platform and seems to
 * skip it. Take a short dwell out of the following run without moving the
 * published arrival. Explicit dwell, the first and the last anchor are kept.
 */
export function withStationDwell(timeline: MotionAnchor[], dwellMs = STATION_DWELL_MS): MotionAnchor[] {
  return timeline.flatMap((anchor, i) => {
    const before = timeline[i - 1], after = timeline[i + 1];
    if (!before || !after || before.progress >= anchor.progress || after.progress <= anchor.progress) return [anchor];
    const dwell = Math.min(dwellMs, (after.at - anchor.at) * .3);
    return dwell >= 3000 ? [anchor, { at: anchor.at + dwell, progress: anchor.progress }] : [anchor];
  });
}
