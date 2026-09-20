import { segmentBlocked } from "./simulation.js";
import {
  MmWaveTracker,
  SensorLocalizer,
  associateRadarTracks,
  createMmWaveRadar,
  radarMeasurements,
  sampleReturns,
} from "./mmwave.js";
import { OverlayBus, composeFeed, detectorInput, publishSkeleton } from "./overlay.js";
import { SkeletonPoser } from "./skeleton.js";
import { createGaussian, createStereoRig, observePoint } from "./stereo.js";
import { MotionTracker } from "./tracking.js";

export const UNITS_PER_METRE = 24;
export const TARGET_HEIGHT_METRES = 1.75;
/** A thrown puck is a 12 cm disc lying on the floor. */
export const SENSOR_HEIGHT_METRES = 0.06;
export const SENSOR_WIDTH_METRES = 0.12;

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

/** Marker detection runs far slower than the 60 Hz render loop. */
const FIX_INTERVAL_MS = 200;

/**
 * A constant-velocity model under-describes people who turn on the spot and
 * rebound off walls, so the filter's innovation covariance is optimistic for
 * exactly the movement this world is full of. At the textbook 99% chi-square
 * gate a good return lands outside it during a turn and starts a rival track:
 * measured over 25 seconds, one puck accumulated twelve track ids and nine
 * simultaneous ghosts for three bodies. Widening the gate costs nothing in
 * detections and holds one track per body.
 */
const RADAR_GATE = { gateChiSq: 60 };

/**
 * The rig that fixes a thrown puck. Same optics as the detector, but a far
 * lower pixel-height gate: a puck is tiny in frame, and its retroreflective
 * marker is a bright, unambiguous blob rather than a body the detector has to
 * recognise. Localizing a known beacon is an easier problem than finding a
 * person, so it earns a looser threshold.
 */
function markerRig(rig) {
  return createStereoRig({ ...rig, minBoxHeightPx: 2, detectorConfidence: 0.99 });
}

/** A puck still in the air: deployed, but not yet anything the network can use. */
function restingReport(sensor) {
  return {
    id: sensor.id,
    ownerId: sensor.ownerId,
    state: sensor.state,
    active: false,
    located: false,
    position: null,
    sigma: Infinity,
    fixes: 0,
    observers: [],
    lastFixAt: null,
    returns: 0,
    tracks: 0,
    confirmed: 0,
  };
}

/**
 * Stereo fixes on one thrown puck, in world units. A puck cannot report where
 * it is; it is geolocated purely by the cameras that can see it, so an
 * unobserved puck yields nothing at all.
 */
