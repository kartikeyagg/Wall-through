const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const defaults = {
  baseline: 0.08,
  imageWidth: 1280,
  imageHeight: 720,
  hfov: 117,
  mountHeight: 1.7,
  minDisparityPx: 1.2,
  disparityNoisePx: 0.15,
  centroidNoisePx: 0.4,
  minBoxHeightPx: 32,
  detectorConfidence: 0.97,
};

const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

function rotateX(point, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x,
    y: cosine * point.y - sine * point.z,
    z: sine * point.y + cosine * point.z,
  };
}

function rotateZ(point, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * point.x - sine * point.y,
    y: sine * point.x + cosine * point.y,
    z: point.z,
  };
}

export function createStereoRig(config = {}) {
  const values = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    values[key] = finiteOr(config[key], fallback);
  }
  values.hfov = clamp(values.hfov, 20, 170);
  values.baseline = clamp(values.baseline, 0.01, 1);
  values.minDisparityPx = Math.max(0.05, values.minDisparityPx);

  const hfovRad = values.hfov * Math.PI / 180;
  const focalPx = (values.imageWidth / 2) / Math.tan(hfovRad / 2);
  return {
    ...values,
    focalPx,
    hfovRad,
    vfovRad: 2 * Math.atan((values.imageHeight / 2) / focalPx),
    maxDepth: focalPx * values.baseline / values.minDisparityPx,
    cx: values.imageWidth / 2,
    cy: values.imageHeight / 2,
  };
}

export function worldToRig(point, pose) {
  const yaw = pose.yaw;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const offset = {
    x: point.x - pose.position.x,
    y: point.y - pose.position.y,
    z: point.z - pose.position.z,
  };
  const level = {
    x: offset.x * sine - offset.z * cosine,
    y: offset.y,
    z: offset.x * cosine + offset.z * sine,
  };
  return rotateZ(rotateX(level, -(pose.pitch ?? 0)), -(pose.roll ?? 0));
}

export function rigToWorld(point, pose) {
  const level = rotateX(rotateZ(point, pose.roll ?? 0), pose.pitch ?? 0);
  const cosine = Math.cos(pose.yaw);
  const sine = Math.sin(pose.yaw);
  return {
    x: pose.position.x + level.x * sine + level.z * cosine,
    y: pose.position.y + level.y,
    z: pose.position.z - level.x * cosine + level.z * sine,
  };
}

export function cameraCentres(pose, rig) {
  return {
    left: rigToWorld({ x: -rig.baseline / 2, y: 0, z: 0 }, pose),
    right: rigToWorld({ x: rig.baseline / 2, y: 0, z: 0 }, pose),
  };
}

export function projectPoint(pointRig, rig) {
  if (pointRig.z <= 1e-6) return null;
  const uLeft = rig.cx + rig.focalPx * (pointRig.x + rig.baseline / 2) / pointRig.z;
  const uRight = rig.cx + rig.focalPx * (pointRig.x - rig.baseline / 2) / pointRig.z;
  return {
    uLeft,
    uRight,
    v: rig.cy - rig.focalPx * pointRig.y / pointRig.z,
    disparity: uLeft - uRight,
    depth: pointRig.z,
  };
}

export function disparityToDepth(disparity, rig) {
  return disparity <= 0 ? Infinity : rig.focalPx * rig.baseline / disparity;
}

export function depthToDisparity(depth, rig) {
  return rig.focalPx * rig.baseline / depth;
}

export function depthSigma(depth, rig) {
  return depth * depth * rig.disparityNoisePx / (rig.focalPx * rig.baseline);
}

export function projectedSizePx(metres, depth, rig) {
  return metres * rig.focalPx / depth;
}

export function inFrame(projection, rig) {
  return projection.uLeft >= 0 && projection.uLeft <= rig.imageWidth
    && projection.uRight >= 0 && projection.uRight <= rig.imageWidth
    && projection.v >= 0 && projection.v <= rig.imageHeight;
}

export function backProject(measurement, pose, rig) {
  const depth = disparityToDepth(measurement.disparity, rig);
  return rigToWorld({
    x: (measurement.uLeft - rig.cx) * depth / rig.focalPx - rig.baseline / 2,
    y: (rig.cy - measurement.v) * depth / rig.focalPx,
    z: depth,
  }, pose);
}

export function observePoint(point, pose, rig, options = {}) {
  const projection = projectPoint(worldToRig(point, pose), rig);
  if (!projection) return null;

  const trueDepth = projection.depth;
  const heightPx = projectedSizePx(options.height ?? 1.75, trueDepth, rig);
  const widthPx = projectedSizePx(options.width ?? 0.55, trueDepth, rig);
  let { disparity, uLeft, v } = projection;
  if (options.random) {
    disparity += options.random() * rig.disparityNoisePx;
    uLeft += options.random() * rig.centroidNoisePx;
    v += options.random() * rig.centroidNoisePx;
  }
  const depth = disparityToDepth(disparity, rig);
  const measured = { uLeft, uRight: uLeft - disparity, v, disparity, depth };
  const framed = inFrame(measured, rig);
  const usable = framed && disparity >= rig.minDisparityPx
    && heightPx >= rig.minBoxHeightPx && depth > 0;
  const confidence = usable ? clamp(
    rig.detectorConfidence
      * clamp(heightPx / (rig.minBoxHeightPx * 3), 0, 1) ** 0.5
      * clamp(disparity / (rig.minDisparityPx * 4), 0, 1) ** 0.25,
    0,
    rig.detectorConfidence,
  ) : 0;
  return {
    ...measured,
    inFrame: framed,
    usable,
    heightPx,
    widthPx,
    sigma: depthSigma(depth, rig),
    confidence,
    position: backProject(measured, pose, rig),
    trueDepth,
  };
}

export function createRng(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function createGaussian(seed = 1) {
  const random = createRng(seed);
  let spare = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    const radius = Math.sqrt(-2 * Math.log(1 - random()));
    const angle = 2 * Math.PI * random();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}
