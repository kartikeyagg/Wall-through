import test from "node:test";
import assert from "node:assert/strict";
import { TrackAssociator } from "../src/association.js";
import { detect, StereoVisionPipeline } from "../src/vision.js";

const detection = (x, timestamp, label) => ({ officerId: "P1", timestamp,
  position: { x, y: 1, z: 0 }, sigma: 1, label });

test("two people crossing retain anonymous ids when detection order reverses", () => {
  const associator = new TrackAssociator();
  const first = associator.assign([detection(-20, 0, "left"), detection(20, 0, "right")], 0);
  associator.assign([detection(-10, 100, "left"), detection(10, 100, "right")], 100);
  associator.assign([detection(0, 200, "left"), detection(0, 200, "right")], 200);
  const crossed = associator.assign([detection(-10, 300, "right"), detection(10, 300, "left")], 300);
  assert.equal(crossed.find((item) => item.label === "left").trackId, first[0].trackId);
  assert.equal(crossed.find((item) => item.label === "right").trackId, first[1].trackId);
});

test("association assigns the closest valid pairs across the whole exposure", () => {
  const associator = new TrackAssociator();
  const initial = associator.assign([detection(0, 0), detection(20, 0)], 0);
  const next = associator.assign([detection(12, 100), detection(18, 100)], 100);
  assert.equal(next[0].trackId, initial[0].trackId);
  assert.equal(next[1].trackId, initial[1].trackId);
});

test("two officers seeing one new person share an id without duplicating one officer's reports", () => {
  const associator = new TrackAssociator();
  const reports = [detection(50, 0), { ...detection(51, 0), officerId: "P2" }, detection(53, 0)];
  associator.assign(reports, 0);
  assert.equal(reports[0].trackId, reports[1].trackId);
  assert.notEqual(reports[0].trackId, reports[2].trackId);
});

test("camera detections expose anonymous ids but hide scoring-only truth", () => {
  const world = { time: 0, officers: [{ id: "P1", x: 0, y: 0, angle: 0 }],
    targets: [{ id: "T1", x: 100, y: 0 }], walls: [] };
  const report = detect(world, { noise: false })[0];
  assert.match(report.trackId, /^A\d+$/);
  assert.notEqual(report.trackId, report.truthId);
  assert.equal(report.truthId, "T1");
  assert.equal(Object.keys(report).includes("truthId"), false);
  assert.equal(JSON.stringify(report).includes("T1"), false);
});

test("changing private world ids leaves published camera tracks and poses identical", () => {
  const makeWorld = (id) => ({ time: 0, officers: [{ id: "P1", x: 0, y: 0, angle: 0 }],
    targets: [{ id, x: 100, y: 0, angle: 0 }], walls: [] });
  const frame = (id) => new StereoVisionPipeline({ noise: false }).update(makeWorld(id), 0);
  const first = frame("T1"), renamed = frame("secret-person");
  assert.equal(JSON.stringify(first.detections), JSON.stringify(renamed.detections));
  assert.equal(JSON.stringify(first.tracks), JSON.stringify(renamed.tracks));
  assert.equal(JSON.stringify(first.skeletons), JSON.stringify(renamed.skeletons));
});