export function fixSensor(world, sensor, rig, options = {}, timestamp = world.time * 1000) {
  const range = effectiveRange(rig, options.range);
  return world.officers.flatMap((officer) => {
    if (occluded(officer, sensor, world.walls)) return [];
    if (Math.hypot(sensor.x - officer.x, sensor.y - officer.y) > range) return [];
    const observation = observePoint(
      {
        x: unitsToMetres(sensor.x),
        y: unitsToMetres(sensor.height ?? 0) + SENSOR_HEIGHT_METRES / 2,
        z: unitsToMetres(sensor.y),
      },
      officerPose(officer, rig),
      rig,
      {
        // A puck lying flat presents its full width to the camera; the 6 cm
        // edge is not what the marker detector has to resolve.
        height: SENSOR_WIDTH_METRES,
        width: SENSOR_WIDTH_METRES,
        ...(options.random ? { random: options.random } : {}),
      },
    );
    if (!observation?.usable) return [];
    return [{
      position: {
        x: metresToUnits(observation.position.x),
        y: metresToUnits(observation.position.z),
      },
      sigma: metresToUnits(observation.sigma),
      officerId: officer.id,
      timestamp,
    }];
  });
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
    this.markerRig = markerRig(this.rig);
    this.tracker = new MotionTracker(options.tracker);
    this.poser = new SkeletonPoser({ height: TARGET_HEIGHT_UNITS, ...options.skeleton });
    this.overlays = new OverlayBus(options.overlay);
    this.random = options.noise === false ? undefined : createGaussian(options.seed ?? 1);
    this.radar = createMmWaveRadar(options.radar);
    this.localizer = new SensorLocalizer(options.localizer);
    this.radarTrackers = new Map();
    this.radarRandom = options.noise === false ? undefined : createGaussian((options.seed ?? 1) + 977);
    this.markerRandom = options.noise === false ? undefined : createGaussian((options.seed ?? 1) + 131);
    this.motion = new Map();
    this.lastFix = new Map();
    this.detections = [];
  }

  configure(options) {
    this.options = {
      ...this.options,
      ...options,
      rig: options.rig ? { ...this.options.rig, ...options.rig } : this.options.rig,
    };
    this.rig = rigFor(this.options);
    this.markerRig = markerRig(this.rig);
    if (options.radar !== undefined) this.radar = createMmWaveRadar(this.options.radar);
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
    const measurements = detections.map((detection) => ({
      trackId: detection.trackId,
      position: detection.position,
      sigma: detection.sigma,
      timestamp: detection.timestamp,
      officerId: detection.officerId,
      confidence: detection.confidence,
      outline: detection.outline,
      source: "stereo",
    }));
    // Radar association runs against last frame's tracks, the prior every
    // association step is entitled to, so both modalities correct the same
    // filter in one update.
    const radar = this.radarFrame(world, timestamp, this.tracker.snapshot());
    measurements.push(...radar.measurements);
    const tracks = this.tracker.update(measurements, timestamp);
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
      sensors: radar.sensors,
      radarTracks: radar.tracks,
      radarReturns: radar.returns,
    };
  }

  /**
   * One frame of the thrown-sensor network.
   *
   * A puck is geolocated by the cameras that can see it, never by itself, and
   * its returns are interpreted from that *estimated* pose — so a poorly fixed
   * puck drags its radar tracks off with it. Until a puck is both settled and
   * located, it contributes nothing.
   */
  radarFrame(world, timestamp, visionTracks) {
    const deployed = world.sensors ?? [];
    const live = new Set(deployed.map((sensor) => sensor.id));
    for (const sensorId of [...this.radarTrackers.keys()]) {
      if (!live.has(sensorId)) {
        this.radarTrackers.delete(sensorId);
        this.localizer.forget(sensorId);
        this.lastFix.delete(sensorId);
      }
    }
    const subjects = this.movingSubjects(world, timestamp);
    const sensors = [];
    const tracks = [];
    const measurements = [];
    let returnCount = 0;
    for (const sensor of deployed) {
      // A puck is tagged where it lands. Fixing it mid-flight would average a
      // trajectory into one point, which is worse than no fix at all.
      if (sensor.state !== "settled") {
        this.localizer.forget(sensor.id);
        sensors.push(restingReport(sensor));
        continue;
      }
      // Consecutive frames see the same puck through the same error, so
      // sampling every frame would fake independent evidence and collapse the
      // covariance far below the real accuracy.
      const due = timestamp - (this.lastFix.get(sensor.id) ?? -Infinity) >= FIX_INTERVAL_MS;
      const fixes = due
        ? fixSensor(world, sensor, this.markerRig, {
          range: this.options.range,
          ...(this.markerRandom ? { random: this.markerRandom } : {}),
        }, timestamp)
        : [];
      if (due) this.lastFix.set(sensor.id, timestamp);
      const estimate = this.localizer.update(sensor.id, fixes, timestamp);
      const active = Boolean(estimate?.located);
      let sensorTracks = [];
      let returns = [];
      if (active) {
        // Geometry happens where the puck really is; the filter only knows
        // where the cameras think it is. The compass gives yaw directly.
        returns = sampleReturns(
          this.radar,
          { id: sensor.id, x: sensor.x, y: sensor.y, angle: sensor.angle },
          subjects,
          world.walls,
          { timestamp, ...(this.radarRandom ? { random: this.radarRandom } : {}) },
        );
        let tracker = this.radarTrackers.get(sensor.id);
        if (!tracker) {
          tracker = new MmWaveTracker({ radar: this.radar, ...RADAR_GATE, ...this.options.radarTracker });
          this.radarTrackers.set(sensor.id, tracker);
        }
        const pose = { id: sensor.id, x: estimate.position.x, y: estimate.position.y, angle: sensor.angle };
        sensorTracks = tracker.update(returns, timestamp, pose);
        const association = associateRadarTracks(sensorTracks, visionTracks);
        measurements.push(...radarMeasurements(sensorTracks, association));
        tracks.push(...sensorTracks);
        returnCount += returns.length;
      }
      sensors.push({
        id: sensor.id,
        ownerId: sensor.ownerId,
        state: sensor.state,
        active,
        located: Boolean(estimate?.located),
        position: estimate ? { ...estimate.position } : null,
        sigma: estimate?.sigma ?? Infinity,
        fixes: estimate?.fixes ?? 0,
        observers: estimate?.observers ?? [],
        lastFixAt: estimate?.lastFixAt ?? null,
        returns: returns.length,
        tracks: sensorTracks.length,
        confirmed: sensorTracks.filter((track) => track.confirmed).length,
      });
    }
    return { sensors, tracks, measurements, returns: returnCount };
  }

  /**
   * Ground-truth bodies with a velocity taken by finite difference, so the
   * radar model never reaches into how the simulation chooses to move people.
   * Friendly officers carry a transponder and are filtered out upstream.
   */
  movingSubjects(world, timestamp) {
    return world.targets.map((target) => {
      const previous = this.motion.get(target.id);
      const dt = previous ? (timestamp - previous.timestamp) / 1000 : 0;
      const velocity = dt > 0
        ? { vx: (target.x - previous.x) / dt, vy: (target.y - previous.y) / dt }
        : { vx: previous?.vx ?? 0, vy: previous?.vy ?? 0 };
      this.motion.set(target.id, { x: target.x, y: target.y, timestamp, ...velocity });
      return { id: target.id, x: target.x, y: target.y, ...velocity };
    });
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
    this.localizer.reset();
    this.radarTrackers.clear();
    this.motion.clear();
    this.lastFix.clear();
    this.detections = [];
  }
}

export function trackObservations(tracks, vision, skeletons, sensors) {
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
      sources: track.sources ?? ["stereo"],
      // Radar reaches through drywall, so a radar-backed track may be one no
      // camera can currently see.
      radar: (track.sources ?? []).includes("mmwave"),
      stereo: (track.sources ?? ["stereo"]).includes("stereo"),
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
  // Ownership travels with the array so `visibleTo` can tell an officer's own
  // puck from a teammate's without the simulation knowing about radar.
  Object.defineProperty(observations, "sensors", {
    value: (sensors ?? []).map((sensor) => ({ id: sensor.id, ownerId: sensor.ownerId })),
  });
  return observations;
}
