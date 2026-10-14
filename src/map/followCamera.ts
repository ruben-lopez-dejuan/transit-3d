type Padding = { top: number; bottom: number; left: number; right: number };
type CameraMap = {
  easeTo(options: { center: [number, number]; duration: number; padding: Padding }): unknown;
  jumpTo(options: { center: [number, number]; padding: Padding }): unknown;
  isZooming(): boolean;
  isRotating(): boolean;
};

/**
 * Keeps a followed vehicle centred. Re-easing towards it every few hundred
 * milliseconds accelerated and braked the camera on each call, which read as
 * jerks. After one ease to reach the vehicle, the camera is locked to the
 * rendered position on every frame: the vehicle already moves smoothly.
 */
export class FollowCamera {
  private engaged = false;
  private settledAt = 0;
  constructor(private readonly map: CameraMap) {}
  /** Forget the lock so the next update eases to the vehicle again. */
  reset() { this.engaged = false; }
  update(center: [number, number], now: number, padding: Padding, easeMs: number): 'ease' | 'lock' | 'wait' {
    if (!this.engaged) {
      this.engaged = true; this.settledAt = now + easeMs;
      this.map.easeTo({ center, duration: easeMs, padding });
      return 'ease';
    }
    // Let the initial ease and the user's own zoom or rotation finish undisturbed.
    if (now < this.settledAt || this.map.isZooming() || this.map.isRotating()) return 'wait';
    this.map.jumpTo({ center, padding });
    return 'lock';
  }
}
