import type { TransitMode } from './networkTypes';

export function motionLimits(mode: TransitMode, maximum?: number) {
  return { speed: maximum ?? (mode === 'bus' ? 40 : mode === 'tram' ? 30 : mode === 'funicular' ? 8 : 75), acceleration: mode === 'bus' ? 1.2 : .8 };
}

/** Integrate a speed ramp analytically. Fresh forward errors increase catch-up
 * continuously, while acceleration, braking and the mode speed cap remain hard bounds. */
export function advanceProgress(progress: number, speed: number, seconds: number, target: number, pace: number, cadenceSeconds: number, maximum: number, acceleration: number, end = Infinity) {
  const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
  const error = target - progress - pace * seconds;
  const cadence = clamp(cadenceSeconds, 5, 180);
  const uncertainty = Math.max(12, pace * cadence * .45);
  const urgency = Math.max(0, error) / (Math.max(0, error) + uncertainty);
  const settleSeconds = clamp(cadence * (.45 - .3 * urgency), 4, 45);
  const gentle = Math.max(2, Math.min(8, pace * .35));
  const forwardLimit = gentle + urgency * Math.max(0, maximum - pace - gentle);
  const correction = clamp(error / settleSeconds, -Math.min(gentle, pace), Math.max(0, forwardLimit));
  const desired = clamp(pace + correction, 0, maximum);
  const delta = desired - speed;
  const ramp = Math.min(seconds, Math.abs(delta) / acceleration);
  const nextSpeed = speed + Math.sign(delta) * acceleration * ramp;
  const travel = (speed + nextSpeed) * .5 * ramp + nextSpeed * (seconds - ramp);
  const unconstrained = clamp(progress + travel, 0, end);
  // Never run beyond the current forward reference: doing so turns catch-up
  // into an oscillation on the next frame. A reference behind only slows us.
  const next = target >= progress ? Math.min(unconstrained, target) : unconstrained;
  return { progress: next, speed: next >= end ? 0 : next >= target && target >= progress ? Math.min(nextSpeed, pace) : nextSpeed, correction };
}
