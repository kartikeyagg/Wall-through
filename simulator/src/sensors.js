/**
 * Hardware-neutral sensor contract. The head-mounted stereo camera
 * (`createStereoVisionProvider` in vision.js) is the only detection source;
 * a physical stereo rig would emit SensorDetection objects with this same shape.
 * Coordinates are right-handed metres-in-simulation: x across, y up, z deep.
 *
 * @typedef {{ timestamp: number, officerId: string, trackId: string, position: {x:number,y:number,z:number}, confidence: number, velocity?: {x:number,y:number,z:number}, outline?: object, sensor?: {kind:string,id:string} }} SensorDetection
 * @typedef {{ source: string, read: (timestamp?: number) => Array<{officerId:string,timestamp:number,position:{x:number,y:number,z:number},orientation:{yaw:number,pitch:number,roll:number}}> }} PoseProvider
 * @typedef {{ source: string, read: (timestamp?: number) => SensorDetection[] }} DetectionProvider
 */

import { visibleLandmarks } from "./simulation.js";
import { parameterValues } from "./params.js";

const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const blendAngle = (primary, secondary, secondaryWeight) =>
  wrapAngle(primary + wrapAngle(secondary - primary) * secondaryWeight);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function stereoPosition(officer, phase, sigma) {
  return {
    x: officer.x + Math.sin(phase) * sigma,
    y: 1.7,
    z: officer.y + Math.cos(phase * 1.13) * sigma,
  };
}

// Widely separated bearings make translation observable; a cluster does not.
function landmarkFix(landmarks, officer, range, fov, qualityScale) {
  const features = landmarks.map((landmark) => {
    const distance = Math.hypot(landmark.x - officer.x, landmark.y - officer.y);
    const nearWeight = 0.25 + 0.75 * (1 - clamp(distance / range, 0, 1));
    return {
      bearing: wrapAngle(Math.atan2(landmark.y - officer.y, landmark.x - officer.x) - officer.angle),
      weight: clamp(Number(landmark.strength) || 0, 0, 1) * nearWeight,
    };
  }).filter((feature) => feature.weight > 0);
  const support = features.reduce((total, feature) => total + feature.weight, 0);
  let pairs = 0, separation = 0;
  for (let index = 0; index < features.length; index += 1) {
    for (let other = index + 1; other < features.length; other += 1) {
      const pairWeight = features[index].weight * features[other].weight;
      pairs += pairWeight;
      separation += pairWeight * Math.abs(wrapAngle(features[index].bearing - features[other].bearing));
    }
  }
  const spread = pairs ? clamp(separation / pairs / fov, 0, 1) : 0;
  const geometry = 0.15 + 0.85 * spread;
  return {
    landmarks: features.length,
    spread,
    quality: 1 - Math.exp(-support * geometry / qualityScale),
  };
}

export function toSensorPosition(agent, height = 1) {
  return { x: agent.x, y: height, z: agent.y };
}

export function createSimulatedPoseProvider(world) {
  /** @type {PoseProvider} */
  return {
    source: "simulated-pose",
    read(timestamp = world.time * 1000) {
      return world.officers.map((officer) => ({
        officerId: officer.id,
        timestamp,
        position: toSensorPosition(officer, 1.7),
        orientation: { yaw: officer.angle, pitch: 0, roll: 0 },
      }));
    },
  };
}

/**
 * Lightweight self-localization seam for a head rig. Stereo map features and
 * compass heading form the primary pose; a deliberately imperfect IMU only
 * smooths that pose between readings. It is deterministic so regression tests
 * and demos remain repeatable.
 */
export class SelfLocalization {
  constructor(options = {}) {
    const {
    stereoPositionError,
    compassError,
    imuWeight,
    stereoGoodPositionError,
    stereoPoorPositionError,
    landmarkRange,
    landmarkFov,
    landmarkQualityScale,
    lostFixGrowth,
    outdoorPositionError,
    gpsPositionError,
    } = { ...parameterValues("localization"), ...options };
    this.stereoPositionError = stereoPositionError;
    this.compassError = compassError;
    this.imuWeight = imuWeight;
    this.stereoGoodPositionError = stereoGoodPositionError;
    this.stereoPoorPositionError = Math.max(stereoGoodPositionError, stereoPoorPositionError);
    this.landmarkRange = landmarkRange;
    this.landmarkFov = landmarkFov;
    this.landmarkQualityScale = landmarkQualityScale;
    this.lostFixGrowth = lostFixGrowth;
    this.outdoorPositionError = outdoorPositionError;
    this.gpsPositionError = gpsPositionError;
    this.states = new Map();
  }

