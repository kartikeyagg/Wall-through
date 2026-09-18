import test from "node:test";
import assert from "node:assert/strict";
import { BONES, KEYPOINTS, SkeletonPoser, jointAt, poseSkeleton, restPose, skeletonBounds, skeletonSegments } from "../src/skeleton.js";

const state = (extra = {}) => ({ trackId: "target", position: { x: 10, z: 20 }, timestamp: 0, ...extra });
const local = (joint) => ({ x: joint.x - 10, y: joint.y, z: joint.z - 20 });

test("COCO-18 keypoints have the published order", () => {
  assert.deepEqual(KEYPOINTS, ["nose", "neck", "rShoulder", "rElbow", "rWrist", "lShoulder", "lElbow", "lWrist", "rHip", "rKnee", "rAnkle", "lHip", "lKnee", "lAnkle", "rEye", "lEye", "rEar", "lEar"]);
  assert.equal(KEYPOINTS.length, 18);
});

test("all bones point at valid keypoints", () => {
  assert.ok(BONES.length >= 17 && BONES.length <= 19);
  assert.ok(BONES.every(({ a, b }) => a >= 0 && b >= 0 && a < 18 && b < 18));
});

test("rest pose is a plausible mirrored standing figure", () => {
  const pose = Object.fromEntries(restPose(100).map((joint) => [joint.name, joint]));
  assert.ok(pose.nose.y > pose.neck.y && pose.neck.y > pose.rHip.y && pose.rHip.y > pose.rKnee.y && pose.rKnee.y > pose.rAnkle.y);
  assert.equal(pose.rShoulder.x, -pose.lShoulder.x);
  assert.equal(pose.rHip.x, -pose.lHip.x);
  assert.equal(pose.rEye.x, -pose.lEye.x);
});

test("pose skeleton translates its root and rotates its lateral spread", () => {
  const facingX = poseSkeleton(state({ heading: 0, phase: 0 }));
  const facingZ = poseSkeleton(state({ heading: Math.PI / 2, phase: 0 }));
  assert.deepEqual(facingX.root, { x: 10, y: 0, z: 20 });
  const xSpread = Math.abs(jointAt(facingX, "lShoulder").x - jointAt(facingX, "rShoulder").x);
  const zSpread = Math.abs(jointAt(facingX, "lShoulder").z - jointAt(facingX, "rShoulder").z);
  const turnedXSpread = Math.abs(jointAt(facingZ, "lShoulder").x - jointAt(facingZ, "rShoulder").x);
  const turnedZSpread = Math.abs(jointAt(facingZ, "lShoulder").z - jointAt(facingZ, "rShoulder").z);
  assert.ok(zSpread > xSpread && turnedXSpread > turnedZSpread);
});

test("walking ankles separate along travel while standing ankles do not", () => {
  const standing = poseSkeleton(state({ speed: 0, phase: Math.PI / 2 }));
  const walking = poseSkeleton(state({ speed: 8, phase: Math.PI / 2 }));
  const standingTravelGap = Math.abs(jointAt(standing, "rAnkle").x - jointAt(standing, "lAnkle").x);
  const walkingTravelGap = Math.abs(jointAt(walking, "rAnkle").x - jointAt(walking, "lAnkle").x);
  assert.equal(standingTravelGap, 0);
  assert.ok(walkingTravelGap > 1);
  assert.equal(Math.abs(jointAt(standing, "rAnkle").z - jointAt(standing, "lAnkle").z), Math.abs(jointAt(walking, "rAnkle").z - jointAt(walking, "lAnkle").z));
});

test("gait repeats after one complete phase", () => {
  const first = poseSkeleton(state({ speed: 8, phase: 0.71 }));
  const next = poseSkeleton(state({ speed: 8, phase: 0.71 + 2 * Math.PI }));
  for (let index = 0; index < 18; index += 1) {
    for (const axis of ["x", "y", "z"]) assert.ok(Math.abs(first.joints[index][axis] - next.joints[index][axis]) < 1e-10);
  }
});

test("walking knees bend forward of their hip-to-ankle line", () => {
  for (const phase of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    const skeleton = poseSkeleton(state({ heading: Math.PI / 2, speed: 8, phase }));
    for (const side of ["r", "l"]) {
      const hip = local(jointAt(skeleton, `${side}Hip`));
      const knee = local(jointAt(skeleton, `${side}Knee`));
      const ankle = local(jointAt(skeleton, `${side}Ankle`));
      assert.ok(knee.z - (hip.z + (ankle.z - hip.z) * 0.51) >= -1e-10);
    }
  }
});

test("SkeletonPoser advances continuously and reset clears phase", () => {
  const poser = new SkeletonPoser({ height: 10, strideLength: 10 });
  poser.pose([state({ speed: 5 })], 0);
  poser.pose([state({ speed: 5 })], 1000);
  assert.ok(Math.abs(poser.phaseOf("target") - Math.PI / 4) < 1e-12);
  poser.pose([state({ speed: 5 })], 1100);
  assert.ok(poser.phaseOf("target") > Math.PI / 4);
  assert.equal(poser.phaseOf("unknown"), 0);
  poser.reset();
  assert.equal(poser.phaseOf("target"), 0);
});

test("SkeletonPoser drops tracks absent for over five seconds", () => {
  const poser = new SkeletonPoser();
  poser.pose([state()], 0);
  poser.pose([], 5001);
  assert.equal(poser.phaseOf("target"), 0);
});

test("scores are deterministic for identical inputs", () => {
  const first = poseSkeleton(state({ heading: Math.PI / 2, speed: 6, phase: 1 }), { seed: 22 });
  const second = poseSkeleton(state({ heading: Math.PI / 2, speed: 6, phase: 1 }), { seed: 22 });
  assert.deepEqual(first.joints.map((joint) => joint.score), second.joints.map((joint) => joint.score));
});

test("segments honor minimum score and bounds cover every joint", () => {
  const skeleton = poseSkeleton(state());
  assert.ok(skeletonSegments(skeleton, 0).length === BONES.length);
  assert.equal(skeletonSegments(skeleton, 1).length, 0);
  const bounds = skeletonBounds(skeleton);
  assert.ok(skeleton.joints.every((joint) => joint.x >= bounds.min.x && joint.x <= bounds.max.x && joint.y >= bounds.min.y && joint.y <= bounds.max.y));
});
