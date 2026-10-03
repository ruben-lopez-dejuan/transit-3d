import type { MotionAnchor, TransitMode } from './networkTypes';
import { progressAt } from './motion';
import { advanceProgress, motionLimits } from './progressFollower';

type Options = {
  mode: TransitMode;
  timeline: MotionAnchor[];
  previous?: MotionAnchor | null;
  speed?: number | null;
  stopped?: boolean;
  maximumSpeed?: number;
  realtimeTimetable?: boolean;
  forecastTimestamp?: number | null;
};
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const freshness = 180_000;

/** One-dimensional prediction. Source timestamps set pace; HTTP timestamps never do. */
export class GpsMotion {
  private observation: MotionAnchor | null = null;
  private previous: MotionAnchor | null = null;
  private timeline: MotionAnchor[] = [];
  private lastAt: number | null = null;
  private progress = 0;
  private velocity = 0;
  private sourceSpeed = 0;
  private maximumSpeed = 40;
  private acceleration = 1.2;
  private cadence = 30_000;
  private hasCadence = false;
  private measuredSpeed = false;
  private lastInterval: number | null = null;
  private stopped = false;
  private target = 0;
  private correction = 0;
  private rejection: string | null = null;
  private end = Infinity;
  private forecastTimestamp = 0;
  constructor(private readonly seed?: { progress: number; speed: number }) {}

  update(observation: MotionAnchor, now: number, options: Options) {
    this.position(now);
    if (!Number.isFinite(observation.at) || !Number.isFinite(observation.progress) || observation.progress < 0 || observation.at > now + 60_000 || now - observation.at > freshness) {
      this.rejection = 'invalid/stale source timestamp or progress'; return false;
    }
    if (this.observation && observation.at <= this.observation.at) {
      if (observation.at !== this.observation.at || Math.abs(observation.progress - this.observation.progress) >= 2) this.rejection = 'regressive/conflicting observation';
      else if (options.forecastTimestamp && options.forecastTimestamp > this.forecastTimestamp) {
        this.timeline = options.timeline; this.forecastTimestamp = options.forecastTimestamp;
      }
      return false;
    }
    const limits = motionLimits(options.mode, options.maximumSpeed), maximum = limits.speed;
    const previous = this.observation ?? options.previous ?? null;
    const interval = previous ? observation.at - previous.at : 0;
    const measured = previous && interval > 0 && interval < freshness ? (observation.progress - previous.progress) * 1000 / interval : null;
    if (measured !== null && (measured > maximum || measured < -maximum || observation.progress < previous!.progress - 75)) {
      this.rejection = 'implausible source speed'; return false;
    }
    this.maximumSpeed = maximum;
    this.acceleration = limits.acceleration;
    this.lastInterval = interval > 0 ? interval / 1000 : null;
    if (interval > 0 && interval < freshness) {
      this.cadence = this.hasCadence ? this.cadence * .5 + interval * .5 : interval;
      this.hasCadence = true;
    }
    this.previous = previous;
    this.observation = observation;
    this.stopped = !!options.stopped || options.speed === 0 || (measured !== null && Math.abs(observation.progress - previous!.progress) < 2);
    this.timeline = options.timeline;
    const reported = options.speed != null && Number.isFinite(options.speed) && options.speed >= 0 && options.speed <= maximum ? options.speed : measured;
    this.sourceSpeed = clamp(reported ?? this.planSpeed(observation.at), 0, maximum);
    this.measuredSpeed = reported !== null;
    this.forecastTimestamp = options.forecastTimestamp ?? 0;
    if (!options.realtimeTimetable && reported !== null && reported > 0 && this.timeline.length > 1) {
      // A theoretical timetable must not accelerate a late bus to scheduled pace.
      // Estimate future travel at observed pace, retaining explicit station dwell.
      let at = observation.at;
      this.timeline = this.timeline.map((anchor, i, plan) => {
        if (i === 0) return observation;
        const distance = Math.max(0, anchor.progress - plan[i - 1].progress);
        at += distance > 0 ? distance / this.sourceSpeed * 1000 : Math.max(0, anchor.at - plan[i - 1].at);
        return { at, progress: anchor.progress };
      });
    }
    this.rejection = null;
    // Only the first appearance has no displayed position to preserve.
    if (this.lastAt === null) {
      this.progress = this.seed?.progress ?? this.reference(now);
      this.velocity = clamp(this.seed?.speed ?? (this.stopped ? 0 : this.referenceSpeed(now)), 0, maximum);
      this.lastAt = now;
    }
    // New data must not be applied retroactively across a stale/suspended interval.
    this.lastAt = now;
    this.target = this.reference(now);
    return true;
  }

