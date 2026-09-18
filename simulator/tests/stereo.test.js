import test from "node:test";
import assert from "node:assert/strict";
import {
  backProject,
  createGaussian,
  createRng,
  createStereoRig,
  depthSigma,
  observePoint,
  projectPoint,
  rigToWorld,
  worldToRig,
} from "../src/stereo.js";

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

const nearPoint = (actual, expected, tolerance = 1e-9) => {
  near(actual.x, expected.x, tolerance);
  near(actual.y, expected.y, tolerance);
  near(actual.z, expected.z, tolerance);
};

const pose = { position: { x: 4, y: 1.7, z: -3 }, yaw: 0.4, pitch: 0.2, roll: -0.1 };

test("rig derives focal length, vertical field of view, and disparity far plane", () => {
  const rig = createStereoRig({ imageWidth: 1000, imageHeight: 500, hfov: 90, baseline: 0.2, minDisparityPx: 2 });
  near(rig.focalPx, 500);
  near(rig.vfovRad, 2 * Math.atan(0.5));
  near(rig.maxDepth, 50);
});

test("world and rig coordinates are inverse with pitch and roll", () => {
  const point = { x: 12.3, y: -0.4, z: 8.9 };
  nearPoint(rigToWorld(worldToRig(point, pose), pose), point);
});

test("rectified projections share epipolar rows and disparity falls as one over depth", () => {
  const rig = createStereoRig();
  const nearProjection = projectPoint({ x: 1, y: 0.3, z: 10 }, rig);
  const farProjection = projectPoint({ x: 1, y: 0.3, z: 20 }, rig);
  assert.ok(nearProjection && farProjection);
  near(nearProjection.v, rig.cy - rig.focalPx * 0.3 / 10);
  near(farProjection.v, rig.cy - rig.focalPx * 0.3 / 20);
  near(nearProjection.disparity / farProjection.disparity, 2);
});

test("noiseless projection and back projection round trip through world coordinates", () => {
  const rig = createStereoRig();
  const point = { x: 15, y: 2.8, z: 20 };
  const projection = projectPoint(worldToRig(point, pose), rig);
  assert.ok(projection);
  nearPoint(backProject(projection, pose, rig), point);
});

test("depth uncertainty grows quadratically with range", () => {
  const rig = createStereoRig();
  near(depthSigma(40, rig) / depthSigma(10, rig), 16);
});

test("observations become unusable below box and disparity thresholds", () => {
  const rig = createStereoRig();
  const levelPose = { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
  const tooSmall = observePoint({ x: rig.focalPx * 1.75 / (rig.minBoxHeightPx - 1), y: 0, z: 0 }, levelPose, rig);
  const tooFar = observePoint({ x: rig.maxDepth + 1, y: 0, z: 0 }, levelPose, rig);
  assert.ok(tooSmall && tooFar);
  assert.equal(tooSmall.usable, false);
  assert.equal(tooFar.usable, false);
});

test("points behind the head have no projection", () => {
  const rig = createStereoRig();
  assert.equal(projectPoint({ x: 0, y: 0, z: 0 }, rig), null);
  assert.equal(observePoint({ x: -1, y: 0, z: 0 }, { position: { x: 0, y: 0, z: 0 }, yaw: 0 }, rig), null);
});

test("a point outside the horizontal field of view is reported out of frame", () => {
  const rig = createStereoRig();
  const observation = observePoint({ x: 1, y: 0, z: 10 }, { position: { x: 0, y: 0, z: 0 }, yaw: 0 }, rig);
  assert.ok(observation);
  assert.equal(observation.inFrame, false);
});

test("seeded uniform and Gaussian generators reproduce their sequences", () => {
  const first = createRng(42);
  const second = createRng(42);
  assert.deepEqual(Array.from({ length: 6 }, first), Array.from({ length: 6 }, second));
  const firstGaussian = createGaussian(42);
  const secondGaussian = createGaussian(42);
  assert.deepEqual(Array.from({ length: 6 }, firstGaussian), Array.from({ length: 6 }, secondGaussian));
});

test("seeded matcher noise is deterministic and its triangulation error grows with range", () => {
  const rig = createStereoRig();
  const levelPose = { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
  const nearPoint = { x: 5, y: 0, z: 0 };
  const farPoint = { x: 20, y: 0, z: 0 };
  const first = observePoint(farPoint, levelPose, rig, { random: createGaussian(7) });
  const second = observePoint(farPoint, levelPose, rig, { random: createGaussian(7) });
  const nearObservation = observePoint(nearPoint, levelPose, rig, { random: () => 1 });
  const farObservation = observePoint(farPoint, levelPose, rig, { random: () => 1 });
  assert.deepEqual(first, second);
  assert.ok(nearObservation && farObservation);
  assert.ok(Math.abs(farObservation.position.x - farPoint.x) > Math.abs(nearObservation.position.x - nearPoint.x));
});

test("confidence is bounded by the detector maximum", () => {
  const rig = createStereoRig();
  const levelPose = { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
  for (const point of [{ x: 3, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }]) {
    const observation = observePoint(point, levelPose, rig);
    assert.ok(observation);
    assert.ok(observation.confidence >= 0 && observation.confidence <= rig.detectorConfidence);
  }
});
