/**
 * Skeleton publish / subscribe layer.
 *
 * An officer whose rig resolves a subject publishes that subject's pose. Every
 * other officer receives it as a translucent overlay drawn onto their camera
 * feed. An overlay is paint on the glass, never a body: `detectorInput` is the
 * single seam the stereo detector reads through, and it strips every overlay
 * so a drawn skeleton can never be re-detected as a fresh subject.
 */
import type { Skeleton } from "./skeleton.js";
/** A pose put on the wire by the officer that actually saw the subject. */
export interface SkeletonFrame {
  /** `${publisherId}:${trackId}` — one live frame per publisher per subject. */
  frameId: string;
  /** Officer whose head rig produced this pose. */
  publisherId: string;
  trackId: string;
  /** Milliseconds. */
  timestamp: number;
  skeleton: Skeleton;
  confidence: number;
  /** Discriminator the detector filters on. */
  layer: "overlay";
  /** Always true: a published pose is a drawing, not a subject. */
  synthetic: true;
}
/** A received frame resolved for one officer's display. */
export interface OverlayLayer {
  frameId: string;
  publisherId: string;
  trackId: string;
  timestamp: number;
  skeleton: Skeleton;
  confidence: number;
  /** Final alpha after the operator slider and the age fade, in [0, 1]. */
  opacity: number;
  /** Milliseconds since the frame was published. */
  ageMs: number;
  /** True once the frame is older than `holdMs + fadeMs`. */
  stale: boolean;
  /** Always true — see `detectorInput`. */
  bypassDetector: true;
}
export interface OverlayOptions {
  /** Operator alpha ceiling in [0, 1]. Default 0.35. */
  opacity?: number;
  /** Full-opacity window after publication, milliseconds. Default 400. */
  holdMs?: number;
  /** Linear fade duration after the hold, milliseconds. Default 600. */
  fadeMs?: number;
  /** Alpha floor while a layer is still live. Default 0.05. */
  minOpacity?: number;
  /** Return the receiver's own published frames too. Default false. */
  includeSelf?: boolean;
  /** False suppresses every teammate layer. Default true. */
  sharing?: boolean;
}
/** Wrap a posed skeleton as a publishable frame. */
export function publishSkeleton(
  publisherId: string,
  skeleton: Skeleton,
  timestamp?: number,
  confidence?: number,
): SkeletonFrame;
/** True for anything carrying the overlay discriminator. */
export function isOverlay(item: unknown): boolean;
/** A real body in an officer's feed. Never carries the overlay discriminator. */
export interface FeedSubject {
  id: string;
  x: number;
  y: number;
  synthetic?: false;
}
export interface CameraFeed {
  officerId: string;
  /** Milliseconds. */
  timestamp: number;
  /** Bodies genuinely in frame. */
  subjects: FeedSubject[];
  /** Teammate skeletons painted over the frame. */
  overlays: OverlayLayer[];
}
export function composeFeed(
  officerId: string,
  subjects: FeedSubject[],
  overlays: OverlayLayer[],
  timestamp: number,
): CameraFeed;
/**
 * The bypass. Everything the stereo detector is allowed to see — overlays
 * removed, and any overlay that leaked into `subjects` removed as well.
 */
export function detectorInput(feed: CameraFeed): FeedSubject[];
/** How many overlay entries `detectorInput` stripped from a feed. */
export function bypassedCount(feed: CameraFeed): number;
/** Retains the latest frame per publisher per subject and resolves per-receiver layers. */
export class OverlayBus {
  constructor(options?: OverlayOptions);
  /** Replace this frame's publications; returns what was accepted. */
  publish(frames: SkeletonFrame[], timestamp: number): SkeletonFrame[];
  /** Layers this officer should draw, newest first, stale frames dropped. */
  layersFor(officerId: string, timestamp: number, options?: OverlayOptions): OverlayLayer[];
  /** Every live frame, regardless of receiver. */
  frames(): SkeletonFrame[];
  /** Drop frames past `holdMs + fadeMs`. */
  prune(timestamp: number): void;
  reset(): void;
  /** Running count of overlay layers kept out of detector input. */
  readonly bypassed: number;
}
