/**
 * Composition layer: world state -> head-mounted stereo detections -> motion
 * tracks -> shared-vision observations. This is the only module that converts
 * between simulation ground-plane units and the metres used by `stereo.js`.
 */
import type { DeployedSensor, Observation, Wall, World } from "./simulation.js";
import type { MmWaveRadar, MmWaveTrackerOptions, RadarTrack, SensorEstimate, SensorLocalizer } from "./mmwave.js";
import type { CameraPose, StereoRig, StereoRigConfig, Vec3 } from "./stereo.js";
import type { MotionTrack, TrackerOptions } from "./tracking.js";
import type { Skeleton, SkeletonOptions } from "./skeleton.js";
import type { CameraFeed, OverlayBus, OverlayLayer, OverlayOptions, SkeletonFrame } from "./overlay.js";
/** Simulation ground units per real-world metre. */
export const UNITS_PER_METRE: number;
export const TARGET_HEIGHT_METRES: number;
/** Physical size of a thrown puck, used to fix it from stereo. */
export const SENSOR_HEIGHT_METRES: number;
export const SENSOR_WIDTH_METRES: number;
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
  /** Pose estimated from this detection, in simulation units. */
  skeleton?: Skeleton;
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
  /** Pose estimator settings; `height` defaults to the target height in units. */
  skeleton?: SkeletonOptions;
  /** Set false to stop estimating and publishing poses. Default true. */
  poses?: boolean;
  /** Overlay publication and fade settings. */
  overlay?: OverlayOptions;
  /** Thrown-puck radar specification. */
  radar?: Parameters<typeof import("./mmwave.js").createMmWaveRadar>[0];
  /** Per-puck radar filter settings. */
  radarTracker?: MmWaveTrackerOptions;
  /** Puck geolocation settings. */
  localizer?: ConstructorParameters<typeof SensorLocalizer>[0];
}
/** One puck's state as the pipeline reports it each frame. */
export interface SensorReport {
  id: string;
  ownerId: string;
  state: "flight" | "settled";
  /** Settled, located, and therefore usable as a radar origin. */
  active: boolean;
  located: boolean;
  /** Stereo estimate of where the puck is, null before any fix lands. */
  position: { x: number; y: number } | null;
  /** One-sigma of that estimate in world units; Infinity when unfixed. */
  sigma: number;
  fixes: number;
  observers: string[];
  lastFixAt: number | null;
  /** Radar returns this frame. */
  returns: number;
  tracks: number;
  confirmed: number;
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
  /** Poses published by the officers that resolved each subject this frame. */
  skeletons: SkeletonFrame[];
  /** Overlay layers stripped from detector input this frame. */
  bypassed: number;
  /** Every deployed puck, whether or not it is usable yet. */
  sensors: SensorReport[];
  /** Radar tracks from every active puck, before association with stereo. */
  radarTracks: RadarTrack[];
  /** Raw radar returns across all pucks this frame. */
  radarReturns: number;
}
/** Stateful per-frame pipeline: detect, then fuse into motion tracks. */
export class StereoVisionPipeline {
  constructor(options?: VisionOptions);
  readonly rig: StereoRig;
  readonly overlays: OverlayBus;
  readonly radar: MmWaveRadar;
  readonly localizer: SensorLocalizer;
  configure(options: VisionOptions): void;
  update(world: World, timestamp?: number): VisionFrame;
  /** Teammate skeleton layers this officer should draw over their feed. */
  overlaysFor(officerId: string, timestamp?: number, options?: OverlayOptions): OverlayLayer[];
  /** This officer's feed: real subjects plus the overlays the detector bypasses. */
  feedFor(world: World, officerId: string, timestamp?: number, options?: OverlayOptions): CameraFeed;
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
  /** Live pose for this track, when one was estimated. */
  skeleton?: Skeleton;
  /** Sensor modalities behind the latest correction. */
  sources: string[];
  /** A puck holds this track; it may be one no camera can see. */
  radar: boolean;
  /** A head rig holds this track. */
  stereo: boolean;
}
/** Project motion tracks into the array shape `visibleTo` consumes. */
export function trackObservations(
  tracks: MotionTrack[],
  vision: { range: number; fov: number },
  skeletons?: SkeletonFrame[],
  /** Puck ownership, so `visibleTo` can tell an officer's own puck from a teammate's. */
  sensors?: Array<{ id: string; ownerId: string }>,
): VisionObservation[];
/**
 * Stereo fixes on one thrown puck, in world units. A puck cannot report its own
 * position; only the cameras that can see it know where it is.
 */
export function fixSensor(
  world: World,
  sensor: DeployedSensor,
  rig: StereoRig,
  options?: { range?: number; random?: () => number },
  timestamp?: number,
): Array<{ position: { x: number; y: number }; sigma: number; officerId: string; timestamp: number }>;
/** Straight-line occlusion test against the world's opaque walls. */
export function occluded(from: { x: number; y: number }, to: { x: number; y: number }, walls: Wall[]): boolean;
