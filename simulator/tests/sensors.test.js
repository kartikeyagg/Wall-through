import test from "node:test";
import assert from "node:assert/strict";
import { SelfLocalization } from "../src/sensors.js";
import { createWorld } from "../src/simulation.js";

const distanceError = (estimate, officer) =>
  Math.hypot(estimate.position.x - officer.x, estimate.position.z - officer.y);

function landmark(id, x, y, { strength = 1, normal = { x: 0, y: 0 }, kind = "floor-marking" } = {}) {
  return { id, kind, x, y, height: kind === "floor-marking" ? 0 : 1.7, width: 18, normal, color: "#d8a52b", strength };
}

function world({ angle = 0, landmarks = [], walls = [] } = {}) {
  return {
    time: 0,
    officers: [{ id: "P1", x: 0, y: 0, angle, radius: 13 }],
    targets: [],
    sensors: [],
    walls,
    landmarks,
  };
}

const estimate = (localizer, subject, timestamp = 1_000, imuEnabled = false) =>
  localizer.update(subject, timestamp, { imuEnabled })[0];

test("a landmark-rich direction localizes more tightly than a bare direction", () => {
  const features = [
    landmark("a", 90, -70), landmark("b", 95, -25),
    landmark("c", 95, 25), landmark("d", 90, 70),
  ];
  const richWorld = world({ landmarks: features });
  const bareWorld = world({ angle: Math.PI, landmarks: features });
  const rich = estimate(new SelfLocalization(), richWorld);
  const bare = estimate(new SelfLocalization(), bareWorld);
  assert.ok(rich.fix.landmarks > 0);
  assert.equal(bare.fix.landmarks, 0);
  assert.ok(rich.fix.sigma < bare.fix.sigma);
  assert.ok(distanceError(rich, richWorld.officers[0]) < distanceError(bare, bareWorld.officers[0]));
});

test("feature count and strength both improve the visual fix", () => {
  const weak = world({ landmarks: [landmark("weak", 100, 0, { strength: 0.2 })] });
  const strong = world({ landmarks: [landmark("strong", 100, 0)] });
  const many = world({ landmarks: [
    landmark("a", 100, -45), landmark("b", 100, 0), landmark("c", 100, 45),
  ] });
  const weakFix = estimate(new SelfLocalization(), weak);
  const strongFix = estimate(new SelfLocalization(), strong);
  const manyFix = estimate(new SelfLocalization(), many);
  assert.ok(strongFix.fix.quality > weakFix.fix.quality);
  assert.ok(strongFix.fix.sigma < weakFix.fix.sigma);
  assert.ok(manyFix.fix.landmarks > strongFix.fix.landmarks);
  assert.ok(manyFix.fix.sigma < strongFix.fix.sigma);
});

test("bearing spread prevents a same-direction feature cluster from overclaiming accuracy", () => {
  const clustered = world({ landmarks: [
    landmark("a", 100, -4), landmark("b", 100, 0), landmark("c", 100, 4),
  ] });
  const spread = world({ landmarks: [
    landmark("a", 100, -115), landmark("b", 100, 0), landmark("c", 100, 115),
  ] });
  const clusteredFix = estimate(new SelfLocalization(), clustered);
  const spreadFix = estimate(new SelfLocalization(), spread);
  assert.equal(clusteredFix.fix.landmarks, spreadFix.fix.landmarks);
  assert.ok(spreadFix.fix.spread > clusteredFix.fix.spread);
  assert.ok(spreadFix.fix.sigma < clusteredFix.fix.sigma);
});

test("occlusion and a wall feature's facing rule remove its localization benefit", () => {
  const art = landmark("art", 100, 0, { kind: "wall-art", normal: { x: -1, y: 0 } });
  const visible = world({ landmarks: [art] });
  const blocked = world({ landmarks: [art], walls: [{ x: 45, y: -20, w: 10, h: 40 }] });
  const reverseFacing = world({ landmarks: [{ ...art, normal: { x: 1, y: 0 } }] });
  const visibleFix = estimate(new SelfLocalization(), visible);
  const blockedFix = estimate(new SelfLocalization(), blocked);
  const reverseFix = estimate(new SelfLocalization(), reverseFacing);
  assert.equal(visibleFix.fix.landmarks, 1);
  assert.equal(blockedFix.fix.landmarks, 0);
  assert.equal(reverseFix.fix.landmarks, 0);
  assert.ok(visibleFix.fix.sigma < blockedFix.fix.sigma);
  assert.equal(blockedFix.fix.sigma, reverseFix.fix.sigma);
});

