import { performance } from "node:perf_hooks";
import { createWorld, stepWorld, throwSensor } from "../src/simulation.js";
import { SelfLocalization } from "../src/sensors.js";
import { StereoVisionPipeline } from "../src/vision.js";

const world = createWorld(10);
for (const officer of world.officers.slice(0, 4)) throwSensor(world, officer.id);
const pipeline = new StereoVisionPipeline({ seed: 1, fps: 30 });
const localizer = new SelfLocalization();
const timings = [];
for (let tick = 0; tick < 3600; tick += 1) {
  const start = performance.now();
  stepWorld(world, 1 / 60, { autoPatrol: true, autoRotate: true });
  localizer.update(world, world.time * 1000);
  pipeline.update(world, world.time * 1000);
  const elapsed = performance.now() - start;
  if (tick >= 60) timings.push(elapsed);
}
timings.sort((a, b) => a - b);
const mean = timings.reduce((sum, time) => sum + time, 0) / timings.length;
const p99 = timings[Math.floor(timings.length * 0.99)];
console.log(`10 officers · 4 pucks · 3600 ticks: mean ${mean.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms`);
if (mean > 3 || p99 > 5) {
  console.error("Simulation tick exceeds the S6 performance target (mean ≤3 ms, p99 ≤5 ms).");
  process.exitCode = 1;
}
