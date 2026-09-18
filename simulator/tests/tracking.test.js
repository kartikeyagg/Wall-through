import test from "node:test";
import assert from "node:assert/strict";
import { MotionTracker, fuseMeasurements } from "../src/tracking.js";

const report = (x, t, extra = {}) => ({ trackId: "target", position: { x, y: 0, z: 0 }, sigma: 1, timestamp: t, confidence: 0.8, officerId: "one", ...extra });

test("constant velocity converges to velocity and heading", () => {
  const tracker = new MotionTracker({ processNoise: 2 });
  let track;
  for (let t = 0; t <= 5000; t += 100) track = tracker.update([report(t / 100, t, { position: { x: t / 100, y: 0, z: t / 200 } })], t)[0];
  assert.ok(Math.abs(track.velocity.x - 10) < 0.3);
  assert.ok(Math.abs(track.velocity.z - 5) < 0.2);
  assert.ok(Math.abs(track.heading - Math.atan2(5, 10)) < 0.03);
});

test("filter output has lower RMS error than noisy measurements", () => {
  const tracker = new MotionTracker({ processNoise: 3 });
  let raw = 0, filtered = 0, count = 0;
  for (let t = 0; t <= 8000; t += 100) {
    const truth = t / 100;
    const noise = Math.sin(t * 0.071) * 8 + Math.cos(t * 0.023) * 4;
    const track = tracker.update([report(truth + noise, t, { sigma: 9 })], t)[0];
    if (t > 1000) { raw += noise ** 2; filtered += (track.position.x - truth) ** 2; count += 1; }
  }
  assert.ok(Math.sqrt(filtered / count) < Math.sqrt(raw / count));
});

test("inverse-variance fusion favors precise reports and lowers uncertainty", () => {
  const fused = fuseMeasurements([report(0, 10, { sigma: 1 }), report(10, 10, { sigma: 5, officerId: "two", confidence: 0.9 })]);
  assert.ok(fused.position.x < 1);
  assert.ok(fused.sigma < 1 && fused.sigma < 5);
  assert.equal(fused.officerId, "two");
});

test("a low-sigma and high-sigma report fuse closer to the low-sigma position", () => {
  const fused = fuseMeasurements([report(2, 10, { sigma: 0.5 }), report(100, 10, { sigma: 20 })]);
  assert.ok(Math.abs(fused.position.x - 2) < Math.abs(fused.position.x - 100));
});

test("track coasts then expires after stale timeout", () => {
  const tracker = new MotionTracker({ staleAfterMs: 100 });
  tracker.update([report(0, 0)], 0);
  const coast = tracker.update([], 50)[0];
  assert.equal(coast.coasting, true);
  assert.equal(coast.missedMs, 50);
  assert.deepEqual(tracker.update([], 101), []);
});

test("moving hysteresis latches on and off", () => {
  const tracker = new MotionTracker({ processNoise: 1, movingSpeed: 5 });
  tracker.update([report(0, 0, { sigma: 0.01 })], 0);
  let track;
  for (let t = 100; t <= 1000; t += 100) track = tracker.update([report(t / 10, t, { sigma: 0.01 })], t)[0];
  assert.equal(track.moving, true);
  for (let t = 1100; t <= 4000; t += 100) track = tracker.update([report(100, t, { sigma: 0.01 })], t)[0];
  assert.equal(track.moving, false);
});

test("stationary noisy target stays static and vertical motion has no ground speed", () => {
  const tracker = new MotionTracker({ processNoise: 1, movingSpeed: 3 });
  let track;
  for (let t = 0; t <= 3000; t += 100) track = tracker.update([report(Math.sin(t) * 0.1, t, { position: { x: Math.sin(t) * 0.1, y: t / 10, z: Math.cos(t) * 0.1 }, sigma: 0.5 })], t)[0];
  assert.equal(track.moving, false);
  assert.ok(track.speed < 1);
});

test("trail spacing and length are bounded", () => {
  const tracker = new MotionTracker({ trailIntervalMs: 100, trailLength: 3 });
  for (let t = 0; t <= 500; t += 50) tracker.update([report(t, t)], t);
  const trail = tracker.snapshot()[0].trail;
  assert.equal(trail.length, 3);
  assert.ok(trail.every((point, index) => !index || point.t - trail[index - 1].t >= 100));
});

test("prediction leads filtered position along velocity", () => {
  const tracker = new MotionTracker({ processNoise: 1, lookaheadMs: 500 });
  let track;
  for (let t = 0; t <= 2000; t += 100) track = tracker.update([report(t / 100, t, { sigma: 0.1 })], t)[0];
  assert.ok(track.predicted.x > track.position.x);
});

test("non-finite measurements are ignored", () => {
  const tracker = new MotionTracker();
  assert.doesNotThrow(() => tracker.update([report(NaN, 0), report(1, Infinity)], 0));
  assert.deepEqual(tracker.snapshot(), []);
});
