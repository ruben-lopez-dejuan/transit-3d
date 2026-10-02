import type { TransitMode } from './types';
export type MotionObservation = { at: number; progress: number };
type State = { current: MotionObservation; previous: MotionObservation | null; speed: number | null; seenAt: number };
/** Timestamps are source milliseconds; HTTP polling must not generate new observations. */
export class ObservationTracker {
  private states = new Map<string, State>();
  rejected = 0;
  accept(key: string, observation: MotionObservation, mode: TransitMode, now: number) {
    const previous = this.states.get(key);
    if (now - observation.at > 180_000 || observation.at - now > 60_000) return null;
    if (previous && observation.at <= previous.current.at) {
      if (observation.at === previous.current.at && Math.abs(observation.progress - previous.current.progress) < 2) return previous;
      this.rejected++; return null;
    }
    let speed: number | null = null;
    if (previous && observation.at - previous.current.at < 180_000) {
      const distance = observation.progress - previous.current.progress;
      speed = distance / ((observation.at - previous.current.at) / 1000);
      const maximum = mode === 'bus' ? 40 : mode === 'tram' ? 30 : 75;
      if (distance < -75 || speed > maximum) { this.rejected++; return null; }
    }
    const state = { current: observation, previous: previous?.current ?? null, speed: speed === null ? null : Math.max(0, speed), seenAt: now };
    this.states.set(key, state);
    if (this.states.size > 2000) for (const [id, value] of this.states) if (now - value.seenAt > 600_000) this.states.delete(id);
    return state;
  }
}
