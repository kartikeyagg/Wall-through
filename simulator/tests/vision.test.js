import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, recallSensor, stepWorld, throwSensor, visibleTo } from "../src/simulation.js";
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
import { BONES, restPose } from "../src/skeleton.js";

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

test("an uncapped pipeline captures stereo on every update", () => {
  const world = scene([officer("P1", 0, 0)], [target("T1", 120, 0)]);
  const pipeline = new StereoVisionPipeline({ noise: false });
  const first = pipeline.update(world, 0);
  const second = pipeline.update(world, 1000 / 60);
  assert.equal(first.captured, true);
  assert.equal(second.captured, true);
  assert.equal(first.fps, null);
  assert.equal(second.detections.length, 1);
});

test("a capped rig exposes roughly one stereo frame per requested interval", () => {
  const world = scene([officer("P1", 0, 0)], [target("T1", 120, 0)]);
  const pipeline = new StereoVisionPipeline({ noise: false, fps: 10 });
  const frames = Array.from({ length: 61 }, (_, index) => pipeline.update(world, index * 1000 / 60));
  const captures = frames.filter((frame) => frame.captured).length;
  assert.ok(captures >= 9 && captures <= 11, `expected about 10 captures, got ${captures}`);
  assert.ok(frames.some((frame) => !frame.captured));
});

test("capture rate measures recent simulated camera exposures", () => {
  const world = scene([officer("P1", 0, 0)], [target("T1", 120, 0)]);
  const pipeline = new StereoVisionPipeline({ noise: false, fps: 10 });
  let frame;
  for (let timestamp = 0; timestamp <= 1000; timestamp += 100) frame = pipeline.update(world, timestamp);
  assert.ok(Math.abs(frame.captureRate - 10) < 0.01);
});

test("skipped stereo frames retain display data while tracks coast", () => {
  const world = scene([officer("P1", 0, 0)], [target("T1", 120, 0)]);
  const pipeline = new StereoVisionPipeline({ noise: false, fps: 10 });
  const captured = pipeline.update(world, 0);
  const skipped = pipeline.update(world, 1000 / 60);
  assert.equal(skipped.captured, false);
  assert.equal(skipped.detections, captured.detections);
  assert.equal(skipped.skeletons, captured.skeletons);
  assert.equal(skipped.tracks.length, 1);
  assert.equal(skipped.tracks[0].coasting, true);
});