  setEnd(meters: number) { if (Number.isFinite(meters) && meters >= 0) this.end = meters; }

  private planSpeed(at: number) {
    for (let i = 1; i < this.timeline.length; i++) {
      const a = this.timeline[i - 1], b = this.timeline[i];
      if (at >= a.at && at < b.at) return Math.max(0, (b.progress - a.progress) * 1000 / (b.at - a.at));
    }
    return 0;
  }
  private reference(at: number) {
    const observation = this.observation!;
    const time = clamp(at, observation.at, observation.at + freshness);
    if (this.stopped) return Math.min(this.end, observation.progress);
    const plan = this.timeline;
    const planned = plan.length > 1 ? progressAt(plan, time) : null;
    const pace = this.planSpeed(time);
    // Timetable/ETA is an estimate, and cannot justify an impossible velocity.
    const validPlan = planned !== null && planned >= observation.progress && pace <= this.maximumSpeed;
    const target = validPlan ? planned : observation.progress + this.sourceSpeed * (time - observation.at) / 1000;
    return clamp(target, 0, this.end);
  }
  private referenceSpeed(at: number) {
    if (this.stopped || !this.observation || at >= this.observation.at + freshness) return 0;
    return clamp((this.reference(at + 250) - this.reference(at)) * 4, 0, this.maximumSpeed);
  }

  position(now: number): number | null {
    if (!this.observation || this.lastAt === null) return null;
    const at = Math.max(this.lastAt, Math.min(now, this.observation.at + freshness));
    const dt = (at - this.lastAt) / 1000;
    if (dt <= 0) return this.progress;
    this.target = this.reference(at);
    const pace = this.referenceSpeed(at);
    const stop = this.timeline.find((anchor) => anchor.at >= at && anchor.progress > this.observation!.progress && anchor.progress >= this.progress);
    const brakingLimit = stop ? Math.sqrt(2 * this.acceleration * Math.max(0, stop.progress - this.progress - this.velocity * dt)) : this.maximumSpeed;
    const cadenceSeconds = this.cadence / 1000;
    const next = advanceProgress(this.progress, this.velocity, dt, this.target, pace, cadenceSeconds, Math.min(this.maximumSpeed, brakingLimit), this.acceleration, this.end);
    this.progress = next.progress; this.velocity = next.speed; this.correction = next.correction;
    this.lastAt = at;
    return this.progress;
  }

  get quality(): 'real' | 'interpolated' | 'estimated' {
    if (!this.observation) return 'estimated';
    if (Math.abs(this.progress - this.observation.progress) < .5) return 'real';
    return this.previous && this.progress >= this.previous.progress && this.progress < this.observation.progress ? 'interpolated' : 'estimated';
  }
  get diagnostics() {
    return { sourceTimestamp: this.observation?.at ?? null, motionTimestamp: this.lastAt, renderedProgress: this.progress, predictedProgress: this.target, renderedSpeed: this.velocity, sourceSpeed: this.measuredSpeed ? this.sourceSpeed : null, predictionPace: this.sourceSpeed, cadenceSeconds: this.hasCadence ? this.cadence / 1000 : null, lastIntervalSeconds: this.lastInterval, correctionSpeed: this.correction, correctionErrorMeters: this.target - this.progress, rejected: this.rejection };
  }
}
