/**
 * Hardware-neutral sensor contract. Future camera, RealSense and LiDAR
 * adapters must emit SensorDetection objects with this same shape.
 * Coordinates are right-handed metres-in-simulation: x across, y up, z deep.
 *
 * @typedef {{ timestamp: number, officerId: string, trackId: string, position: {x:number,y:number,z:number}, confidence: number, velocity?: {x:number,y:number,z:number}, outline?: object, sensor?: {kind:string,id:string} }} SensorDetection
 * @typedef {{ source: string, read: (timestamp?: number) => Array<{officerId:string,timestamp:number,position:{x:number,y:number,z:number},orientation:{yaw:number,pitch:number,roll:number}}> }} PoseProvider
 * @typedef {{ source: string, read: (timestamp?: number) => SensorDetection[] }} DetectionProvider
 */
import { canSee } from "./simulation.js";

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

export function createSimulatedDetectionProvider(world, { range = 420, fov = Math.PI * 0.65 } = {}) {
  /** @type {DetectionProvider} */
  return {
    source: "simulated-camera",
    read(timestamp = world.time * 1000) {
      return world.officers.flatMap((officer) =>
        world.targets
          .filter((target) => canSee(officer, target, world.walls, range, fov))
          .map((target) => ({
            timestamp,
            officerId: officer.id,
            trackId: target.id,
            position: toSensorPosition(target),
            velocity: { x: Math.cos(target.angle) * 44, y: 0, z: Math.sin(target.angle) * 44 },
            confidence: 0.99,
            outline: { type: "capsule", height: 1.75, radius: 0.28 },
            sensor: { kind: "camera", id: `${officer.id}-sim-camera` },
          })),
      );
    },
  };
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
