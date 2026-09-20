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
import {
  backProject,
  createGaussian,
  createStereoRig,
  depthToDisparity,
  inFrame,
  observePoint,
  projectPoint,
  worldToRig,
} from "./stereo.js";
import { MotionTracker } from "./tracking.js";

export const UNITS_PER_METRE = 24;
export const TARGET_HEIGHT_METRES = 1.75;
/** A thrown puck is a 12 cm disc lying on the floor. */
export const SENSOR_HEIGHT_METRES = 0.06;
export const SENSOR_WIDTH_METRES = 0.12;

export const unitsToMetres = (units) => units / UNITS_PER_METRE;
export const metresToUnits = (metres) => metres * UNITS_PER_METRE;
const TARGET_HEIGHT_UNITS = metresToUnits(TARGET_HEIGHT_METRES);

function cappedFps(fps) {
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

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

function vector(from, to) {
  return { x: to.x - from.x, z: to.z - from.z };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.z);
  return length > 1e-6 ? { x: vector.x / length, z: vector.z / length } : { x: 0, z: 0 };
}

function cameraSkeleton(model, detection, officer, rig, walls, random) {
  const pose = officerPose(officer, rig);
  const byName = Object.fromEntries(model.joints.map((joint) => [joint.name, joint]));
  const torso = {
    x: (byName.rHip.x + byName.lHip.x + byName.rShoulder.x + byName.lShoulder.x) / 4,
    y: (byName.rHip.y + byName.lHip.y + byName.rShoulder.y + byName.lShoulder.y) / 4,
    z: (byName.rHip.z + byName.lHip.z + byName.rShoulder.z + byName.lShoulder.z) / 4,
  };
  const lateral = normalize(vector(byName.rShoulder, byName.lShoulder));
  const bearing = normalize({ x: unitsToMetres(officer.x) - unitsToMetres(torso.x), z: unitsToMetres(officer.y) - unitsToMetres(torso.z) });
  const sideOn = Math.abs(lateral.x * bearing.x + lateral.z * bearing.z) > 0.35;
  const joints = model.joints.map((joint) => {
    const point = { x: unitsToMetres(joint.x), y: unitsToMetres(joint.y), z: unitsToMetres(joint.z) };
    // Each landmark remains a camera measurement, while the detection that
    // rooted this model supplies the one shared triangulation displacement.
    const rigPoint = worldToRig(point, pose);
    const projection = projectPoint(rigPoint, rig);
    const measured = observePoint(point, pose, rig, {
      height: TARGET_HEIGHT_METRES,
      width: 0.55,
    });
    if (!projection || !measured) return { ...joint, score: 0, visible: false };
    // A keypoint's two image centroids may wander together by a few pixels;
    // changing their disparity here would falsely give every limb its own range.
    const keypointNoisePx = Math.min(0.1, rig.centroidNoisePx);
    const localized = random ? {
      ...measured,
      uLeft: measured.uLeft + random() * keypointNoisePx,
      v: measured.v + random() * keypointNoisePx,
    } : measured;
    localized.uRight = localized.uLeft - localized.disparity;
    const reconstructed = backProject(localized, pose, rig);
    const physicalDisparity = depthToDisparity(projection.depth, rig);
    const framed = inFrame(localized, rig);
    const jointBearing = vector(torso, joint);
    const farSide = sideOn && jointBearing.x * bearing.x + jointBearing.z * bearing.z < -0.015;
    const behindWall = occluded(officer, { x: metresToUnits(point.x), y: metresToUnits(point.z) }, walls);
    const visible = framed && measured.disparity >= rig.minDisparityPx && physicalDisparity >= rig.minDisparityPx
      && !farSide && !behindWall;
    const apparentHeight = TARGET_HEIGHT_METRES * rig.focalPx / localized.depth;
    const score = visible ? Math.min(1, rig.detectorConfidence
      * Math.sqrt(Math.min(1, apparentHeight / (rig.minBoxHeightPx * 2)))
      * (0.5 + 0.5 * Math.min(1, localized.disparity / (rig.minDisparityPx * 4)))) : 0;
    return {
      ...joint,
      x: metresToUnits(reconstructed.x),
      y: metresToUnits(reconstructed.y),
      z: metresToUnits(reconstructed.z),
      score,
      visible,
      depth: localized.depth,
      disparity: localized.disparity,
      // This is shared body-position uncertainty, not eighteen fake fixes.
      sigma: detection.sigma,
    };
  });
  return {
    ...model,
    officerId: detection.officerId,
    joints,
    confidence: joints.reduce((sum, joint) => sum + joint.score, 0) / joints.length,
  };
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
    this.skeletons = [];
    this.bypassed = 0;
    this.fps = cappedFps(options.fps);
    this.lastCaptureAt = null;
    this.nextCaptureAt = null;
    this.exposure = new Map();
    this.captureTimestamps = [];
  }

  configure(options) {
    this.options = {
      ...this.options,
      ...options,
      rig: options.rig ? { ...this.options.rig, ...options.rig } : this.options.rig,
    };
    // An exposure setting should not disturb the rig or its live tracks.
    if (options.rig !== undefined || options.fov !== undefined) {
      this.rig = rigFor(this.options);
      this.markerRig = markerRig(this.rig);
    }
    if (options.radar !== undefined) this.radar = createMmWaveRadar(this.options.radar);
    if (options.tracker !== undefined) this.tracker = new MotionTracker(options.tracker);
    if (options.skeleton !== undefined)
      this.poser = new SkeletonPoser({ height: TARGET_HEIGHT_UNITS, ...options.skeleton });
    if (options.overlay !== undefined) this.overlays = new OverlayBus(options.overlay);
    this.fps = cappedFps(this.options.fps);
    this.lastCaptureAt = null;
    this.nextCaptureAt = null;
    this.exposure = new Map();
    this.captureTimestamps = [];
  }

  update(world, timestamp = world.time * 1000) {
    // Exposures are scheduled on a running deadline rather than measured from
    // the last one: at 30 fps on a 60 Hz loop the two grids line up exactly, and
    // timing each interval from the previous capture lets float error push every
    // few exposures onto the following frame, which alone costs a fifth of the
    // requested rate.
    const interval = this.fps === null ? 0 : 1000 / this.fps;
    const captured = this.fps === null || this.nextCaptureAt === null
      || timestamp >= this.nextCaptureAt - interval * 1e-6;
    const feeds = [];
    let detections = this.detections;
    let skeletons = this.skeletons;
    let bypassed = this.bypassed;
    const measurements = [];
    if (captured) {
      detections = detectWith(
        world,
        this.options,
        timestamp,
        this.rig,
        this.random,
        (officerId, frameTimestamp) => this.overlaysFor(officerId, frameTimestamp),
        feeds,
      );
      measurements.push(...detections.map((detection) => ({
        trackId: detection.trackId,
        position: detection.position,
        sigma: detection.sigma,
        timestamp: detection.timestamp,
        officerId: detection.officerId,
        confidence: detection.confidence,
        outline: detection.outline,
        source: "stereo",
      })));
    }
    // Radar association runs against last frame's tracks, the prior every
    // association step is entitled to, so both modalities correct the same
    // filter in one update.
    const radar = this.radarFrame(world, timestamp, this.tracker.snapshot());
    measurements.push(...radar.measurements);
    const tracks = this.tracker.update(measurements, timestamp);
    this.holdExposure(tracks, captured, interval);
    if (captured && this.options.poses !== false) {
      const tracksById = new Map(tracks.map((track) => [track.trackId, track]));
      const officersById = new Map(world.officers.map((officer) => [officer.id, officer]));
      const models = this.poser.pose(detections.map((detection) => {
        const track = tracksById.get(detection.trackId);
        return {
          trackId: detection.trackId,
          officerId: detection.officerId,
          // The detection fixes the body in this observer's camera frame;
          // the fused track supplies only motion for the articulated gait.
          // The detector's 3D centroid is the common-mode pose measurement.
          // Its centre is half a standing body above the ground root.
          position: {
            x: detection.position.x,
            y: metresToUnits(detection.position.y) - TARGET_HEIGHT_UNITS / 2,
            z: detection.position.z,
          },
          heading: track?.heading ?? 0,
          speed: track?.speed ?? 0,
        };
      }), timestamp);
      for (let index = 0; index < detections.length; index += 1) {
        const officer = officersById.get(detections[index].officerId);
        if (officer) detections[index].skeleton = cameraSkeleton(
          models[index], detections[index], officer, this.rig, world.walls, this.random,
        );
      }
    }
    if (captured) {
      skeletons = this.options.poses === false ? [] : detections.flatMap((detection) => {
        const skeleton = detection.skeleton;
        return skeleton ? [publishSkeleton(detection.officerId, skeleton, timestamp, detection.confidence)] : [];
      });
      if (this.options.poses !== false) this.overlays.publish(skeletons, timestamp);
      this.detections = detections;
      this.skeletons = skeletons;
      this.bypassed = feeds.reduce((count, feed) => count + feed.overlays.length, 0);
      bypassed = this.bypassed;
      this.lastCaptureAt = timestamp;
      // A loop that stalled past a whole interval resynchronises instead of
      // firing a burst of exposures to catch up on time the rig never saw.
      this.nextCaptureAt = this.nextCaptureAt === null || timestamp - this.nextCaptureAt > interval
        ? timestamp + interval
        : this.nextCaptureAt + interval;
      this.captureTimestamps.push(timestamp);
      // Old exposures would make a stopped rig look healthy.
      this.captureTimestamps = this.captureTimestamps.filter((capturedAt) => timestamp - capturedAt <= 1000);
    }
    const captureRate = this.captureTimestamps.length < 2 ? 0
      : (this.captureTimestamps.length - 1) * 1000
        / (this.captureTimestamps.at(-1) - this.captureTimestamps[0]);
    return {
      detections,
      tracks,
      rig: this.rig,
      skeletons,
      bypassed,
      sensors: radar.sensors,
      radarTracks: radar.tracks,
      radarReturns: radar.returns,
      captured,
      fps: this.fps,
      captureRate: Number.isFinite(captureRate) ? captureRate : 0,
    };
  }

  /**
   * Between exposures a capped rig has not lost anyone: it simply has not
   * looked yet. A track carries the observers of its last exposure until the
   * next one falls due, so a slow camera reads as a slow camera rather than as
   * a target nobody can resolve — without it the operator's panel flickers
   * between live and predicted on every frame the rig sits idle. A track that
   * was already coasting at that exposure, or one a puck is still correcting,
   * keeps what the filter says about it.
   */
  holdExposure(tracks, captured, interval) {
    if (captured) {
      this.exposure = new Map(tracks.map((track) => [track.trackId, {
        observers: [...track.observers],
        sources: [...track.sources],
        coasting: track.coasting,
      }]));
      return;
    }
    if (!interval) return;
    for (const track of tracks) {
      const last = this.exposure.get(track.trackId);
      if (!track.coasting || !last || last.coasting) continue;
      if (track.missedMs > interval * 1.5) continue;
      track.observers = [...last.observers];
      track.sources = [...last.sources];
      track.coasting = false;
    }
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
    this.skeletons = [];
    this.bypassed = 0;
    this.lastCaptureAt = null;
    this.nextCaptureAt = null;
    this.exposure = new Map();
    this.captureTimestamps = [];
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
