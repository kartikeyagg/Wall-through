const DEFAULTS = {
  height: 42,
  swing: 0.4,
  idleSway: 0.004,
  standingSpeed: 2,
  jointScore: 0.94,
  occludedScore: 0.45,
  seed: 7,
};

export const KEYPOINTS = Object.freeze([
  "nose", "neck", "rShoulder", "rElbow", "rWrist", "lShoulder", "lElbow", "lWrist",
  "rHip", "rKnee", "rAnkle", "lHip", "lKnee", "lAnkle", "rEye", "lEye", "rEar", "lEar",
]);

export const BONES = Object.freeze([
  { a: 1, b: 0, limb: "head", color: "#ff5a5a" },
  { a: 0, b: 14, limb: "head", color: "#ff7180" },
  { a: 14, b: 16, limb: "head", color: "#ff5a5a" },
  { a: 0, b: 15, limb: "head", color: "#ff7180" },
  { a: 15, b: 17, limb: "head", color: "#ff5a5a" },
  { a: 1, b: 2, limb: "arm", color: "#4fd8e8" },
  { a: 2, b: 3, limb: "arm", color: "#4fd8e8" },
  { a: 3, b: 4, limb: "arm", color: "#4fd8e8" },
  { a: 1, b: 5, limb: "arm", color: "#61ddea" },
  { a: 5, b: 6, limb: "arm", color: "#61ddea" },
  { a: 6, b: 7, limb: "arm", color: "#61ddea" },
  { a: 1, b: 8, limb: "torso", color: "#ffb347" },
  { a: 1, b: 11, limb: "torso", color: "#ffbf5b" },
  { a: 8, b: 9, limb: "leg", color: "#ffe066" },
  { a: 9, b: 10, limb: "leg", color: "#d8e84f" },
  { a: 11, b: 12, limb: "leg", color: "#ffe066" },
  { a: 12, b: 13, limb: "leg", color: "#d8e84f" },
]);

const finite = (value) => Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const valueOr = (value, fallback) => finite(value) ? value : fallback;

function settings(options = {}) {
  if (!options || typeof options !== "object") options = {};
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) result[key] = valueOr(options[key], DEFAULTS[key]);
  result.height = Math.max(0.001, result.height);
  result.strideLength = finite(options.strideLength) && options.strideLength > 0
    ? options.strideLength : result.height * 1.5;
  return result;
}

