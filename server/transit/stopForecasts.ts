import type { MotionAnchor } from '../../shared/transit/network';

/** A provider (SIRI) arrival/departure forecast for one stop of the vehicle's trip. */
export type StopForecast = { at: number; departure: number; progress: number; sourceTimestamp: number; scheduledArrival: number };

const SAME_STOP_METERS = 2;

/** Time at which a timeline reaches `progress`; `departure` returns the end of a dwell at that position. */
export function timeAtProgress(timeline: MotionAnchor[], progress: number, edge: 'arrival' | 'departure' = 'arrival'): number | null {
  const exact = timeline.filter((anchor) => Math.abs(anchor.progress - progress) <= SAME_STOP_METERS);
  if (exact.length) return edge === 'arrival' ? exact[0].at : exact[exact.length - 1].at;
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1], b = timeline[i];
    if (a.progress < progress && b.progress > progress) return a.at + (b.at - a.at) * (progress - a.progress) / (b.progress - a.progress);
  }
  return null;
}

/**
 * Stop forecasts take precedence at the stops they cover. Between and after
 * them the base timeline (GTFS-RT, provider estimate or timetable) keeps
 * supplying the pace, stretched to pass through the forecasts, so partial
 * coverage never ends the vehicle's motion at the last forecast stop.
 */
export function mergeStopForecasts(base: MotionAnchor[], forecasts: StopForecast[]): MotionAnchor[] {
  if (!forecasts.length) return base;
  const points = forecasts.map((forecast) => ({ ...forecast, baseArrival: timeAtProgress(base, forecast.progress, 'arrival'), baseDeparture: timeAtProgress(base, forecast.progress, 'departure') }));
  const first = points[0], last = points[points.length - 1];
  const anchors: MotionAnchor[] = [];
  for (const anchor of base) {
    if (points.some((point) => Math.abs(point.progress - anchor.progress) <= SAME_STOP_METERS)) continue;
    let at: number | null;
    if (anchor.progress < first.progress) at = anchor.at + (first.baseArrival === null ? 0 : first.at - first.baseArrival);
    else if (anchor.progress > last.progress) at = last.baseDeparture === null ? null : anchor.at + last.departure - last.baseDeparture;
    else {
      const index = points.findIndex((point) => point.progress > anchor.progress);
      const from = points[index - 1], to = points[index];
      const span = from.baseDeparture !== null && to.baseArrival !== null ? to.baseArrival - from.baseDeparture : 0;
      const fraction = span > 0 ? (anchor.at - from.baseDeparture!) / span : (anchor.progress - from.progress) / (to.progress - from.progress);
      at = from.departure + Math.max(0, Math.min(1, fraction)) * (to.at - from.departure);
    }
    if (at !== null) anchors.push({ at, progress: anchor.progress });
  }
  for (const forecast of forecasts) {
    anchors.push({ at: forecast.at, progress: forecast.progress });
    if (forecast.departure > forecast.at) anchors.push({ at: forecast.departure, progress: forecast.progress });
  }
  anchors.sort((a, b) => a.progress - b.progress || a.at - b.at);
  // A vehicle never moves backwards in time along its shape.
  const result: MotionAnchor[] = [];
  for (const anchor of anchors) if (!result.length || anchor.at >= result[result.length - 1].at) result.push(anchor);
  return result;
}
