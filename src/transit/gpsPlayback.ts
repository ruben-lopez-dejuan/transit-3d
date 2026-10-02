import type { MotionAnchor } from './networkTypes';

/** Buffered GPS playback advances by source time. Repeated HTTP replies never restart it. */
export class GpsPlayback {
  private observations: MotionAnchor[] = [];
  private cursor: number | null = null;
  private lastRender: number | null = null;
  append(observation: MotionAnchor, previous?: MotionAnchor | null) {
    if (!this.observations.length && previous && previous.at < observation.at) this.observations.push(previous);
    if (!this.observations.length || observation.at > this.observations.at(-1)!.at) this.observations.push(observation);
    if (this.cursor === null) this.cursor = this.observations[0].at;
  }
  position(now: number): number | null {
    if (!this.observations.length || this.cursor === null) return null;
    const elapsed = this.lastRender === null ? 0 : Math.max(0, now - this.lastRender);
    this.lastRender = now;
    this.cursor = Math.min(this.observations.at(-1)!.at, this.cursor + elapsed);
    while (this.observations.length > 2 && this.observations[1].at < this.cursor) this.observations.shift();
    const next = this.observations.findIndex((o) => o.at >= this.cursor!);
    if (next <= 0) return this.observations[0].progress;
    const a = this.observations[next - 1], b = this.observations[next];
    const fraction = (this.cursor - a.at) / Math.max(1, b.at - a.at);
    return a.progress + (b.progress - a.progress) * fraction;
  }
  get interpolated() { return this.observations.length > 1; }
  get renderedAt() { return this.cursor; }
}