test("reset arms the next stereo update for capture", () => {
  const world = scene([officer("P1", 0, 0)], [target("T1", 120, 0)]);
  const pipeline = new StereoVisionPipeline({ noise: false, fps: 10 });
  pipeline.update(world, 0);
  pipeline.update(world, 1000 / 60);
  pipeline.reset();
  const frame = pipeline.update(world, 1000 / 30);
  assert.equal(frame.captured, true);
  assert.equal(frame.captureRate, 0);
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

test("a radar-only track never publishes a skeleton", () => {
  const pipeline = new StereoVisionPipeline({ noise: false });
  pipeline.radarFrame = (_world, timestamp) => ({
    sensors: [], tracks: [], returns: 0,
    measurements: [{
      trackId: "R1", position: { x: 100, y: 0, z: 0 }, sigma: 1,
      timestamp, confidence: 0.9, officerId: "M1", source: "mmwave",
    }],
  });
  const frame = pipeline.update(scene([], []), 100);
  assert.equal(frame.tracks.length, 1);
  assert.deepEqual(frame.detections, []);
  assert.deepEqual(frame.skeletons, []);
});

test("a wall that blocks an individual joint marks only that camera pose joint invisible", () => {
  const world = scene(
    [officer("P1", 0, 0)], [target("T1", 120, 0)],
    [{ x: 58, y: 1, w: 4, h: 3 }],
  );
  const frame = new StereoVisionPipeline({ noise: false }).update(world, 100);
  assert.equal(frame.detections.length, 1, "the body centre remains visible to the detector");
  assert.ok(frame.detections[0].skeleton.joints.some((joint) => !joint.visible && joint.score === 0));
});

test("joint reconstruction uncertainty and confidence degrade with camera distance", () => {
  const near = new StereoVisionPipeline({ seed: 9 }).update(scene([officer("P1", 0, 0)], [target("T1", 100, 0)]), 100);
  const far = new StereoVisionPipeline({ seed: 9 }).update(scene([officer("P1", 0, 0)], [target("T1", 350, 0)]), 100);
  const cleanNear = new StereoVisionPipeline({ noise: false }).update(scene([officer("P1", 0, 0)], [target("T1", 100, 0)]), 100);
  const cleanFar = new StereoVisionPipeline({ noise: false }).update(scene([officer("P1", 0, 0)], [target("T1", 350, 0)]), 100);
  const nearJoint = near.detections[0].skeleton.joints.find((joint) => joint.visible);
  const farJoint = far.detections[0].skeleton.joints.find((joint) => joint.visible);
  const jointError = (noisy, clean) => noisy.joints.reduce((sum, joint, index) => sum
    + Math.hypot(joint.x - clean.joints[index].x, joint.y - clean.joints[index].y, joint.z - clean.joints[index].z), 0) / noisy.joints.length;
  assert.ok(farJoint.sigma > nearJoint.sigma);
  assert.ok(jointError(far.detections[0].skeleton, cleanFar.detections[0].skeleton)
    > jointError(near.detections[0].skeleton, cleanNear.detections[0].skeleton));
  assert.ok(far.detections[0].skeleton.confidence < near.detections[0].skeleton.confidence);
  assert.ok(near.detections[0].skeleton.confidence > 0.8);
});

test("camera poses keep anatomy rigid while range still lowers confidence", () => {
  const options = { seed: 7, range: 420, fov: 117 * Math.PI / 180 };
  const rest = restPose(42);
  const restLengths = BONES.map(({ a, b }) => Math.hypot(
    rest[a].x - rest[b].x, rest[a].y - rest[b].y, rest[a].z - rest[b].z,
  ));
  const measure = (range) => new StereoVisionPipeline(options).update(
    scene([officer("P1", 0, 0)], [target("T1", range, 0)]), 100,
  ).detections[0].skeleton;
  const near = measure(100);
  const far = measure(420);
  for (const skeleton of [near, far]) {
    const xs = skeleton.joints.map((joint) => joint.x);
    const ys = skeleton.joints.map((joint) => joint.y);
    const height = Math.max(...ys) - Math.min(...ys);
    const width = Math.max(...xs) - Math.min(...xs);
    assert.ok(height >= 42 * 0.75 && height <= 42 * 1.25);
    assert.ok(width <= height / 2);
    for (let index = 0; index < BONES.length; index += 1) {
      const { a, b } = BONES[index];
      const length = Math.hypot(
        skeleton.joints[a].x - skeleton.joints[b].x,
        skeleton.joints[a].y - skeleton.joints[b].y,
        skeleton.joints[a].z - skeleton.joints[b].z,
      );
      assert.ok(length >= restLengths[index] * 0.7 && length <= restLengths[index] * 1.3);
    }
  }
  const errorFromClean = (range, noisy) => {
    const clean = new StereoVisionPipeline({ ...options, noise: false }).update(
      scene([officer("P1", 0, 0)], [target("T1", range, 0)]), 100,
    ).detections[0].skeleton;
    return noisy.joints.reduce((sum, joint, index) => sum + Math.hypot(
      joint.x - clean.joints[index].x,
      joint.y - clean.joints[index].y,
      joint.z - clean.joints[index].z,
    ), 0) / noisy.joints.length;
  };
  assert.ok(errorFromClean(420, far) > errorFromClean(100, near));
  assert.ok(far.confidence < near.confidence);
});

test("camera poses retain gait phase independently and continuously per observer", () => {
  const world = sharedScene();
  const pipeline = new StereoVisionPipeline({ noise: false });
  pipeline.update(world, 0);
  world.targets[0].x += 40;
  const frame = pipeline.update(world, 1000);
  const phases = new Map(frame.detections.map((detection) => [detection.officerId, detection.skeleton.phase]));
  assert.ok(phases.get("P1") > 0 && phases.get("P2") > 0);
  assert.equal(phases.get("P1"), pipeline.poser.phaseOf("T1", "P1"));
  assert.equal(phases.get("P2"), pipeline.poser.phaseOf("T1", "P2"));
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

/** Run the world and pipeline together, as the app does. */
function fly(world, pipeline, frames, onFrame) {
  let frame;
  for (let step = 0; step < frames; step++) {
    stepWorld(world, 1 / 60, { selectedId: "none" });
    frame = pipeline.update(world, world.time * 1000);
    onFrame?.(frame);
  }
  return frame;
}

test("a puck in flight is never localized, and a settled one is fixed by the cameras", () => {
  const world = createWorld();
  const pipeline = new StereoVisionPipeline({ rig: { baseline: 0.08 }, fov: 117 * Math.PI / 180, range: 420 });
  const puck = throwSensor(world, "P1", { timestamp: 0 });
  let airborneLocated = false;
  fly(world, pipeline, 60, (frame) => {
    const report = frame.sensors.find((item) => item.id === puck.id);
    if (report.state === "flight" && (report.located || report.fixes > 0)) airborneLocated = true;
  });
  assert.equal(airborneLocated, false, "a tumbling puck must not be averaged into a fix");
  const frame = fly(world, pipeline, 600);
  const report = frame.sensors.find((item) => item.id === puck.id);
  assert.equal(puck.state, "settled");
  assert.ok(report.located, "settled and in view, the puck gets a fix");
  assert.ok(report.fixes > 1 && report.observers.length > 0);
  const error = Math.hypot(report.position.x - puck.x, report.position.y - puck.y);
  assert.ok(error < 12, `estimate within 12 units, got ${error.toFixed(1)}`);
  // An estimator that reports less error than it makes is worse than useless.
  assert.ok(report.sigma > 0 && error < report.sigma * 5, "reported sigma is consistent with real error");
});

test("a located puck tracks a moving body through a wall and feeds the fused tracker", () => {
  const world = createWorld();
  const pipeline = new StereoVisionPipeline({ rig: { baseline: 0.08 }, fov: 117 * Math.PI / 180, range: 420 });
  // T1 patrols the room beyond the long wall; P2 faces that wall and throws.
  Object.assign(world.targets[0], { x: 300, y: 250, angle: 0.05 });
  throwSensor(world, "P2", { timestamp: 0 });
  let radarFrames = 0, fusedFrames = 0, throughWall = 0;
  fly(world, pipeline, 900, (frame) => {
    if (frame.radarTracks.length) radarFrames += 1;
    if (frame.radarTracks.some((track) => track.wallsCrossed > 0)) throughWall += 1;
    if (frame.tracks.some((track) => track.sources.includes("mmwave"))) fusedFrames += 1;
  });
  assert.ok(radarFrames > 100, `radar should hold the body for a good while, got ${radarFrames} frames`);
  assert.ok(throughWall > 0, "at least some of those returns came through drywall");
  assert.ok(fusedFrames > 100, `radar measurements should reach the shared tracker, got ${fusedFrames}`);
});

test("recalling a puck retires its estimate and its filter", () => {
  const world = createWorld();
  const pipeline = new StereoVisionPipeline({ rig: { baseline: 0.08 }, fov: 117 * Math.PI / 180, range: 420 });
  const puck = throwSensor(world, "P1", { timestamp: 0 });
  assert.ok(fly(world, pipeline, 600).sensors[0].located);
  recallSensor(world, puck.id);
  const frame = fly(world, pipeline, 30);
  assert.deepEqual(frame.sensors, []);
  assert.deepEqual(frame.radarTracks, []);
  assert.equal(pipeline.localizer.estimateFor(puck.id), undefined);
  // A puck thrown into the same id slot must start from nothing.
  throwSensor(world, "P1", { timestamp: world.time * 1000 });
  assert.equal(pipeline.update(world, world.time * 1000).sensors[0].fixes, 0);
});

test("observations carry the modality behind each track and their pucks' owners", () => {
  const world = createWorld();
  const pipeline = new StereoVisionPipeline({ rig: { baseline: 0.08 }, fov: 117 * Math.PI / 180, range: 420 });
  throwSensor(world, "P2", { timestamp: 0 });
  const frame = fly(world, pipeline, 600);
  const observations = trackObservations(frame.tracks, { range: 420, fov: 2 }, frame.skeletons, frame.sensors);
  assert.ok(observations.every((item) => Array.isArray(item.sources) && item.stereo === item.sources.includes("stereo")));
  assert.ok(observations.every((item) => item.radar === item.sources.includes("mmwave")));
  assert.deepEqual(observations.sensors, [{ id: "M1", ownerId: "P2" }]);
});

test("one puck holds one radar track per body instead of breeding ghosts", () => {
  const world = createWorld();
  const pipeline = new StereoVisionPipeline({ rig: { baseline: 0.08 }, fov: 117 * Math.PI / 180, range: 420 });
  throwSensor(world, "P2", { timestamp: 0 });
  const lifetimes = new Map();
  let mostAtOnce = 0;
  fly(world, pipeline, 1500, (frame) => {
    for (const track of frame.radarTracks)
      lifetimes.set(track.trackId, (lifetimes.get(track.trackId) ?? 0) + 1);
    mostAtOnce = Math.max(mostAtOnce, frame.radarTracks.length);
  });
  // Three bodies exist; a filter that rejects good returns during a turn spawns
  // a rival track each time and the count runs away. A body that walks out of
  // the puck's reach and comes back is a second id for the same person, so the
  // ghost signature is concurrency and churn, not the lifetime id count: a
  // rival track is born beside a live one and dies young.
  assert.ok(mostAtOnce <= world.targets.length, `expected at most ${world.targets.length} live at once, got ${mostAtOnce}`);
  assert.ok(lifetimes.size <= world.targets.length * 2, `expected few re-acquisitions, got ${lifetimes.size} radar tracks`);
  for (const [trackId, frames] of lifetimes)
    assert.ok(frames > 120, `${trackId} lived only ${frames} frames, which is track churn rather than a re-acquisition`);
});
