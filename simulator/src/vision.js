import { segmentBlocked } from "./simulation.js";
import { OverlayBus, composeFeed, detectorInput, publishSkeleton } from "./overlay.js";
import { SkeletonPoser } from "./skeleton.js";
import { createGaussian, createStereoRig, observePoint } from "./stereo.js";
import { MotionTracker } from "./tracking.js";

export const UNITS_PER_METRE = 24;
export const TARGET_HEIGHT_METRES = 1.75;

export const unitsToMetres = (units) => units / UNITS_PER_METRE;
export const metresToUnits = (metres) => metres * UNITS_PER_METRE;
const TARGET_HEIGHT_UNITS = metresToUnits(TARGET_HEIGHT_METRES);

function rigFor(options = {}) {
  const config = { ...options.rig };
  if (Number.isFinite(options.fov)) config.hfov = options.fov * 180 / Math.PI;
  return createStereoRig(config);
}

export function officerPose(officer, rig) {
  return {
    position: {
      x: unitsToMetres(officer.x),
      y: rig.mountHeight,
      z: unitsToMetres(officer.y),
    },
    yaw: officer.angle,
    pitch: 0,
    roll: 0,
  };
}

export function effectiveRange(rig, range) {
  const optics = metresToUnits(Math.min(
    rig.maxDepth,
    TARGET_HEIGHT_METRES * rig.focalPx / rig.minBoxHeightPx,
  ));
  return Number.isFinite(range) && range > 0 ? Math.min(range, optics) : optics;
}

export function occluded(from, to, walls) {
  return segmentBlocked(from, to, walls);
}

function detectWith(world, options, timestamp, rig, random, overlaysFor = () => [], feeds) {
  const range = effectiveRange(rig, options.range);
  const realSubjects = world.targets.map((target) => ({ id: target.id, x: target.x, y: target.y }));
  return world.officers.flatMap((officer) => {
    const feed = composeFeed(officer.id, realSubjects, overlaysFor(officer.id, timestamp), timestamp);
    if (feeds) feeds.push(feed);
    return detectorInput(feed).flatMap((target) => {
      if (occluded(officer, target, world.walls)) return [];
      if (Math.hypot(target.x - officer.x, target.y - officer.y) > range) return [];
      const observation = observePoint(
        {
          x: unitsToMetres(target.x),
          y: TARGET_HEIGHT_METRES / 2,
          z: unitsToMetres(target.y),
        },
        officerPose(officer, rig),
        rig,
        {
          height: TARGET_HEIGHT_METRES,
          width: 0.55,
          ...(random ? { random } : {}),
        },
      );
      if (!observation?.usable) return [];
      return [{
        timestamp,
        officerId: officer.id,
        trackId: target.id,
        position: {
          x: metresToUnits(observation.position.x),
          y: observation.position.y,
          z: metresToUnits(observation.position.z),
        },
        confidence: observation.confidence,
        sigma: metresToUnits(observation.sigma),
        disparity: observation.disparity,
        depth: observation.depth,
        pixels: {
          uLeft: observation.uLeft,
          uRight: observation.uRight,
          v: observation.v,
          heightPx: observation.heightPx,
          widthPx: observation.widthPx,
        },
        outline: { type: "capsule", height: TARGET_HEIGHT_METRES, radius: 0.28 },
        sensor: { kind: "stereo-camera", id: `${officer.id}-stereo` },
      }];
    });
  });
}

export function detect(world, options = {}, timestamp = world.time * 1000) {
  const rig = rigFor(options);
  const random = options.noise === false ? undefined : createGaussian(options.seed ?? 1);
  return detectWith(world, options, timestamp, rig, random);
}

export function createStereoVisionProvider(world, options = {}) {
  const rig = rigFor(options);
  const random = options.noise === false ? undefined : createGaussian(options.seed ?? 1);
  return {
    source: "head-stereo-camera",
    rig,
    read(timestamp = world.time * 1000) {
      return detectWith(world, options, timestamp, rig, random);
    },
  };
}

export class StereoVisionPipeline {
  constructor(options = {}) {
    this.options = { ...options, rig: options.rig && { ...options.rig } };
    this.rig = rigFor(this.options);
    this.tracker = new MotionTracker(options.tracker);
    this.poser = new SkeletonPoser({ height: TARGET_HEIGHT_UNITS, ...options.skeleton });
    this.overlays = new OverlayBus(options.overlay);
    this.random = options.noise === false ? undefined : createGaussian(options.seed ?? 1);
    this.detections = [];
  }