  update(world, timestamp = world.time * 1000, { imuEnabled = true, gpsEnabled = false } = {}) {
    return world.officers.map((officer, index) => {
      const phase = timestamp / 1000 * 1.7 + index * 2.31;
      const previous = this.states.get(officer.id);
      const hasLandmarkMap = Array.isArray(world.landmarks) && world.landmarks.length > 0;
      let stereo, fix, lostFor = 0, lossDirection = null;
      if (world.environment === "outdoor") {
        // In an open area there is no fixed stereo map to anchor position.
        stereo = stereoPosition(officer, phase, this.outdoorPositionError);
        fix = { quality: 0, landmarks: 0, spread: 0, sigma: this.outdoorPositionError };
      } else if (!hasLandmarkMap) {
        // Preserve legacy worlds exactly until they opt into visual landmarks.
        stereo = stereoPosition(officer, phase, this.stereoPositionError);
        fix = { quality: 0, landmarks: 0, spread: 0, sigma: this.stereoPositionError };
      } else {
        const landmarks = visibleLandmarks(world, officer, {
          range: this.landmarkRange,
          fov: this.landmarkFov,
        });
        const measured = landmarkFix(
          landmarks,
          officer,
          this.landmarkRange,
          this.landmarkFov,
          this.landmarkQualityScale,
        );
        if (measured.landmarks) {
          const sigma = this.stereoPoorPositionError -
            (this.stereoPoorPositionError - this.stereoGoodPositionError) * measured.quality;
          stereo = stereoPosition(officer, phase, sigma);
          fix = { ...measured, sigma };
        } else {
          const dt = previous && timestamp > previous.timestamp
            ? (timestamp - previous.timestamp) / 1000
            : 0;
          lostFor = previous
            ? previous.lostFor + dt
            : (this.stereoPoorPositionError - this.stereoGoodPositionError) / Math.max(this.lostFixGrowth, 1e-6);
          const sigma = previous
            ? Math.min(
                this.stereoPoorPositionError,
                Math.max(previous.sigma, this.stereoGoodPositionError) + dt * this.lostFixGrowth,
              )
            : this.stereoPoorPositionError;
          const previousBias = previous?.coastBias;
          const biasLength = previousBias && Math.hypot(previousBias.x, previousBias.z);
          lossDirection = previous?.lossDirection ?? (biasLength
            ? { x: previousBias.x / biasLength, z: previousBias.z / biasLength }
            : { x: Math.sin(phase), z: Math.cos(phase * 1.13) });
          const targetBias = { x: lossDirection.x * sigma, z: lossDirection.z * sigma };
          // Retain the last pose bias, then drift toward a bounded dead-reckoning error.
          const blend = clamp(dt * 2.5, 0, 0.35);
          const bias = previous?.coastBias
            ? {
                x: previous.coastBias.x + (targetBias.x - previous.coastBias.x) * blend,
                z: previous.coastBias.z + (targetBias.z - previous.coastBias.z) * blend,
              }
            : targetBias;
          stereo = { x: officer.x + bias.x, y: 1.7, z: officer.y + bias.z };
          fix = { quality: 0, landmarks: 0, spread: 0, sigma };
        }
      }
      const gpsActive = gpsEnabled && world.environment === "outdoor";
      const gps = gpsActive ? stereoPosition(officer, phase * 0.37 + 1.3, this.gpsPositionError) : null;
      // Combine independent simulated position fixes by their stated variance.
      // GPS supplies no heading and has no effect in the indoor hall.
      const visualWeight = 1 / (fix.sigma * fix.sigma);
      const gpsWeight = gps ? 1 / (this.gpsPositionError * this.gpsPositionError) : 0;
      const primary = gps ? {
        x: (stereo.x * visualWeight + gps.x * gpsWeight) / (visualWeight + gpsWeight),
        y: 1.7,
        z: (stereo.z * visualWeight + gps.z * gpsWeight) / (visualWeight + gpsWeight),
      } : stereo;
      const compassYaw = wrapAngle(officer.angle + Math.sin(phase * 0.61) * this.compassError);
      let position = primary, yaw = compassYaw, imu = null;
      if (imuEnabled && previous && timestamp > previous.timestamp) {
        const dt = (timestamp - previous.timestamp) / 1000;
        const drift = 1 + 0.035 * Math.sin(phase * 1.9);
        // This is intentionally less accurate than the stereo/compass fix.
        const velocity = {
          x: (officer.x - previous.truth.x) / dt * drift + Math.sin(phase * 2.4) * 0.9,
          z: (officer.y - previous.truth.y) / dt * drift + Math.cos(phase * 2.1) * 0.9,
        };
        const yawRate = wrapAngle(officer.angle - previous.truth.angle) / dt + Math.sin(phase) * 0.018;
        imu = { velocity, yawRate };
        const predicted = {
          x: previous.position.x + velocity.x * dt,
          y: 1.7,
          z: previous.position.z + velocity.z * dt,
        };
        const predictedYaw = wrapAngle(previous.yaw + yawRate * dt);
        // Correct from stereo + compass first, then blend in the integrated IMU.
        position = {
          x: primary.x * (1 - this.imuWeight) + predicted.x * this.imuWeight,
          y: 1.7,
          z: primary.z * (1 - this.imuWeight) + predicted.z * this.imuWeight,
        };
        yaw = blendAngle(compassYaw, predictedYaw, this.imuWeight);
      }
      const estimate = {
        officerId: officer.id,
        timestamp,
        position,
        orientation: { yaw, pitch: 0, roll: 0 },
        sources: { stereo: true, compass: true, imu: imuEnabled, gps: gpsActive },
        fix,
        ...(gps ? { gps: { sigma: this.gpsPositionError } } : {}),
        ...(imu ? { imu } : {}),
      };
      this.states.set(officer.id, {
        timestamp,
        position,
        yaw,
        truth: { x: officer.x, y: officer.y, angle: officer.angle },
        coastBias: { x: position.x - officer.x, z: position.z - officer.y },
        lostFor,
        lossDirection,
        sigma: fix.sigma,
      });
      return estimate;
    });
  }

