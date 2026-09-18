/**
 * Composition layer: world state -> head-mounted stereo detections -> motion
 * tracks -> shared-vision observations. This is the only module that converts
 * between simulation ground-plane units and the metres used by `stereo.js`.
 */
import type { Observation, Wall, World } from "./simulation.js";
import type { CameraPose, StereoRig, StereoRigConfig, Vec3 } from "./stereo.js";
import type { MotionTrack, TrackerOptions } from "./tracking.js";
/** Simulation ground units per real-world metre. */
export const UNITS_PER_METRE: number;
export const TARGET_HEIGHT_METRES: number;
export interface StereoDetection {
  timestamp: number;
  officerId: string;
  trackId: string;
  /** Triangulated position in simulation units (x, z on the ground; y up, metres). */
  position: Vec3;
  confidence: number;
  /** One-sigma triangulation error in simulation units. */
  sigma: number;
  /** Measured disparity, pixels. */
  disparity: number;
  /** Measured depth, metres. */
  depth: number;
  /** Where the subject landed on the sensor. */
  pixels: { uLeft: number; uRight: number; v: number; heightPx: number; widthPx: number };
  outline: { type: "capsule"; height: number; radius: number };
  sensor: { kind: "stereo-camera"; id: string };
}
export interface VisionOptions {
  rig?: StereoRigConfig;
  tracker?: TrackerOptions;
  /** Operator-set hard detection cutoff in simulation units. Optics may bind first. */
  range?: number;
  /** Horizontal field of view in radians; overrides `rig.hfov` when present. */
  fov?: number;
  /** Seed for the deterministic matcher-noise stream. */
  seed?: number;
  /** Set false to disable matcher noise (exact triangulation). */
  noise?: boolean;
}
/** Convert an officer body into the pose of the stereo rig on their head. */
export function officerPose(
  officer: { x: number; y: number; angle: number },
  rig: StereoRig,
): CameraPose;
export function unitsToMetres(units: number): number;
export function metresToUnits(metres: number): number;
/** Effective detection range in simulation units: the tighter of optics and cutoff. */
export function effectiveRange(rig: StereoRig, range?: number): number;
/** One frame of stereo detections from every officer's head rig. */
export function detect(
  world: World,
  options?: VisionOptions,
  timestamp?: number,
): StereoDetection[];
/** Hardware-shaped provider wrapper, matching the `sensors.js` provider contract. */
export function createStereoVisionProvider(
  world: World,
  options?: VisionOptions,
): { source: string; rig: StereoRig; read(timestamp?: number): StereoDetection[] };
export interface VisionFrame {
  detections: StereoDetection[];
  tracks: MotionTrack[];
  rig: StereoRig;
}
/** Stateful per-frame pipeline: detect, then fuse into motion tracks. */
export class StereoVisionPipeline {
  constructor(options?: VisionOptions);
  readonly rig: StereoRig;
  configure(options: VisionOptions): void;
  update(world: World, timestamp?: number): VisionFrame;
  reset(): void;
}
export interface VisionObservation extends Observation {
  velocity: { x: number; y: number };
  speed: number;
  heading: number;
  moving: boolean;
  sigma: number;
  coasting: boolean;
  trail: Array<{ x: number; y: number }>;
  predicted: { x: number; y: number };
}
/** Project motion tracks into the array shape `visibleTo` consumes. */
export function trackObservations(
  tracks: MotionTrack[],
  vision: { range: number; fov: number },
): VisionObservation[];
/** Straight-line occlusion test against the world's opaque walls. */
export function occluded(from: { x: number; y: number }, to: { x: number; y: number }, walls: Wall[]): boolean;
