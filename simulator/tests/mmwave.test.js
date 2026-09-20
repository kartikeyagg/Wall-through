import test from "node:test";
import assert from "node:assert/strict";
import { associateRadarTracks, createMmWaveRadar, crossRangeSigma, MmWaveTracker, polarToWorld, radarMeasurements, sampleReturns, SensorLocalizer, worldToPolar } from "../src/mmwave.js";
import { createGaussian } from "../src/stereo.js";

const radar = createMmWaveRadar();
const sensor = { id: "puck", x: 0, y: 0, angle: 0 };
const moving = (x, y, vx = 24, vy = 0) => ({ id: "person", x, y, vx, vy });

test("range error is constant while cross-range uncertainty grows with distance", () => {
  const longRangeRadar = createMmWaveRadar({ detectionSnrDb: -100 });
  const noise = createGaussian(9);
  const rmsRangeError = (range) => {
    let squared = 0;
    for (let index = 0; index < 80; index++) {
      const report = sampleReturns(longRangeRadar, sensor, [moving(range, 0)], [], { random: noise })[0];
      squared += (report.range - range) ** 2;
    }
    return Math.sqrt(squared / 80);
  };
  const near = rmsRangeError(48); const far = rmsRangeError(240);
  assert.ok(far / near > 0.7 && far / near < 1.3);
  assert.ok(crossRangeSigma(240, radar) > crossRangeSigma(48, radar) * 4.9);
  assert.ok(crossRangeSigma(240, radar) > radar.rangeSigma);
});

test("drywall reduces a detectable return and three walls remove it", () => {
  const subject = moving(72, 0);
  const clear = sampleReturns(radar, sensor, [subject], [], { timestamp: 1 })[0];
  const one = sampleReturns(radar, sensor, [subject], [{ x: 40, y: -10, w: 2, h: 20 }], { timestamp: 1 })[0];
  const three = sampleReturns(radar, sensor, [subject], [{ x: 20, y: -10, w: 2, h: 20 }, { x: 50, y: -10, w: 2, h: 20 }, { x: 65, y: -10, w: 2, h: 20 }], { timestamp: 1 });
  assert.ok(one && one.snrDb < clear.snrDb && one.confidence < clear.confidence);
  assert.deepEqual(three, []);
});

test("link budget reaches 18 m in clear air and about 11.5 m through drywall", () => {
  assert.equal(sampleReturns(radar, sensor, [moving(17.5 * 24, 0)], [], { timestamp: 1 }).length, 1);
  assert.equal(sampleReturns(radar, sensor, [moving(18.5 * 24, 0)], [], { timestamp: 1 }).length, 0);
  const wall = [{ x: 120, y: -10, w: 2, h: 20 }];
  assert.equal(sampleReturns(radar, sensor, [moving(11 * 24, 0)], wall, { timestamp: 1 }).length, 1);
  assert.equal(sampleReturns(radar, sensor, [moving(12 * 24, 0)], wall, { timestamp: 1 }).length, 0);
});

test("static clutter is rejected and minSpeed and Doppler use metres per second", () => {
  assert.equal(sampleReturns(radar, sensor, [moving(100, 0, 0, 0)], [], { timestamp: 0 }).length, 0);
  assert.equal(sampleReturns(radar, sensor, [moving(100, 0, 0.96, 0)], [], { timestamp: 0 }).length, 0);
  const report = sampleReturns(radar, sensor, [moving(100, 0, 2.4, 0)], [], { timestamp: 0 })[0];
  assert.ok(Math.abs(report.doppler - 0.1) < 1e-12);
});

test("polar and world coordinates round-trip", () => {
  const pose = { x: 30, y: -10, angle: 0.7 };
  const polar = worldToPolar({ x: 80, y: 40 }, pose);
  const point = polarToWorld(polar, pose);
  assert.ok(Math.abs(point.x - 80) < 1e-10 && Math.abs(point.y - 40) < 1e-10);
});

