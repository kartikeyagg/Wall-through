/**
 * COCO-18 (OpenPose) pose estimation for detected subjects.
 *
 * Unit-agnostic: every joint offset is a fraction of the `height` you supply,
 * so feeding simulation units gives simulation units back. Within a skeleton
 * `x` and `z` are the ground plane and `y` is up — all three in that one unit,
 * unlike `StereoDetection.position` whose `y` is metres.
 */
export type JointName =
  | "nose"
  | "neck"
  | "rShoulder"
  | "rElbow"
  | "rWrist"
  | "lShoulder"
  | "lElbow"
  | "lWrist"
  | "rHip"
  | "rKnee"
  | "rAnkle"
  | "lHip"
  | "lKnee"
  | "lAnkle"
  | "rEye"
  | "lEye"
  | "rEar"
  | "lEar";
/** Index order is the published wire order: 0 nose, 1 neck, … 17 left ear. */
export const KEYPOINTS: readonly JointName[];
export type Limb = "head" | "torso" | "arm" | "leg";
/** Bone index pairs into `KEYPOINTS`, with the colour the overlay draws them in. */
export const BONES: ReadonlyArray<{ a: number; b: number; limb: Limb; color: string }>;
export interface Joint {
  name: JointName;
  /** Index into `KEYPOINTS`. */
  index: number;
  x: number;
  y: number;
  z: number;
  /** Per-joint detector score in [0, 1]. */
  score: number;
  /** False when the joint sits behind the subject's own torso from the viewer. */
  visible: boolean;
}
export interface Skeleton {
  trackId: string;
  /** Milliseconds. */
  timestamp: number;
  /** Ground contact point the joints are posed around. */
  root: { x: number; y: number; z: number };
  /** Facing in radians, matching `Math.atan2(vz, vx)`. */
  heading: number;
  /** Standing height in the same unit as the joints. */
  height: number;
  /** Ground speed that drove the gait, units per second. */
  speed: number;
  /** Gait phase in radians, advanced by distance travelled. */
  phase: number;
  /** Always 18 entries in `KEYPOINTS` order; low-score joints keep `score` low. */
  joints: Joint[];
  /** Mean score across joints, in [0, 1]. */
  confidence: number;
}
export interface SkeletonOptions {
  /** Standing height in the caller's unit. Default 42 (1.75 m at 24 units/m). */
  height?: number;
  /** Distance covered per full gait cycle, in the caller's unit. Default 1.5 x height. */
  strideLength?: number;
  /** Peak limb swing at a full stride, radians. Default 0.62. */
  swing?: number;
  /** Idle breathing amplitude as a fraction of height. Default 0.004. */
  idleSway?: number;
  /** Speed below which the subject is posed standing, units per second. Default 2. */
  standingSpeed?: number;
  /** Detector score for a cleanly visible joint. Default 0.94. */
  jointScore?: number;
  /** Score floor applied to self-occluded joints. Default 0.45. */
  occludedScore?: number;
  /** Deterministic noise seed for per-joint score jitter. Default 7. */
  seed?: number;
}
/** Local joint offsets for a standing subject, relative to the ground root. */
export function restPose(height: number): Array<{ name: JointName; index: number; x: number; y: number; z: number }>;
/** Pose one subject. `phase` is taken from `state` when present, else derived from `timestamp`. */
export function poseSkeleton(
  state: {
    trackId: string;
    position: { x: number; y?: number; z: number };
    heading?: number;
    speed?: number;
    timestamp?: number;
    phase?: number;
  },
  options?: SkeletonOptions,
): Skeleton;
/** Stateful poser: keeps each track's gait phase continuous across frames. */
export class SkeletonPoser {
  constructor(options?: SkeletonOptions);
  /** Advance every supplied track's gait and return its posed skeleton. */
  pose(
    tracks: Array<{
      trackId: string;
      position: { x: number; y?: number; z: number };
      heading?: number;
      speed?: number;
    }>,
    timestamp: number,
  ): Skeleton[];
  /** Current phase for a track, or 0 when unknown. */
  phaseOf(trackId: string): number;
  reset(): void;
}
/** Look one joint up by name. */
export function jointAt(skeleton: Skeleton, name: JointName): Joint | undefined;
/** Axis-aligned bounds of the posed joints. */
export function skeletonBounds(skeleton: Skeleton): {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};
/** Flat bone segments ready for a line renderer, skipping low-score joints. */
export function skeletonSegments(
  skeleton: Skeleton,
  minScore?: number,
): Array<{ from: Joint; to: Joint; color: string; limb: Limb; score: number }>;
