import test from "node:test";
import assert from "node:assert/strict";
import { gospa, TrialMetrics } from "../src/metrics.js";
import { guessedParameters, modelParameters, parameterValues, validateParameterSet } from "../src/params.js";

test("GOSPA chooses the best spatial assignment and charges for missing tracks", () => {
  const truth = [{ x: 0, y: 0 }, { x: 48, y: 0 }];
  assert.equal(gospa([...truth].reverse(), truth), 0);
  assert.ok(gospa([truth[0]], truth) > 0);
  assert.equal(gospa([], []), 0);
});

test("model parameters carry provenance and preserve caller overrides", () => {
  assert.equal(validateParameterSet(modelParameters), modelParameters);
  assert.ok(guessedParameters().includes("localization.gpsPositionError"));
  assert.equal(parameterValues("localization").gpsPositionError, 48);
  assert.throws(() => validateParameterSet({ localization: { error: { value: 1 } } }), /source/);
});

test("trial metrics measure localization and clearance fractions against truth", () => {
  const metrics = new TrialMetrics();
  const world = { time: 1, officers: [{ id: "P1", x: 0, y: 0 }],
    targets: [{ id: "T1", x: 24, y: 0, hostile: true }, { id: "T2", x: 48, y: 0, hostile: false }] };
  const frame = { tracks: [{ trackId: "T1", position: { x: 24, z: 0 }, timestamp: 900 }], skeletons: [] };
  metrics.observe(world, [{ officerId: "P1", position: { x: 24, z: 0 } }], frame, new Map([["T1", "cleared"]]));
  const result = metrics.summary();
  assert.equal(result.localizationRmseM, 1);
  assert.equal(result.dataAgeMeanMs, 100);
  assert.equal(result.wrongClearanceRate, 1);
  assert.equal(result.unclearedBystanderRate, 1);
});
