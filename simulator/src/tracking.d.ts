/**
 * Unit-agnostic constant-velocity tracking. Feed it noisy per-frame position
 * measurements and it returns smoothed position, velocity and a moving/static
 * classification so the UI can mark real-time dynamic movement.
 */
import type { Vec3 } from "./stereo.js";
export interface Measurement {
  trackId: string;
  /** Measured position; y is treated as the up axis and filtered like the rest. */
  position: Vec3;
  /** One-sigma measurement error in position units. */
  sigma: number;
  /** Milliseconds. */
  timestamp: number;
  officerId?: string;
  confidence?: number;
  outline?: object;
}
export interface TrailPoint extends Vec3 {
  /** Milliseconds. */
  t: number;
}
export interface MotionTrack {
  trackId: string;
  /** Filtered position. */
  position: Vec3;
  /** Filtered velocity, units per second. */
  velocity: Vec3;
  /** Ground-plane speed (x/z), units per second. */
  speed: number;
  /** Ground-plane heading in radians, matching `Math.atan2(vz, vx)`. */
  heading: number;
  /** True once ground-plane speed has held above `movingSpeed`. */
  moving: boolean;
  /** Filtered one-sigma position uncertainty. */
  sigma: number;
  /** Fused confidence in [0, 1]. */
  confidence: number;
  /** Timestamp of the most recent correction, milliseconds. */
  timestamp: number;
  /** Officers that contributed a measurement on the latest update. */
  observers: string[];
  outline?: object;
  /** Oldest-first recent filtered positions for the movement trail. */
  trail: TrailPoint[];
  /** Position extrapolated `lookaheadMs` into the future. */
  predicted: Vec3;
  /** Milliseconds since this track last had a measurement. */
  missedMs: number;
  /** Milliseconds since this track was created. */
  age: number;
  /** True while the track is being coasted on prediction alone. */
  coasting: boolean;
}
export interface TrackerOptions {
  /** Acceleration one-sigma driving the process noise, units per second squared. */
  processNoise?: number;
  /** Drop a track after this long without a measurement. */
  staleAfterMs?: number;
  /** Ground-plane speed above which a track is marked moving, units per second. */
  movingSpeed?: number;
  /** Maximum retained trail samples. */
  trailLength?: number;
  /** Minimum spacing between retained trail samples, milliseconds. */
  trailIntervalMs?: number;
  /** How far ahead `predicted` extrapolates, milliseconds. */
  lookaheadMs?: number;
}
export class MotionTracker {
  constructor(options?: TrackerOptions);
  /** Fuse this frame's measurements, coast unmeasured tracks, expire stale ones. */
  update(measurements: Measurement[], timestamp: number): MotionTrack[];
  /** Current tracks without advancing time. */
  snapshot(): MotionTrack[];
  reset(): void;
}
/** Inverse-variance fusion of several simultaneous reports of one track. */
export function fuseMeasurements(reports: Measurement[]): Measurement;
