import type { MotionAnchor } from './networkTypes';
import { correctionOffset, progressAt } from './motion';

/** Slowest and fastest fade of a revised position, and the apparent speed of the fade itself. */
const MIN_SETTLE_MS = 2000, MAX_SETTLE_MS = 20_000, SETTLE_METERS_PER_SECOND = 15;

/**
 * Motion of a vehicle without GPS. The drawn position is a function of the
 * timeline and the clock alone, so a reload or another device shows the same
 * place. When a new timeline moves that position, the difference fades out
 * over a few seconds instead of being chased with catch-up dynamics, and the
 * vehicle never runs backwards.
 */
export class TimelineMotion {
  private timeline: MotionAnchor[] = [];
  private progress = 0;
  private at = 0;
  private correction: { offset: number; at: number; ms: number } | null = null;
  speed = 0;
  constructor(private readonly rail: boolean, private readonly fallback: number) {}

  /** Adopt a new timeline. `displayed` is where the vehicle is currently drawn, if it was drawn before. */
  retime(timeline: MotionAnchor[], now: number, displayed?: number) {
    this.timeline = timeline;
    const target = this.target(now);
    const offset = displayed === undefined ? 0 : displayed - target;
    this.correction = Math.abs(offset) > .5 ? { offset, at: now, ms: Math.max(MIN_SETTLE_MS, Math.min(MAX_SETTLE_MS, Math.abs(offset) / SETTLE_METERS_PER_SECOND * 1000)) } : null;
    this.progress = displayed ?? target; this.at = now;
  }
  position(now: number, end = Infinity) {
    if (now <= this.at) return this.progress;
    const offset = this.correction ? correctionOffset(this.correction.offset, this.correction.at, this.correction.ms, now) : 0;
    if (this.correction && now >= this.correction.at + this.correction.ms) this.correction = null;
    // A revision behind the drawn vehicle holds it until the timeline catches up.
    const next = Math.min(end, Math.max(this.progress, this.target(now) + offset));
    this.speed = (next - this.progress) * 1000 / (now - this.at);
    this.progress = next; this.at = now;
    return next;
  }
  private target(now: number) { return progressAt(this.timeline, now, this.rail) ?? this.fallback; }
}
