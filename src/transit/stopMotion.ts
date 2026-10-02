import type { MotionAnchor } from './networkTypes';
/** A short illustrative stop only when the timetable omits dwell; GPS is never altered. */
export function estimatedBusDwell(timeline: MotionAnchor[]): MotionAnchor[] {
  return timeline.flatMap((anchor, i) => {
    const before = timeline[i - 1], after = timeline[i + 1];
    return before && after && before.progress < anchor.progress && after.progress > anchor.progress && after.at - anchor.at > 60_000
      ? [anchor, { at: anchor.at + 6000, progress: anchor.progress }] : [anchor];
  });
}