  configure(options) {
    this.options = {
      ...this.options,
      ...options,
      rig: options.rig ? { ...this.options.rig, ...options.rig } : this.options.rig,
    };
    this.rig = rigFor(this.options);
    if (options.tracker !== undefined) this.tracker = new MotionTracker(options.tracker);
    if (options.skeleton !== undefined)
      this.poser = new SkeletonPoser({ height: TARGET_HEIGHT_UNITS, ...options.skeleton });
    if (options.overlay !== undefined) this.overlays = new OverlayBus(options.overlay);
  }

  update(world, timestamp = world.time * 1000) {
    const feeds = [];
    const detections = detectWith(
      world,
      this.options,
      timestamp,
      this.rig,
      this.random,
      (officerId, frameTimestamp) => this.overlaysFor(officerId, frameTimestamp),
      feeds,
    );
    const tracks = this.tracker.update(detections.map((detection) => ({
      trackId: detection.trackId,
      position: detection.position,
      sigma: detection.sigma,
      timestamp: detection.timestamp,
      officerId: detection.officerId,
      confidence: detection.confidence,
      outline: detection.outline,
    })), timestamp);
    const posed = this.options.poses === false ? new Map() : new Map(this.poser.pose(tracks.map((track) => ({
      trackId: track.trackId,
      position: { x: track.position.x, y: 0, z: track.position.z },
      heading: track.heading,
      speed: track.speed,
    })), timestamp).map((skeleton) => [skeleton.trackId, skeleton]));
    for (const detection of detections) {
      const skeleton = posed.get(detection.trackId);
      if (skeleton) detection.skeleton = skeleton;
    }
    const skeletons = this.options.poses === false ? [] : detections.flatMap((detection) => {
      const skeleton = detection.skeleton;
      return skeleton ? [publishSkeleton(detection.officerId, skeleton, timestamp, detection.confidence)] : [];
    });
    if (this.options.poses !== false) this.overlays.publish(skeletons, timestamp);
    this.detections = detections;
    return {
      detections,
      tracks,
      rig: this.rig,
      skeletons,
      bypassed: feeds.reduce((count, feed) => count + feed.overlays.length, 0),
    };
  }

  overlaysFor(officerId, timestamp, options) {
    return this.overlays.layersFor(officerId, timestamp, { ...this.options.overlay, ...options });
  }

  feedFor(world, officerId, timestamp = world.time * 1000, options) {
    const subjects = this.detections
      .filter((detection) => detection.officerId === officerId)
      .map((detection) => ({
        id: detection.trackId,
        x: detection.position.x,
        y: detection.position.z,
      }));
    return composeFeed(officerId, subjects, this.overlaysFor(officerId, timestamp, options), timestamp);
  }

  reset() {
    this.tracker.reset();
    this.poser.reset();
    this.overlays.reset();
    this.detections = [];
  }
}

export function trackObservations(tracks, vision, skeletons) {
  const skeletonByTrack = new Map();
  for (const frame of skeletons ?? []) {
    const current = skeletonByTrack.get(frame.trackId);
    if (!current || frame.confidence > current.confidence) skeletonByTrack.set(frame.trackId, frame);
  }
  const observations = tracks.map((track) => {
    const skeleton = skeletonByTrack.get(track.trackId)?.skeleton;
    return {
      targetId: track.trackId,
      x: track.position.x,
      y: track.position.z,
      z: track.position.z,
      observers: track.observers,
      confidence: track.confidence,
      timestamp: track.timestamp,
      outline: track.outline,
      sigma: track.sigma,
      moving: track.moving,
      coasting: track.coasting,
      speed: track.speed,
      heading: track.heading,
      velocity: { x: track.velocity.x, y: track.velocity.z },
      trail: track.trail.map((point) => ({ x: point.x, y: point.z })),
      predicted: { x: track.predicted.x, y: track.predicted.z },
      ...(skeleton ? { skeleton } : {}),
    };
  });
  Object.defineProperty(observations, "vision", { value: vision });
  return observations;
}
