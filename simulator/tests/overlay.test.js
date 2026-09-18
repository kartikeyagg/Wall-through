import test from "node:test";
import assert from "node:assert/strict";
import {
  OverlayBus,
  bypassedCount,
  composeFeed,
  detectorInput,
  isOverlay,
  publishSkeleton,
} from "../src/overlay.js";

const skeleton = (trackId = "T1", timestamp = 0, confidence = 0.9) => ({ trackId, timestamp, joints: [], confidence });
const subject = (id = "real") => ({ id, x: 1, y: 2 });

test("publishSkeleton uses skeleton defaults and publisher-track frame IDs", () => {
  const pose = skeleton("T1", 12, 0.9);
  assert.deepEqual(publishSkeleton("officer-a", pose), {
    frameId: "officer-a:T1", publisherId: "officer-a", trackId: "T1", timestamp: 12,
    skeleton: pose, confidence: 0.9, layer: "overlay", synthetic: true,
  });
  const explicit = publishSkeleton("officer-a", pose, 14, 0.6);
  assert.equal(explicit.timestamp, 14);
  assert.equal(explicit.confidence, 0.6);
});

test("isOverlay recognizes discriminators and safely rejects ordinary values", () => {
  assert.equal(isOverlay({ layer: "overlay" }), true);
  assert.equal(isOverlay({ synthetic: true }), true);
  assert.equal(isOverlay({ bypassDetector: true }), true);
  assert.equal(isOverlay(subject()), false);
  assert.equal(isOverlay(null), false);
  assert.equal(isOverlay(7), false);
  assert.equal(isOverlay([]), false);
});

test("composeFeed copies caller arrays and treats nullish arrays as empty", () => {
  const subjects = [subject()];
  const overlays = [{ bypassDetector: true }];
  const feed = composeFeed("a", subjects, overlays, 10);
  subjects.push(subject("later"));
  overlays.push({ bypassDetector: true });
  assert.equal(feed.subjects.length, 1);
  assert.equal(feed.overlays.length, 1);
  assert.notEqual(feed.subjects, subjects);
  assert.notEqual(feed.overlays, overlays);
  assert.deepEqual(composeFeed("a", null, undefined, 10).subjects, []);
});

test("detectorInput leaves only real feed subjects and never mutates the feed", () => {
  const real = subject();
  const feed = composeFeed("a", [real], [{ bypassDetector: true }], 10);
  const input = detectorInput(feed);
  assert.deepEqual(input, [real]);
  assert.notEqual(input, feed.subjects);
  assert.equal(feed.overlays.length, 1);
});

test("detectorInput removes overlays smuggled into subjects to prevent feedback loops", () => {
  const feed = composeFeed("a", [subject(), { layer: "overlay" }, { synthetic: true }], [], 10);
  const input = detectorInput(feed);
  assert.equal(input.length, 1);
  assert.ok(input.every((item) => !isOverlay(item)));
});

test("detectorInput returns an empty array for nullish or malformed feeds", () => {
  assert.deepEqual(detectorInput(null), []);
  assert.deepEqual(detectorInput({ subjects: "not an array" }), []);
});

test("bypassedCount includes displayed overlays and leaked subject overlays", () => {
  const feed = composeFeed("a", [subject(), { synthetic: true }, { bypassDetector: true }], [{}, {}], 0);
  assert.equal(bypassedCount(feed), 4);
});

test("OverlayBus replaces matching publisher-track frames but retains distinct publishers", () => {
  const bus = new OverlayBus();
  bus.publish([publishSkeleton("a", skeleton("T1", 0))], 0);
  bus.publish([publishSkeleton("a", skeleton("T1", 20))], 20);
  bus.publish([publishSkeleton("b", skeleton("T1", 30))], 30);
  const frames = bus.frames().sort((left, right) => left.frameId.localeCompare(right.frameId));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].timestamp, 20);
  assert.deepEqual(frames.map((frame) => frame.frameId), ["a:T1", "b:T1"]);
});

test("layersFor excludes self by default and can include it", () => {
  const bus = new OverlayBus();
  bus.publish([publishSkeleton("a", skeleton("T1", 0)), publishSkeleton("b", skeleton("T2", 0))], 0);
  assert.deepEqual(bus.layersFor("a", 0).map((layer) => layer.publisherId), ["b"]);
  assert.equal(bus.layersFor("a", 0, { includeSelf: true }).length, 2);
});

test("layersFor suppresses all layers when sharing is false", () => {
  const bus = new OverlayBus();
  bus.publish([publishSkeleton("a", skeleton())], 0);
  assert.deepEqual(bus.layersFor("b", 0, { sharing: false }), []);
});

test("layers stay opaque through hold, fade to their floor, and remain bounded while live", () => {
  const bus = new OverlayBus();
  bus.publish([publishSkeleton("a", skeleton("T1", 0))], 0);
  assert.equal(bus.layersFor("b", 400)[0].opacity, 0.35);
  assert.ok(Math.abs(bus.layersFor("b", 700)[0].opacity - 0.2) < 1e-12);
  assert.equal(bus.layersFor("b", 1000)[0].opacity, 0.05);
});

test("stale layers disappear and prune removes their stored frames", () => {
  const bus = new OverlayBus();
  bus.publish([publishSkeleton("a", skeleton())], 0);
  assert.deepEqual(bus.layersFor("b", 1001), []);
  bus.prune(1001);
  assert.deepEqual(bus.frames(), []);
});

test("layers are newest first with frame IDs breaking timestamp ties", () => {
  const bus = new OverlayBus();
  bus.publish([
    publishSkeleton("z", skeleton("T", 10)),
    publishSkeleton("a", skeleton("T", 10)),
    publishSkeleton("m", skeleton("T", 20)),
  ], 20);
  assert.deepEqual(bus.layersFor("receiver", 20).map((layer) => layer.frameId), ["m:T", "a:T", "z:T"]);
});

test("bypassed accumulates returned layers and reset clears it with stored frames", () => {
  const bus = new OverlayBus();
  bus.publish([publishSkeleton("a", skeleton("T1")), publishSkeleton("b", skeleton("T2"))], 0);
  bus.layersFor("receiver", 0);
  bus.layersFor("a", 0);
  assert.equal(bus.bypassed, 3);
  bus.reset();
  assert.equal(bus.bypassed, 0);
  assert.deepEqual(bus.frames(), []);
});
