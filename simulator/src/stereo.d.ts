/**
 * Head-mounted stereo camera optics. Pure geometry: every length in this module
 * is METRES and every angle is radians unless the name says otherwise.
 * Rig frame is right-handed with +x right, +y up, +z forward (optical axis).
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface StereoRigConfig {
  /** Distance between the two lens centres, metres. */
  baseline?: number;
  /** Sensor width in pixels. */
  imageWidth?: number;
  /** Sensor height in pixels. */
  imageHeight?: number;
  /** Horizontal field of view in DEGREES. */
  hfov?: number;
  /** Height of the rig above the ground plane, metres. */
  mountHeight?: number;
  /** Smallest disparity the matcher trusts, pixels. Sets the far depth limit. */
  minDisparityPx?: number;
  /** One-sigma stereo matching error, pixels. */
  disparityNoisePx?: number;
  /** One-sigma horizontal/vertical centroid error, pixels. */
  centroidNoisePx?: number;
  /** Smallest person box the detector will report, pixels tall. */
  minBoxHeightPx?: number;
  /** Highest confidence the detector will ever emit. */
  detectorConfidence?: number;
}
export interface StereoRig extends Required<StereoRigConfig> {
  /** (imageWidth / 2) / tan(hfov / 2). */
  focalPx: number;
  hfovRad: number;
  vfovRad: number;
  /** focalPx * baseline / minDisparityPx — disparity-limited far plane, metres. */
  maxDepth: number;
  /** Principal point. */
  cx: number;
  cy: number;
}
/** Head pose in world metres; yaw is measured the same way as `officer.angle`. */
export interface CameraPose {
  position: Vec3;
  yaw: number;
  pitch?: number;
  roll?: number;
}
export interface StereoProjection {
  /** Column of the point in the left image, pixels. */
  uLeft: number;
  /** Column of the point in the right image, pixels. */
  uRight: number;
  /** Row of the point in both images, pixels. */
  v: number;
  /** uLeft - uRight, pixels. */
  disparity: number;
  /** Distance along the optical axis, metres. */
  depth: number;
}
export interface StereoObservation extends StereoProjection {
  /** True when the point lands inside BOTH image frames. */
  inFrame: boolean;
  /** inFrame AND disparity >= minDisparityPx AND heightPx >= minBoxHeightPx. */
  usable: boolean;
  /** Apparent height of the subject box, pixels. */
  heightPx: number;
  /** Apparent width of the subject box, pixels. */
  widthPx: number;
  /** One-sigma depth error at this depth, metres. */
  sigma: number;
  /** Detector confidence in [0, 1], falling off with box size and disparity. */
  confidence: number;
  /** Triangulated world position in metres, reconstructed from the measurement. */
  position: Vec3;
  /** Ground-truth depth before matching noise, metres. */
  trueDepth: number;
}
export interface ObserveOptions {
  /** Subject height in metres (default 1.75). */
  height?: number;
  /** Subject width in metres (default 0.55). */
  width?: number;
  /** Standard normal source; omit for a noiseless (perfect matcher) reading. */
  random?: () => number;
}
export function createStereoRig(config?: StereoRigConfig): StereoRig;
export function cameraCentres(pose: CameraPose, rig: StereoRig): { left: Vec3; right: Vec3 };
export function worldToRig(point: Vec3, pose: CameraPose): Vec3;
export function rigToWorld(point: Vec3, pose: CameraPose): Vec3;
export function projectPoint(pointRig: Vec3, rig: StereoRig): StereoProjection | null;
export function disparityToDepth(disparity: number, rig: StereoRig): number;
export function depthToDisparity(depth: number, rig: StereoRig): number;
export function depthSigma(depth: number, rig: StereoRig): number;
export function projectedSizePx(metres: number, depth: number, rig: StereoRig): number;
export function inFrame(projection: StereoProjection, rig: StereoRig): boolean;
export function backProject(
  measurement: { uLeft: number; v: number; disparity: number },
  pose: CameraPose,
  rig: StereoRig,
): Vec3;
export function observePoint(
  point: Vec3,
  pose: CameraPose,
  rig: StereoRig,
  options?: ObserveOptions,
): StereoObservation | null;
/** Deterministic uniform [0, 1) stream. */
export function createRng(seed?: number): () => number;
/** Deterministic standard-normal stream built on `createRng`. */
export function createGaussian(seed?: number): () => number;