  reset() {
    this.states.clear();
  }
}

/** Fuse same-ID reports into a current, confidence-weighted live track. */
export class TrackStore {
  constructor({ staleAfterMs = 750 } = {}) {
    this.staleAfterMs = staleAfterMs;
    this.tracks = new Map();
  }

  ingest(detections, timestamp) {
    const grouped = new Map();
    for (const detection of detections) {
      const reports = grouped.get(detection.trackId) ?? [];
      reports.push(detection);
      grouped.set(detection.trackId, reports);
    }
    for (const [trackId, reports] of grouped) {
      const total = reports.reduce((sum, item) => sum + item.confidence, 0);
      const weighted = (axis) => reports.reduce((sum, item) => sum + item.position[axis] * item.confidence, 0) / total;
      const latest = reports.reduce((best, item) => item.timestamp > best.timestamp ? item : best);
      this.tracks.set(trackId, {
        trackId,
        timestamp: latest.timestamp,
        position: { x: weighted("x"), y: weighted("y"), z: weighted("z") },
        velocity: latest.velocity,
        confidence: Math.min(1, total / reports.length),
        outline: latest.outline,
        observers: reports.map((item) => item.officerId),
      });
    }
    this.expire(timestamp);
    return this.snapshot();
  }

  expire(timestamp) {
    for (const [trackId, track] of this.tracks) {
      if (timestamp - track.timestamp > this.staleAfterMs) this.tracks.delete(trackId);
    }
  }

  snapshot() {
    return [...this.tracks.values()];
  }
}

/** Named seam for future multi-camera / depth / LiDAR association algorithms. */
export class SensorFusion {
  constructor(store = new TrackStore()) {
    this.store = store;
  }

  update(detections, timestamp) {
    return this.store.ingest(detections, timestamp);
  }
}

/** Compatibility projection used by the shared-vision policy and current UI. */
export function tracksToObservations(tracks, vision) {
  const observations = tracks.map((track) => ({
    targetId: track.trackId,
    x: track.position.x,
    y: track.position.z,
    z: track.position.z,
    observers: track.observers,
    confidence: track.confidence,
    timestamp: track.timestamp,
    outline: track.outline,
  }));
  Object.defineProperty(observations, "vision", { value: vision });
  return observations;
}
