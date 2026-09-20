import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STATE, ThreatRegistry, scoreClearances } from "../src/classification.js";

const observations = (...targetIds) => targetIds.map((targetId) => ({ targetId, x: 0, y: 0, confidence: 0.9 }));

test("unknown tracks default to hostile", () => {
  const registry = new ThreatRegistry();
  assert.equal(DEFAULT_STATE, "hostile");
  assert.equal(registry.stateOf("T1"), "hostile");
  assert.equal(registry.isCleared("T1"), false);
});

test("clear, restore, and toggle retain revisions", () => {
  const registry = new ThreatRegistry();
  assert.equal(registry.clear("T1", "a", 10, { reason: "bystander" }).revision, 1);
  assert.equal(registry.stateOf("T1"), "cleared");
  const restored = registry.restore("T1", "b", 20);
  assert.equal(restored.state, "hostile");
  assert.equal(restored.revision, 2);
  assert.equal(restored.restoredBy, "b");
  assert.equal(registry.toggle("T1", "c", 30).revision, 3);
  assert.equal(registry.stateOf("T1"), "cleared");
  assert.equal(registry.toggle("T1", "d", 40).revision, 4);
  assert.equal(registry.stateOf("T1"), "hostile");
});

test("annotate copies observations and their non-enumerable vision metadata", () => {
  const registry = new ThreatRegistry();
  registry.clear("T2", "officer-a", 10, { reason: "identified" });
  const input = observations("T1", "T2");
  const vision = { range: 20, fov: 1.2 };
  Object.defineProperty(input, "vision", { value: vision });
  const annotated = registry.annotate(input);
  assert.notEqual(annotated, input);
  assert.notEqual(annotated[0], input[0]);
  assert.equal(input[0].threat, undefined);
  assert.equal(Object.getOwnPropertyDescriptor(annotated, "vision").enumerable, false);
  assert.equal(annotated.vision, vision);
  assert.deepEqual(annotated.map(({ targetId, threat }) => ({ targetId, threat })), [
    { targetId: "T1", threat: "hostile" }, { targetId: "T2", threat: "cleared" },
  ]);
  assert.equal(annotated[1].clearedBy, "officer-a");
  assert.equal(annotated[1].clearedReason, "identified");
});

test("hostileOnly leaves two flags when one of three visible tracks is cleared", () => {
  const registry = new ThreatRegistry();
  registry.clear("T2", "officer-a", 10);
  const hostile = registry.hostileOnly(observations("T1", "T2", "T3"));
  assert.deepEqual(hostile.map((observation) => observation.targetId), ["T1", "T3"]);
  assert.ok(hostile.every((observation) => observation.threat === "hostile"));
});

test("clearance outlives a brief disappearance and expires past its grace period", () => {
  const registry = new ThreatRegistry({ graceMs: 100 });
  registry.clear("T1", "a", 0);
  assert.equal(registry.prune([], 99), 0);
  assert.equal(registry.stateOf("T1"), "cleared");
  assert.equal(registry.prune([], 101), 1);
  assert.equal(registry.stateOf("T1"), "hostile");
});

test("capacity retains most recently seen entries", () => {
  const registry = new ThreatRegistry({ maxEntries: 2 });
  registry.clear("T1", "a", 0);
  registry.clear("T2", "a", 1);
  registry.prune(["T1", "T2"], 10);
  registry.prune(["T2"], 20);
  registry.clear("T3", "a", 21);
  assert.equal(registry.entryOf("T1"), undefined);
  assert.ok(registry.entryOf("T2"));
  assert.ok(registry.entryOf("T3"));
});

test("invalid changes do not corrupt the registry", () => {
  const registry = new ThreatRegistry();
  assert.equal(registry.clear(null, "a", 0), null);
  assert.equal(registry.clear("T1", "a", NaN), null);
  assert.deepEqual(registry.snapshot(), []);
});

test("clearance scoring separates safe detags from dangerous ones", () => {
  const registry = new ThreatRegistry();
  registry.clear("bystander", "a", 1);
  registry.clear("hostile", "a", 1);
  const annotated = registry.annotate(observations("bystander", "hostile", "flagged", "unknown"));
  assert.deepEqual(scoreClearances(annotated, new Map([
    ["bystander", false], ["hostile", true], ["flagged", true],
  ])), {
    correctlyCleared: 1, wronglyCleared: 1, bystandersLeftFlagged: 0, correctlyFlagged: 1,
  });
});
