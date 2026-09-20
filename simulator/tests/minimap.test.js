import assert from "node:assert/strict";
import test from "node:test";
import { clampView, collectBlips, hitTest, minimapToWorld, worldToMinimap } from "../src/minimap.js";

const view = { center: { x: 500, y: 340 }, scale: 0.5, rotation: 0, size: { width: 200, height: 160 } };

test("projection round-trips north-up and heading-up views", () => {
  for (const rotation of [0, Math.PI / 3]) {
    const projected = worldToMinimap({ x: 620, y: 440 }, { ...view, rotation });
    const restored = minimapToWorld(projected, { ...view, rotation });
    assert.ok(Math.abs(restored.x - 620) < 1e-9);
    assert.ok(Math.abs(restored.y - 440) < 1e-9);
  }
});

test("rotation changes projected point direction", () => {
  const northUp = worldToMinimap({ x: 600, y: 340 }, view);
  const headingUp = worldToMinimap({ x: 600, y: 340 }, { ...view, rotation: Math.PI / 2 });
  assert.notDeepEqual(headingUp, northUp);
  assert.ok(Math.abs(headingUp.y - view.size.height / 2) > 40);
});

test("clampView keeps zoom and visible centre inside bounds", () => {
  const clamped = clampView({ center: { x: -50, y: 9999 }, scale: 99, rotation: 0, size: { width: 200, height: 100 } }, { width: 1000, height: 700 });
  assert.equal(clamped.scale, 4);
  assert.ok(clamped.center.x >= 25 && clamped.center.x <= 975);
  assert.ok(clamped.center.y >= 12.5 && clamped.center.y <= 687.5);
  assert.equal(clampView({ ...view, scale: 0.001 }).scale, 0.08);
});

test("collectBlips uses published estimates, known contacts, and located pucks only", () => {
  const blips = collectBlips({
    selectedId: "P1",
    localizations: [{ officerId: "P1", timestamp: 1, position: { x: 111, y: 1.7, z: 222 }, orientation: { yaw: .4, pitch: 0, roll: 0 }, sources: { stereo: true, compass: true, imu: true } }, { officerId: "P2", timestamp: 1, position: { x: 333, y: 1.7, z: 444 }, orientation: { yaw: 0, pitch: 0, roll: 0 }, sources: { stereo: true, compass: true, imu: false } }],
    contacts: [{ targetId: "known", x: 600, y: 200, heading: 1, kind: "shared", threat: "cleared", radar: true, stereo: false, coasting: true }],
    sensors: [{ id: "located", ownerId: "P1", state: "settled", active: true, located: true, position: { x: 30, y: 40 } }, { id: "unknown", ownerId: "P1", state: "flight", active: false, located: false, position: null }],
  });
  assert.deepEqual(blips.find((item) => item.id === "P1"), { id: "P1", kind: "officer", x: 111, y: 222, heading: .4, state: "localized", selected: true });
  assert.equal(blips.find((item) => item.id === "P2")?.selected, false);
  assert.deepEqual(blips.find((item) => item.id === "known"), { id: "known", kind: "target", x: 600, y: 200, heading: 1, state: "cleared", source: "shared", modality: "radar-only", coasting: true, selected: false });
  assert.ok(blips.some((item) => item.id === "located"));
  assert.ok(!blips.some((item) => item.id === "unknown"));
  assert.ok(!blips.some((item) => item.id === "undetected"));
});

test("hitTest returns the nearest displayed blip or nothing", () => {
  const blips = [{ id: "near", kind: "officer", x: 500, y: 340, state: "localized", selected: false }, { id: "far", kind: "target", x: 510, y: 340, state: "hostile", selected: false }];
  assert.equal(hitTest({ x: 101, y: 80 }, blips, view, 10)?.id, "near");
  assert.equal(hitTest({ x: 0, y: 0 }, blips, view, 5), undefined);
});
