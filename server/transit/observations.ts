import type { TransitMode } from './types';
export type MotionObservation = { at: number; progress: number; stoppedAtStop?: boolean };
type State = { current: MotionObservation; previous: MotionObservation | null; speed: number | null; seenAt: number };
/** Timestamps are source milliseconds; HTTP polling must not generate new observations. */
export class ObservationTracker {
  private states = new Map<string, State>();
  rejected = 0;
  latest(key: string, now: number) { const state = this.states.get(key); return state && now - state.current.at <= 180_000 ? state : null; }
  accept(key: string, observation: MotionObservation, mode: TransitMode, now: number, maximumSpeed?: number) {
    const previous = this.states.get(key);
    if (!Number.isFinite(observation.at) || !Number.isFinite(observation.progress) || observation.progress < 0 || now - observation.at > 180_000 || observation.at - now > 60_000) return null;
    if (previous && observation.at <= previous.current.at) {
      if (observation.at === previous.current.at && Math.abs(observation.progress - previous.current.progress) < 2) return previous;
      this.rejected++; return null;
    }
    let speed: number | null = null;
    if (previous && observation.at - previous.current.at < 180_000) {
      const distance = observation.progress - previous.current.progress;
      speed = distance / ((observation.at - previous.current.at) / 1000);
      const maximum = maximumSpeed ?? (mode === 'bus' ? 40 : mode === 'tram' ? 30 : 75);
      if (distance < -75 || Math.abs(speed) > maximum) { this.rejected++; return null; }
    }
    const contiguous = previous && observation.at - previous.current.at < 180_000;
    const state = { current: observation, previous: contiguous ? previous.current : null, speed: speed === null ? null : Math.max(0, speed), seenAt: now };
    this.states.set(key, state);
    if (this.states.size > 2000) for (const [id, value] of this.states) if (now - value.seenAt > 600_000) this.states.delete(id);
    return state;
  }
}
