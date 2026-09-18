import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, stepWorld, visibleTo } from "../src/simulation.js";
import {
  TARGET_HEIGHT_METRES,
  StereoVisionPipeline,
  createStereoVisionProvider,
  detect,
  effectiveRange,
  metresToUnits,
  occluded,
  trackObservations,
} from "../src/vision.js";
import { detectorInput } from "../src/overlay.js";

function scene(officers, targets, walls = []) {
  return { time: 0, officers, targets, walls };
}

const officer = (id, x, y, angle = 0) => ({ id, x, y, angle, radius: 13 });
const target = (id, x, y) => ({ id, x, y, angle: 0, radius: 12 });

test("a plainly faced target produces exactly the declared stereo detection fields", () => {
  const world = scene([officer("P1", 0, 0)], [target("T1", 120, 0)]);
  const detections = detect(world, { noise: false });
  assert.equal(detections.length, 1);
  assert.deepEqual(Object.keys(detections[0]).sort(), [
    "confidence", "depth", "disparity", "officerId", "outline", "pixels",
    "position", "sensor", "sigma", "timestamp", "trackId",
  ]);
  assert.deepEqual(detections[0].sensor, { kind: "stereo-camera", id: "P1-stereo" });
  assert.deepEqual(detections[0].outline, { type: "capsule", height: TARGET_HEIGHT_METRES, radius: 0.28 });
});

test("a real world wall occludes stereo detection", () => {
  const world = createWorld();
  const from = world.officers[3];
  const to = world.targets[0];
  from.angle = Math.atan2(to.y - from.y, to.x - from.x);
  world.walls = [world.walls[0]];
  assert.equal(occluded(from, to, world.walls), true);
  assert.deepEqual(detect(world, { noise: false }).filter((item) => item.officerId === from.id && item.trackId === to.id), []);
});

test("targets behind the officer or outside horizontal FOV are not detected", () => {
  const world = scene([officer("P1", 0, 0)], [target("behind", -100, 0), target("side", 100, 100)]);
  assert.deepEqual(detect(world, { noise: false, fov: Math.PI / 3 }), []);
});

test("pixel height sets a real optics range limit", () => {
  const provider = createStereoVisionProvider(scene([], []), { noise: false });
  const optics = metresToUnits(Math.min(provider.rig.maxDepth, TARGET_HEIGHT_METRES * provider.rig.focalPx / provider.rig.minBoxHeightPx));
  assert.ok(effectiveRange(provider.rig, Infinity) <= optics);
  const world = scene([officer("P1", 0, 0)], [target("T1", optics + 1, 0)]);
  assert.deepEqual(detect(world, { noise: false, range: 10000 }), []);
});

test("noiseless triangulation round-trips simulation ground units", () => {
  const world = scene([officer("P1", 0, 0)], [target("T1", 120, 40)]);
  const detection = detect(world, { noise: false })[0];
  assert.ok(Math.abs(detection.position.x - 120) < 1e-6);
  assert.ok(Math.abs(detection.position.z - 40) < 1e-6);
});

test("seeded matcher noise is repeatable and grows with range", () => {
  const near = scene([officer("P1", 0, 0)], [target("T1", 100, 0)]);
  const far = scene([officer("P1", 0, 0)], [target("T1", 350, 0)]);
  assert.deepEqual(detect(near, { seed: 42 }), detect(near, { seed: 42 }));
  const nearError = Math.abs(detect(near, { seed: 42 })[0].position.x - 100);
  const farError = Math.abs(detect(far, { seed: 42 })[0].position.x - 350);
  assert.ok(farError > nearError);
});

test("two officers fuse reports into one track with both observers", () => {
  const world = scene([officer("P1", 0, 0), officer("P2", 0, 80, -Math.PI / 4)], [target("T1", 200, 0)]);
  const frame = new StereoVisionPipeline({ noise: false }).update(world);
  assert.equal(frame.detections.length, 2);
  assert.equal(frame.tracks.length, 1);
  assert.deepEqual(frame.tracks[0].observers.sort(), ["P1", "P2"]);
});

test("successive patrol frames produce a moving track", () => {
  const world = createWorld(5);
  world.officers = [world.officers[0]];
  world.targets = [world.targets[0]];
  const pipeline = new StereoVisionPipeline({ noise: false, tracker: { movingSpeed: 1 } });
  pipeline.update(world);
  stepWorld(world, 1, { autoPatrol: true });
  pipeline.update(world);
  stepWorld(world, 1, { autoPatrol: true });
  const frame = pipeline.update(world);
  assert.ok(frame.tracks[0].speed > 0);
  assert.equal(frame.tracks[0].moving, true);
});

