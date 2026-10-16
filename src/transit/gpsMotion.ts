import { OFFICIAL_STOP_MAX_AGE_MS, REALTIME_MAX_AGE_MS } from '../../shared/transit/freshness';
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
  /** Timetable shifted through the GPS fix; static timing remains provisional. */
  anchoredTimeline?: boolean;
  forecastTimestamp?: number | null;
};
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const freshness = REALTIME_MAX_AGE_MS;
/** Behind a new observation by more than this, the vehicle is placed rather than chased. */
const CATCH_UP_JUMP_METERS = 800;
/** A stop report is a dwell, not a parking: after this the bus is predicted to leave. */
const stopHold = (mode: TransitMode) => mode === 'bus' ? 30_000 : 45_000;
/** A bus this close past a stop may still be at it (server/transit/officialPosition.ts). */
const AT_STOP_METERS = 15;

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
  private hold = 30_000;
  private target = 0;
  private correction = 0;
  private rejection: string | null = null;
  private end = Infinity;
  private gate: { progress: number; floor: number; source: number; until: number } | null = null;
  private forecastTimestamp = 0;
  private realtimeTimetable = false;
  private holdingForRealtimeAnchor = false;
  private recoveringToRealtimeAnchor = false;
  constructor(private readonly seed?: { progress: number; speed: number }) {}

  update(observation: MotionAnchor, now: number, options: Options) {
    this.position(now);
    if (!Number.isFinite(observation.at) || !Number.isFinite(observation.progress) || observation.progress < 0 || observation.at > now + 60_000 || now - observation.at > freshness) {
      this.rejection = 'invalid/stale source timestamp or progress'; return false;
    }
    if (this.observation && observation.at <= this.observation.at) {
      if (observation.at !== this.observation.at || Math.abs(observation.progress - this.observation.progress) >= 2) this.rejection = 'regressive/conflicting observation';
      else if (options.forecastTimestamp && options.forecastTimestamp > this.forecastTimestamp) {
        this.timeline = options.timeline; this.forecastTimestamp = options.forecastTimestamp; this.realtimeTimetable = !!options.realtimeTimetable;
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
    this.hold = stopHold(options.mode);
    this.stopped = !!options.stopped || options.speed === 0 || (measured !== null && Math.abs(observation.progress - previous!.progress) < 2);
    this.timeline = options.timeline;
    const reported = options.speed != null && Number.isFinite(options.speed) && options.speed >= 0 && options.speed <= maximum ? options.speed : measured;
    this.sourceSpeed = clamp(reported ?? this.planSpeed(observation.at), 0, maximum);
    this.measuredSpeed = reported !== null;
    this.forecastTimestamp = options.forecastTimestamp ?? 0;
    this.realtimeTimetable = !!options.realtimeTimetable;
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
    // With no observed pace, retroactively applying a theoretical timetable to
    // an old first fix invents movement. Start at the physical observation.
    // A previous real fix does justify extrapolating at its measured pace.
    const drawnBefore = this.lastAt !== null;
    if (this.lastAt === null) {
      this.progress = this.seed?.progress ?? (reported !== null ? this.reference(now) : observation.progress);
      this.velocity = clamp(this.seed?.speed ?? (this.stopped ? 0 : this.referenceSpeed(now)), 0, maximum);
      this.lastAt = now;
    }
    // New data must not be applied retroactively across a stale/suspended interval.
    this.lastAt = now;
    this.target = this.reference(now);
    // Far behind a fresh observation, the bounded chase took minutes (2.8 km after the Artxanda
    // tunnels, while the app already said the bus was arriving): place the vehicle there instead.
    if (drawnBefore && this.target - this.progress > CATCH_UP_JUMP_METERS) { this.progress = this.target; this.velocity = clamp(this.referenceSpeed(now), 0, maximum); }
    return true;
  }

  setEnd(meters: number) { if (Number.isFinite(meters) && meters >= 0) this.end = meters; }
  /**
   * The operator's stop panels still list the bus at this stop, so it has not passed it, and put it
   * at `position` when queried, so it is at least there. The drawn bus stays between the two: it
   * waits at the stop rather than running past on an old fix's pace, and moves up to where the
   * panels put it rather than lagging behind an old fix. A fresher reading or fix moves both on.
   */
  setGate(stop: { progress: number; sourceTimestamp: number; position?: number } | null | undefined) {
    this.gate = stop && Number.isFinite(stop.progress) ? { progress: stop.progress, floor: Math.min(stop.position ?? -Infinity, stop.progress), source: stop.sourceTimestamp, until: stop.sourceTimestamp + OFFICIAL_STOP_MAX_AGE_MS } : null;
  }
  private bounds(at: number) {
    // A fix newer than the reading that has reached the stop, or one clearly past it, overrides it (as on the server).
    const gate = this.gate, fix = this.observation;
    if (!gate || at > gate.until || (fix && (fix.progress > gate.progress + AT_STOP_METERS || (fix.at > gate.source && fix.progress >= gate.progress)))) return { low: 0, high: this.end };
    return { low: Math.min(gate.floor, this.end), high: Math.min(this.end, gate.progress) };
  }

  private planSpeed(at: number) {
    for (let i = 1; i < this.timeline.length; i++) {
      const a = this.timeline[i - 1], b = this.timeline[i];
      if (at >= a.at && at < b.at) return Math.max(0, (b.progress - a.progress) * 1000 / (b.at - a.at));
    }
    return 0;
  }
  private reference(at: number) {
    const { low, high } = this.bounds(at);
    return clamp(this.extrapolate(at), Math.max(0, low), high);
  }
  private extrapolate(at: number) {
    const observation = this.observation!;
    let time = clamp(at, observation.at, observation.at + freshness);
    if (this.stopped) {
      // Feeds publish fixes up to minutes late; holding a STOPPED_AT for the whole
      // freshness window left buses parked while they were already driving away.
      if (time <= observation.at + this.hold) return observation.progress;
      time -= this.hold;
    }
    const plan = this.timeline;
    const planned = plan.length > 1 ? progressAt(plan, time) : null;
    const pace = this.planSpeed(time);
    // Timetable/ETA is an estimate, and cannot justify an impossible velocity.
    const validPlan = planned !== null && planned >= observation.progress && pace <= this.maximumSpeed;
    return validPlan ? planned : observation.progress + this.sourceSpeed * (time - observation.at) / 1000;
  }
  private referenceSpeed(at: number) {
    if (!this.observation || at >= this.observation.at + freshness || (this.stopped && at < this.observation.at + this.hold)) return 0;
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
    // A fresh realtime anchor behind the rendered vehicle means extrapolation
    // has already gone too far. We cannot drive backwards. If the operator also
    // supplies a later stop ahead, recover towards that stop at the pace needed
    // for its ETA; otherwise brake to a hold while awaiting coherent data.
    const overshotRealtime = this.realtimeTimetable && this.target < this.progress - 2;
    const recoveryAnchor = overshotRealtime ? this.timeline.find((anchor) => anchor.at > at && anchor.progress > this.progress + 2) : undefined;
    this.recoveringToRealtimeAnchor = !!recoveryAnchor;
    this.holdingForRealtimeAnchor = overshotRealtime && !recoveryAnchor;
    const recoverySeconds = recoveryAnchor ? Math.max(dt, (recoveryAnchor.at - at) / 1000) : 0;
    const movementTarget = recoveryAnchor?.progress ?? this.target;
    const movementPace = recoveryAnchor ? clamp((recoveryAnchor.progress - this.progress) / recoverySeconds, 0, this.maximumSpeed) : pace;
    const movementLimit = this.holdingForRealtimeAnchor ? 0 : recoveryAnchor ? Math.min(movementPace, brakingLimit) : Math.min(this.maximumSpeed, brakingLimit);
    // Never backwards: a bus already drawn past the stop holds where it is.
    const next = advanceProgress(this.progress, this.velocity, dt, movementTarget, movementPace, cadenceSeconds, movementLimit, this.acceleration, Math.max(this.progress, this.bounds(at).high));
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
    return { sourceTimestamp: this.observation?.at ?? null, motionTimestamp: this.lastAt, renderedProgress: this.progress, predictedProgress: this.target, renderedSpeed: this.velocity, sourceSpeed: this.measuredSpeed ? this.sourceSpeed : null, predictionPace: this.sourceSpeed, cadenceSeconds: this.hasCadence ? this.cadence / 1000 : null, lastIntervalSeconds: this.lastInterval, correctionSpeed: this.correction, correctionErrorMeters: this.target - this.progress, recoveringToRealtimeAnchor: this.recoveringToRealtimeAnchor, holdingForRealtimeAnchor: this.holdingForRealtimeAnchor, rejected: this.rejection };
  }
}