function hashTrackId(trackId) {
  let hash = 2166136261;
  for (let index = 0; index < trackId.length; index += 1) {
    hash ^= trackId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function rotateSagittal(vector, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: vector.x, y: vector.y * cosine - vector.z * sine, z: vector.y * sine + vector.z * cosine };
}

function rotateHeading(point, heading) {
  const cosine = Math.cos(heading);
  const sine = Math.sin(heading);
  return { x: point.z * cosine - point.x * sine, y: point.y, z: point.z * sine + point.x * cosine };
}

export function restPose(height) {
  const h = Math.max(0.001, valueOr(height, DEFAULTS.height));
  const point = (name, x, y, z = 0) => ({ name, index: KEYPOINTS.indexOf(name), x: x * h, y: y * h, z: z * h });
  return [
    point("nose", 0, 0.93, 0.04), point("neck", 0, 0.84, 0),
    point("rShoulder", -0.13, 0.82), point("rElbow", -0.115, 0.63), point("rWrist", -0.125, 0.46, 0.01),
    point("lShoulder", 0.13, 0.82), point("lElbow", 0.115, 0.63), point("lWrist", 0.125, 0.46, 0.01),
    point("rHip", -0.09, 0.53), point("rKnee", -0.09, 0.28), point("rAnkle", -0.09, 0.04),
    point("lHip", 0.09, 0.53), point("lKnee", 0.09, 0.28), point("lAnkle", 0.09, 0.04),
    point("rEye", -0.028, 0.95, 0.045), point("lEye", 0.028, 0.95, 0.045),
    point("rEar", -0.055, 0.94, -0.015), point("lEar", 0.055, 0.94, -0.015),
  ];
}

function poseLimbs(points, options, phase, moving) {
  const h = options.height;
  const strength = moving ? Math.min(1, options.speed / (4 * options.standingSpeed)) : 0;
  const wave = Math.sin(phase);
  const byName = Object.fromEntries(points.map((point) => [point.name, point]));
  for (const side of ["r", "l"]) {
    const sign = side === "r" ? -1 : 1;
    const hip = byName[`${side}Hip`];
    const knee = byName[`${side}Knee`];
    const ankle = byName[`${side}Ankle`];
    const legAngle = sign * options.swing * strength * wave;
    const ankleOffset = rotateSagittal({ x: 0, y: ankle.y - hip.y, z: ankle.z - hip.z }, legAngle);
    ankle.y = hip.y + ankleOffset.y;
    ankle.z = hip.z + ankleOffset.z;
    const alongLeg = 0.51;
    const kneeBend = 0.03 * h * strength * Math.max(0, 1 - Math.cos(legAngle));
    knee.y = hip.y + ankleOffset.y * alongLeg;
    knee.z = hip.z + ankleOffset.z * alongLeg + kneeBend;

    const shoulder = byName[`${side}Shoulder`];
    const elbow = byName[`${side}Elbow`];
    const wrist = byName[`${side}Wrist`];
    const armAngle = -legAngle * 0.6;
    const elbowOffset = rotateSagittal({ x: 0, y: elbow.y - shoulder.y, z: elbow.z - shoulder.z }, armAngle);
    const wristOffset = rotateSagittal({ x: 0, y: wrist.y - shoulder.y, z: wrist.z - shoulder.z }, armAngle);
    elbow.y = shoulder.y + elbowOffset.y;
    elbow.z = shoulder.z + elbowOffset.z;
    wrist.y = shoulder.y + wristOffset.y;
    wrist.z = shoulder.z + wristOffset.z;
  }
  if (moving) {
    const lean = 0.04 * h * strength;
    for (const point of points) if (point.y >= 0.8 * h) point.z += lean * point.y / (0.95 * h);
  }
}

export function poseSkeleton(state, options = {}) {
  const values = settings(options);
  const position = state?.position ?? {};
  const root = { x: valueOr(position.x, 0), y: valueOr(position.y, 0), z: valueOr(position.z, 0) };
  const trackId = typeof state?.trackId === "string" ? state.trackId : "";
  const heading = valueOr(state?.heading, 0);
  const speed = Math.max(0, valueOr(state?.speed, 0));
  const timestamp = valueOr(state?.timestamp, 0);
  const phase = finite(state?.phase) ? state.phase : 2 * Math.PI * speed * timestamp / 1000 / values.strideLength;
  const moving = speed >= values.standingSpeed;
  values.speed = speed;
  const points = restPose(values.height);
  poseLimbs(points, values, phase, moving);
  const bob = moving ? 0.01 * values.height * Math.abs(Math.sin(phase))
    : values.idleSway * values.height * Math.sin(phase + timestamp * Math.PI / 2000);
  const random = mulberry32((Math.floor(values.seed) ^ hashTrackId(trackId)) >>> 0);
  const joints = points.map((point) => {
    point.y += bob;
    const rotated = rotateHeading(point, heading);
    // Camera-specific visibility is decided by the observing rig, not this model.
    const score = clamp(values.jointScore + (random() - 0.5) * 0.04, 0, 1);
    return { name: point.name, index: point.index, x: root.x + rotated.x, y: root.y + rotated.y, z: root.z + rotated.z, score, visible: true };
  });
  return {
    trackId, timestamp, root, heading, height: values.height, speed, phase, joints,
    confidence: joints.reduce((sum, joint) => sum + joint.score, 0) / joints.length,
  };
}

export class SkeletonPoser {
  constructor(options = {}) {
    this.options = settings(options);
    this.tracks = new Map();
  }

  pose(tracks, timestamp) {
    const now = valueOr(timestamp, 0);
    for (const [trackId, track] of this.tracks) if (now - track.lastSeen >= 5000) this.tracks.delete(trackId);
    const result = [];
    for (const state of Array.isArray(tracks) ? tracks : []) {
      const trackId = typeof state?.trackId === "string" ? state.trackId : "";
      const observerId = typeof state?.officerId === "string" ? state.officerId : "";
      const key = observerId ? `${observerId}\u0000${trackId}` : trackId;
      let track = this.tracks.get(key);
      if (!track) track = { phase: 0, lastTimestamp: now, lastSeen: now };
      const dt = clamp((now - track.lastTimestamp) / 1000, 0, 0.25);
      const speed = Math.max(0, valueOr(state?.speed, 0));
      track.phase += 2 * Math.PI * speed * dt / this.options.strideLength;
      track.lastTimestamp = now;
      track.lastSeen = now;
      this.tracks.set(key, track);
      result.push(poseSkeleton({ ...state, timestamp: now, phase: track.phase }, this.options));
    }
    return result;
  }

  phaseOf(trackId, officerId) {
    const key = officerId ? `${officerId}\u0000${trackId}` : trackId;
    if (this.tracks.has(key)) return this.tracks.get(key).phase;
    if (!officerId) {
      for (const [stored, track] of this.tracks) if (stored.endsWith(`\u0000${trackId}`)) return track.phase;
    }
    return 0;
  }

  reset() { this.tracks.clear(); }
}

export function jointAt(skeleton, name) {
  return skeleton?.joints?.find((joint) => joint.name === name);
}

export function skeletonBounds(skeleton) {
  const joints = skeleton?.joints ?? [];
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const joint of joints) for (const axis of ["x", "y", "z"]) {
    min[axis] = Math.min(min[axis], joint[axis]);
    max[axis] = Math.max(max[axis], joint[axis]);
  }
  return { min, max };
}

export function skeletonSegments(skeleton, minScore = 0.3) {
  return BONES.flatMap((bone) => {
    const from = skeleton?.joints?.[bone.a];
    const to = skeleton?.joints?.[bone.b];
    return from && to && from.score >= minScore && to.score >= minScore
      ? [{ from, to, color: bone.color, limb: bone.limb, score: Math.min(from.score, to.score) }] : [];
  });
}