test("track observations preserve motion fields and visibleTo ground axes", () => {
  const track = {
    trackId: "T1", position: { x: 120, y: 1, z: 40 }, velocity: { x: 3, y: 0, z: 4 },
    speed: 5, heading: 0.9, moving: true, sigma: 2, confidence: 0.8, timestamp: 10,
    observers: ["P1"], outline: { type: "capsule" }, coasting: false,
    trail: [{ x: 100, y: 1, z: 30 }], predicted: { x: 123, y: 1, z: 44 },
  };
  const observations = trackObservations([track], { range: 420, fov: Math.PI });
  assert.deepEqual(observations.vision, { range: 420, fov: Math.PI });
  assert.deepEqual(observations[0].velocity, { x: 3, y: 4 });
  assert.equal(observations[0].y, 40);
  const contacts = visibleTo(scene([officer("P1", 0, 0)], [], []), "P1", observations);
  assert.equal(contacts[0].moving, true);
  assert.deepEqual(contacts[0].predicted, { x: 123, y: 44 });
});

function sharedScene() {
  return scene(
    [officer("P1", 0, 0), officer("P2", 0, 80, -Math.atan2(80, 200))],
    [target("T1", 200, 0)],
  );
}

test("a pipeline publishes one skeleton frame for every observing officer", () => {
  const frame = new StereoVisionPipeline({ noise: false }).update(sharedScene(), 100);
  assert.equal(frame.skeletons.length, 2);
  assert.deepEqual(frame.skeletons.map((item) => item.publisherId).sort(), ["P1", "P2"]);
  assert.ok(frame.detections.every((detection) => detection.skeleton?.trackId === detection.trackId));
});

test("published skeleton frames are synthetic overlay layers", () => {
  const frame = new StereoVisionPipeline({ noise: false }).update(sharedScene(), 100);
  assert.ok(frame.skeletons.every((item) => item.layer === "overlay" && item.synthetic === true));
});

test("poses false suppresses skeleton publication", () => {
  const pipeline = new StereoVisionPipeline({ noise: false, poses: false });
  const frame = pipeline.update(sharedScene(), 100);
  assert.deepEqual(frame.skeletons, []);
  assert.ok(frame.detections.every((detection) => !("skeleton" in detection)));
  assert.deepEqual(pipeline.overlaysFor("P2", 100), []);
});

test("officers receive teammate skeletons but not their own", () => {
  const pipeline = new StereoVisionPipeline({ noise: false });
  pipeline.update(sharedScene(), 100);
  const layers = pipeline.overlaysFor("P1", 100);
  assert.equal(layers.some((item) => item.publisherId === "P1"), false);
  assert.equal(layers.some((item) => item.publisherId === "P2"), true);
});

test("detector input strips published overlays from a teammate feed", () => {
  const world = sharedScene();
  const pipeline = new StereoVisionPipeline({ noise: false });
  pipeline.update(world, 100);
  const feed = pipeline.feedFor(world, "P1", 100);
  assert.ok(feed.overlays.length > 0);
  assert.equal(detectorInput(feed).filter((item) => item.layer === "overlay" || item.synthetic).length, 0);
});

test("overlays do not create phantom stereo detections", () => {
  const world = sharedScene();
  const shared = new StereoVisionPipeline({ noise: false });
  const direct = new StereoVisionPipeline({ noise: false, poses: false });
  shared.update(world, 100);
  direct.update(world, 100);
  const withOverlays = shared.update(world, 200);
  const withoutOverlays = direct.update(world, 200);
  const fields = (detections) => detections.map((detection) => ({ ...detection, skeleton: undefined }));
  assert.deepEqual(fields(withOverlays.detections), fields(withoutOverlays.detections));
});

test("bypassed overlays appear only after teammates have shared poses", () => {
  const pipeline = new StereoVisionPipeline({ noise: false });
  assert.equal(pipeline.update(sharedScene(), 100).bypassed, 0);
  assert.ok(pipeline.update(sharedScene(), 200).bypassed > 0);
});

test("gait phase survives a configure call that changes only range", () => {
  const world = scene([officer("P1", 0, 0)], [target("T1", 120, 0)]);
  const pipeline = new StereoVisionPipeline({ noise: false });
  pipeline.update(world, 0);
  world.targets[0].x = 180;
  pipeline.update(world, 1000);
  const phase = pipeline.poser.phaseOf("T1");
  assert.notEqual(phase, 0);
  pipeline.configure({ range: 400 });
  assert.equal(pipeline.poser.phaseOf("T1"), phase);
});

test("track observations attach the highest-confidence supplied skeleton only", () => {
  const frame = new StereoVisionPipeline({ noise: false }).update(
    scene([officer("P1", 0, 0)], [target("T1", 120, 0)]),
    100,
  );
  const source = frame.skeletons[0];
  const low = { ...source, confidence: 0.1, skeleton: { ...source.skeleton, phase: 1 } };
  const high = { ...source, confidence: 0.9, skeleton: { ...source.skeleton, phase: 2 } };
  const observations = trackObservations(frame.tracks, { range: 420, fov: Math.PI }, [low, high]);
  assert.equal(observations[0].skeleton.phase, 2);
  assert.equal("skeleton" in trackObservations(frame.tracks, { range: 420, fov: Math.PI })[0], false);
});
