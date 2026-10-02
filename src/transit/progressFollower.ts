import type { TransitMode } from './networkTypes';

export function motionLimits(mode: TransitMode, maximum?: number) {
  return { speed: maximum ?? (mode === 'bus' ? 40 : mode === 'tram' ? 30 : mode === 'funicular' ? 8 : 75), acceleration: mode === 'bus' ? 1.2 : .8 };
}

/** Integrate a speed ramp analytically; corrections never add an unbounded catch-up speed. */
export function advanceProgress(progress: number, speed: number, seconds: number, target: number, pace: number, horizon: number, maximum: number, acceleration: number, end = Infinity) {
  const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
  const allowance = Math.max(2, Math.min(8, pace * .35));
  const correction = clamp((target - progress - pace * seconds) / horizon, -allowance, allowance);
  const desired = clamp(pace + correction, 0, maximum);
  const delta = desired - speed;
  const ramp = Math.min(seconds, Math.abs(delta) / acceleration);
  const nextSpeed = speed + Math.sign(delta) * acceleration * ramp;
  const travel = (speed + nextSpeed) * .5 * ramp + nextSpeed * (seconds - ramp);
  const next = clamp(progress + travel, 0, end);
  return { progress: next, speed: next >= end ? 0 : nextSpeed, correction };
}
