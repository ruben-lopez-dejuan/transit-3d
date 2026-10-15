import { REALTIME_MAX_AGE_MS } from '../../shared/transit/freshness';
import type { TransitMode } from './types';
export type MotionObservation = { at: number; progress: number; stoppedAtStop?: boolean };
/**
 * `speed` is the pace between the last two fixes; `pace` the average over about the last
 * PACE_WINDOW_MS of contiguous fixes. A bus between two fixes may have waited at a light or
 * a stop, so over the next minute the longer average predicts it much better (audit 15 Oct
 * 2026: 78 m against 98 m median error 40 s ahead for Bilbobus, and unbiased).
 */
type State = { current: MotionObservation; previous: MotionObservation | null; speed: number | null; pace: number | null; recent: MotionObservation[]; seenAt: number };
const PACE_WINDOW_MS = 240_000;
/** Shorter spans say little about the pace of stop-and-go traffic. */
const MIN_PACE_SPAN_MS = 40_000;
function averagePace(recent: MotionObservation[]) {
  const current = recent.at(-1)!;
  const reference = [...recent].reverse().find((item) => current.at - item.at >= PACE_WINDOW_MS) ?? recent[0];
  const span = current.at - reference.at;
  return span >= MIN_PACE_SPAN_MS ? Math.max(0, (current.progress - reference.progress) * 1000 / span) : null;
}
/** Timestamps are source milliseconds; HTTP polling must not generate new observations. */
export class ObservationTracker {
  private states = new Map<string, State>();
  rejected = 0;
  latest(key: string, now: number) { const state = this.states.get(key); return state && now - state.current.at <= REALTIME_MAX_AGE_MS ? state : null; }
  accept(key: string, observation: MotionObservation, mode: TransitMode, now: number, maximumSpeed?: number) {
    const previous = this.states.get(key);
    if (!Number.isFinite(observation.at) || !Number.isFinite(observation.progress) || observation.progress < 0 || now - observation.at > REALTIME_MAX_AGE_MS || observation.at - now > 60_000) return null;
    if (previous && observation.at <= previous.current.at) {
      if (observation.at === previous.current.at && Math.abs(observation.progress - previous.current.progress) < 2) return previous;
      this.rejected++; return null;
    }
    let speed: number | null = null;
    if (previous && observation.at - previous.current.at < REALTIME_MAX_AGE_MS) {
      const distance = observation.progress - previous.current.progress;
      speed = distance / ((observation.at - previous.current.at) / 1000);
      const maximum = maximumSpeed ?? (mode === 'bus' ? 40 : mode === 'tram' ? 30 : 75);
      if (distance < -75 || Math.abs(speed) > maximum) { this.rejected++; return null; }
    }
    const contiguous = previous && observation.at - previous.current.at < REALTIME_MAX_AGE_MS;
    // Keep just enough history for the pace window, plus the fix that opens it.
    const recent = [...(contiguous ? previous.recent : []), observation].filter((item, i, list) => i >= list.length - 2 || observation.at - list[i + 1].at < PACE_WINDOW_MS);
    const state = { current: observation, previous: contiguous ? previous.current : null, speed: speed === null ? null : Math.max(0, speed), pace: averagePace(recent), recent, seenAt: now };
    this.states.set(key, state);
    if (this.states.size > 2000) for (const [id, value] of this.states) if (now - value.seenAt > 600_000) this.states.delete(id);
    return state;
  }
}