function runTracker(dopplerSigma = radar.dopplerSigma) {
  const configured = createMmWaveRadar({ dopplerSigma }); const tracker = new MmWaveTracker({ radar: configured, processNoise: 10 });
  const noise = createGaussian(71); let rawSq = 0; let filteredSq = 0; let count = 0; let output;
  for (let time = 0; time <= 5000; time += 100) {
    const truth = moving(50 + time * 0.018, 35 + time * 0.008, 18, 8);
    const report = sampleReturns(configured, sensor, [truth], [], { timestamp: time, random: noise });
    output = tracker.update(report, time, sensor)[0];
    if (time > 1000) { const raw = polarToWorld(report[0], sensor); rawSq += (raw.x - truth.x) ** 2 + (raw.y - truth.y) ** 2; filteredSq += (output.position.x - truth.x) ** 2 + (output.position.y - truth.y) ** 2; count += 1; }
  }
  return { output, raw: Math.sqrt(rawSq / count), filtered: Math.sqrt(filteredSq / count) };
}

test("EKF converges and improves on raw polar locations", () => {
  const result = runTracker();
  assert.ok(Math.hypot(result.output.position.x - 140, result.output.position.y - 75) < 8);
  assert.ok(Math.hypot(result.output.velocity.x - 18, result.output.velocity.y - 8) < 3);
  assert.ok(result.filtered < result.raw);
});

test("one moving subject remains one confirmed track and separated subjects make two", () => {
  const tracker = new MmWaveTracker({ radar, processNoise: 8 }); let tracks;
  for (let time = 0; time < 1000; time += 100) tracks = tracker.update(sampleReturns(radar, sensor, [moving(100 + time * 0.024, 30)], [], { timestamp: time }), time, sensor);
  assert.equal(tracks.length, 1); assert.equal(tracks[0].confirmed, true);
  const other = new MmWaveTracker({ radar });
  tracks = other.update(sampleReturns(radar, sensor, [moving(100, 20), moving(120, 100, 0, 24)], [], { timestamp: 0 }), 0, sensor);
  tracks = other.update(sampleReturns(radar, sensor, [moving(102.4, 20), moving(120, 102.4, 0, 24)], [], { timestamp: 100 }), 100, sensor);
  assert.equal(tracks.length, 2);
});

test("out-of-gate returns spawn rather than corrupt an existing track", () => {
  const tracker = new MmWaveTracker({ radar, gateChiSq: 5 });
  tracker.update(sampleReturns(radar, sensor, [moving(100, 0)], [], { timestamp: 0 }), 0, sensor);
  const tracks = tracker.update(sampleReturns(radar, sensor, [moving(102.4, 0), moving(140, 80)], [], { timestamp: 100 }), 100, sensor);
  assert.equal(tracks.length, 2);
});

test("associations use vision x/z and radar measurements preserve that swap", () => {
  const tracks = [{ trackId: "puck-R1", sensorId: "puck", position: { x: 10, y: 20 }, velocity: { x: 0, y: 0 }, sigma: 3, confirmed: true, timestamp: 4, confidence: 0.8 }, { trackId: "puck-R2", sensorId: "puck", position: { x: 200, y: 200 }, velocity: { x: 0, y: 0 }, sigma: 3, confirmed: true, timestamp: 4, confidence: 0.8 }];
  const links = associateRadarTracks(tracks, [{ trackId: "vision", position: { x: 11, z: 21 } }]);
  assert.equal(links.get("puck-R1"), "vision"); assert.equal(links.has("puck-R2"), false);
  const reports = radarMeasurements([...tracks, { ...tracks[0], trackId: "tentative", confirmed: false }], links);
  assert.deepEqual(reports[0].position, { x: 10, y: 0, z: 20 }); assert.equal(reports[0].source, "mmwave"); assert.equal(reports.length, 2);
});

test("localizer fuses, locates, and ages puck fixes", () => {
  const localizer = new SensorLocalizer({ locatedSigma: 8, driftSigma: 2 });
  let fix = localizer.update("puck", [{ position: { x: 0, y: 0 }, sigma: 10, officerId: "a" }], 0);
  assert.equal(fix.located, false);
  fix = localizer.update("puck", [{ position: { x: 0, y: 0 }, sigma: 10, officerId: "b" }], 0);
  assert.ok(Math.abs(fix.sigma - Math.sqrt(50)) < 0.01 && fix.located);
  const aged = localizer.update("puck", [], 1000);
  assert.ok(aged.sigma > fix.sigma && aged.fixes === 2);
});
