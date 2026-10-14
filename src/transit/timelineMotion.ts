import type { MotionAnchor } from './networkTypes';
import { correctionOffset, progressAt } from './motion';

/**
 * Slowest and fastest fade of a revised position, and the apparent speed of the fade itself.
 * The fade peaks at 1.5× that speed: 3 m/s keeps a revision a gentle surge or slowdown instead
 * of a lurch (at 15 m/s over 2 s a metro jumped from 10 to 19 m/s; audit 14 Oct 2026).
 */
const MIN_SETTLE_MS = 6000, MAX_SETTLE_MS = 60_000, SETTLE_METERS_PER_SECOND = 3;

/**
 * Motion of a vehicle without GPS. The drawn position is a function of the
 * timeline and the clock alone, so a reload or another device shows the same
 * place. When a new timeline moves that position, the difference fades out
 * over a few seconds instead of being chased with catch-up dynamics, and the
 * vehicle never runs backwards.
 */
/** Blend time per m/s of speed difference: a dwelling train told it is moving at 10 m/s eases in over ~50 s, about 1 m/s². */
const SETTLE_MS_PER_SPEED = 5000;
const settle = (offset: number, speedChange = 0) => Math.max(MIN_SETTLE_MS, Math.min(MAX_SETTLE_MS, Math.max(Math.abs(offset) / SETTLE_METERS_PER_SECOND * 1000, Math.abs(speedChange) * SETTLE_MS_PER_SPEED)));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
export class TimelineMotion {
  private timeline: MotionAnchor[] = [];
  private progress = 0;
  private at = 0;
  private correction: { offset: number; at: number; ms: number } | null = null;
  /** The motion drawn before this timeline arrived; the vehicle blends from it, so speed changes gradually too. */
  private blend: { from: TimelineMotion; at: number; ms: number } | null = null;
  speed = 0;
  constructor(private readonly rail: boolean, private readonly fallback: number) {}

  /**
   * Adopt a new timeline. `displayed` is where the vehicle is currently drawn, if it was drawn
   * before, and `previous` the motion that drew it: blending from it keeps both position and
   * speed continuous (fading only the position offset kept the place but changed speed at once).
   */
  retime(timeline: MotionAnchor[], now: number, displayed?: number, previous?: TimelineMotion) {
    this.timeline = timeline;
    const target = this.target(now);
    const offset = displayed === undefined ? 0 : displayed - target;
    const speedChange = previous ? previous.speed - this.speedAt(now) : 0;
    const revised = displayed !== undefined && (Math.abs(offset) > .5 || Math.abs(speedChange) > .2);
    this.blend = revised && previous ? { from: previous, at: now, ms: settle(offset, speedChange) } : null;
    this.correction = revised && !previous && Math.abs(offset) > .5 ? { offset, at: now, ms: settle(offset) } : null;
    this.progress = displayed ?? target; this.at = now;
    this.speed = previous?.speed ?? this.speedAt(now);
  }
  position(now: number, end = Infinity) {
    if (now <= this.at) return this.progress;
    let goal = this.target(now);
    if (this.blend) {
      const from = this.blend.from.position(now, end), weight = smoothstep(Math.min(1, (now - this.blend.at) / this.blend.ms));
      goal = from + (goal - from) * weight;
      if (weight >= 1) this.blend = null;
    } else if (this.correction) {
      goal += correctionOffset(this.correction.offset, this.correction.at, this.correction.ms, now);
      if (now >= this.correction.at + this.correction.ms) this.correction = null;
    }
    // A revision behind the drawn vehicle holds it until the timeline catches up.
    const next = Math.min(end, Math.max(this.progress, goal));
    this.speed = (next - this.progress) * 1000 / (now - this.at);
    this.progress = next; this.at = now;
    return next;
  }
  private target(now: number) { return progressAt(this.timeline, now, this.rail) ?? this.fallback; }
  private speedAt(now: number) { return (this.target(now + 50) - this.target(now)) * 20; }
}