test("loss of all visible landmarks coasts smoothly with growing, bounded uncertainty", () => {
  const subject = world({ landmarks: [landmark("seen", 100, 0)] });
  const localizer = new SelfLocalization({ stereoGoodPositionError: 0.1, stereoPoorPositionError: 0.8, lostFixGrowth: 0.4 });
  const acquired = estimate(localizer, subject, 1_000);
  subject.officers[0].angle = Math.PI;
  const lostSoon = estimate(localizer, subject, 1_100);
  const lostLonger = estimate(localizer, subject, 2_100);
  assert.equal(lostSoon.fix.landmarks, 0);
  assert.ok(lostLonger.fix.sigma > lostSoon.fix.sigma);
  assert.ok(lostLonger.fix.sigma <= 0.8);
  assert.ok(Math.hypot(lostSoon.position.x - acquired.position.x, lostSoon.position.z - acquired.position.z) < 0.8);
  assert.ok(distanceError(lostLonger, subject.officers[0]) <= 0.8);
});

test("worlds without landmarks retain the legacy fixed stereo error exactly", () => {
  const subject = {
    time: 0,
    officers: [{ id: "P1", x: 12, y: -8, angle: 0.4, radius: 13 }],
    targets: [], sensors: [], walls: [],
  };
  const timestamp = 1_234;
  const error = 0.7;
  const result = estimate(new SelfLocalization({ stereoPositionError: error }), subject, timestamp);
  const phase = timestamp / 1000 * 1.7;
  assert.deepEqual(result.position, {
    x: 12 + Math.sin(phase) * error,
    y: 1.7,
    z: -8 + Math.cos(phase * 1.13) * error,
  });
  assert.deepEqual(result.fix, { quality: 0, landmarks: 0, spread: 0, sigma: error });
  const emptyMap = estimate(new SelfLocalization({ stereoPositionError: error }), {
    ...subject,
    landmarks: [],
  }, timestamp);
  assert.deepEqual(emptyMap.position, result.position);
});

test("localization remains deterministic and keeps the optional IMU contract", () => {
  const subject = world({ landmarks: [landmark("a", 100, -35), landmark("b", 100, 35)] });
  const first = new SelfLocalization();
  const second = new SelfLocalization();
  assert.deepEqual(estimate(first, structuredClone(subject), 1_000), estimate(second, structuredClone(subject), 1_000));
  const withoutImu = estimate(new SelfLocalization(), subject, 1_000, false);
  assert.equal(withoutImu.sources.imu, false);
  assert.equal(withoutImu.imu, undefined);
  for (const field of ["officerId", "timestamp", "position", "orientation", "sources", "fix"]) {
    assert.ok(field in withoutImu);
  }
  const withImuLocalizer = new SelfLocalization();
  estimate(withImuLocalizer, subject, 900, true);
  const withImu = estimate(withImuLocalizer, subject, 1_000, true);
  assert.ok(withImu.imu);
  assert.equal(withImu.sources.imu, true);
});

test("GPS improves outdoor position only when enabled and never changes indoor localization", () => {
  const outdoor = createWorld(7, { environment: "outdoor" });
  const indoor = createWorld(7);
  assert.equal(outdoor.walls.length, 0);
  assert.equal(outdoor.landmarks.length, 0);
  const bare = new SelfLocalization().update(outdoor, 1_000, { imuEnabled: false })[0];
  const withGps = new SelfLocalization().update(outdoor, 1_000, { imuEnabled: false, gpsEnabled: true })[0];
  assert.equal(bare.sources.gps, false);
  assert.equal(withGps.sources.gps, true);
  assert.ok(withGps.gps.sigma > 0);
  assert.ok(distanceError(withGps, outdoor.officers[0]) < distanceError(bare, outdoor.officers[0]));
  const indoorWithout = new SelfLocalization().update(indoor, 1_000, { imuEnabled: false })[0];
  const indoorWith = new SelfLocalization().update(indoor, 1_000, { imuEnabled: false, gpsEnabled: true })[0];
  assert.deepEqual(indoorWith, indoorWithout);
});
