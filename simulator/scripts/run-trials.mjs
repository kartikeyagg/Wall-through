import { createWorld, stepWorld } from "../src/simulation.js";
import { SelfLocalization } from "../src/sensors.js";
import { StereoVisionPipeline } from "../src/vision.js";
import { TrialMetrics } from "../src/metrics.js";
import { guessedParameters } from "../src/params.js";

function integerOption(name, fallback) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

const seeds = integerOption("--seeds", 10);
const seconds = integerOption("--seconds", 60);
const scenarioIndex = process.argv.indexOf("--scenario");
const scenario = scenarioIndex < 0 ? "indoor" : process.argv[scenarioIndex + 1];
if (!["indoor", "outdoor"].includes(scenario)) throw new RangeError("--scenario must be indoor or outdoor");
const reports = [];
for (let seed = 1; seed <= seeds; seed += 1) {
  const world = createWorld(10, { environment: scenario });
  const pipeline = new StereoVisionPipeline({ seed, fps: 30 });
  const localizer = new SelfLocalization();
  const metrics = new TrialMetrics();
  for (let tick = 0; tick < seconds * 60; tick += 1) {
    stepWorld(world, 1 / 60, { autoPatrol: true, autoRotate: true });
    const timestamp = world.time * 1000;
    const poses = localizer.update(world, timestamp);
    const frame = pipeline.update(world, timestamp, poses);
    metrics.observe(world, poses, frame);
  }
  reports.push(metrics.summary());
}
const fields = Object.keys(reports[0]).filter((field) => field !== "frames");
const mean = Object.fromEntries(fields.map((field) => [field,
  reports.reduce((sum, report) => sum + (report[field] ?? 0), 0) / reports.length]));
const result = { scenario, seeds, seconds, framesPerSeed: reports[0].frames, mean,
  parameterGuesses: guessedParameters() };
if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Simulation baseline · ${scenario} · ${seeds} seeds × ${seconds}s`);
  for (const [name, value] of Object.entries(mean)) console.log(`${name}: ${value.toFixed(3)}`);
  console.log(`Unmeasured parameters: ${result.parameterGuesses.length}`);
}
