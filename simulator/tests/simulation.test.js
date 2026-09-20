import test from "node:test";
import assert from "node:assert/strict";
import {
  WIDTH,
  HEIGHT,
  createWorld,
  stepWorld,
  canSee,
  visibleLandmarks,
  observe,
  visibleTo,
  awareOf,
  segmentBlocked,
  moveAgent,
  throwSensor,
  recallSensor,
  MAX_SENSORS,
} from "../src/simulation.js";
import {
  createSimulatedPoseProvider,
  SelfLocalization,
  SensorFusion,
  TrackStore,
  tracksToObservations,
} from "../src/sensors.js";

test("self localization uses stereo and compass as the primary pose, with optional IMU integration", () => {
  const world = createWorld(5);
  const localizer = new SelfLocalization({ stereoPositionError: 0.7, compassError: 0.012, imuWeight: 0.14 });
  const first = localizer.update(world, 1_000, { imuEnabled: true }).find((item) => item.officerId === "P1");
  assert.equal(first.sources.stereo, true);
  assert.equal(first.sources.compass, true);
  assert.equal(first.sources.imu, true);
  assert.equal(first.imu, undefined);

  const officer = world.officers[0];
  officer.x += 20; officer.y += 8; officer.angle += 0.3;
  const fused = localizer.update(world, 1_100, { imuEnabled: true }).find((item) => item.officerId === "P1");
  assert.ok(fused.imu);
  assert.ok(Math.hypot(fused.position.x - officer.x, fused.position.z - officer.y) < 2);

  const stereoCompassOnly = localizer.update(world, 1_200, { imuEnabled: false }).find((item) => item.officerId === "P1");
  assert.equal(stereoCompassOnly.sources.imu, false);
  assert.equal(stereoCompassOnly.imu, undefined);
  assert.ok(Math.hypot(stereoCompassOnly.position.x - officer.x, stereoCompassOnly.position.z - officer.y) <= 1);
});

test("world contains 5–10 officers and exactly three targets", () => {
  for (const [requested, expected] of [
    [1, 5],
    [5, 5],
    [7, 7],
    [10, 10],
    [100, 10],
    [NaN, 7],
  ]) {
    const world = createWorld(requested);
    assert.equal(world.officers.length, expected);
    assert.equal(world.targets.length, 3);
    assert.equal(
      new Set([...world.officers, ...world.targets].map((agent) => agent.id))
        .size,
      expected + 3,
    );
  }
});

test("initial scene demonstrates direct detection and a teammate outline through the wall", () => {
  const world = createWorld();
  const snapshot = observe(world);
  assert.equal(
    visibleTo(world, "P1", snapshot).find((item) => item.targetId === "T1")
      ?.kind,
    "direct",
  );
  assert.equal(
    visibleTo(world, "P2", snapshot).find((item) => item.targetId === "T1")
      ?.kind,
    "shared",
  );
  assert.equal(
    visibleTo(world, "P2", snapshot, false).some(
      (item) => item.targetId === "T1",
    ),
    false,
  );
});

test("range, field of view, wall occlusion, and wraparound angles constrain vision", () => {
  const observer = { x: 100, y: 100, angle: 0 };
  assert.equal(canSee(observer, { x: 200, y: 100 }, []), true);
  assert.equal(canSee(observer, { x: 600, y: 100 }, []), false);
  assert.equal(canSee(observer, { x: 50, y: 100 }, []), false);
  assert.equal(
    canSee(observer, { x: 200, y: 100 }, [{ x: 150, y: 90, w: 10, h: 20 }]),
    false,
  );
  assert.equal(
    canSee({ ...observer, angle: Math.PI - 0.01 }, { x: 0, y: 99 }, []),
    true,
  );
});

test("segment intersection handles vertical, horizontal, corner, and parallel paths", () => {
  const walls = [{ x: 20, y: 20, w: 10, h: 10 }];
  assert.equal(segmentBlocked({ x: 25, y: 0 }, { x: 25, y: 50 }, walls), true);
  assert.equal(segmentBlocked({ x: 0, y: 25 }, { x: 50, y: 25 }, walls), true);
  assert.equal(segmentBlocked({ x: 0, y: 0 }, { x: 20, y: 20 }, walls), true);
  assert.equal(segmentBlocked({ x: 10, y: 0 }, { x: 10, y: 50 }, walls), false);
  assert.equal(segmentBlocked({ x: 25, y: 25 }, { x: 25, y: 25 }, walls), true);
});

test("shared information disappears when the last observer loses sight", () => {
  const world = createWorld(5);
  assert.ok(
    visibleTo(world, "P2", observe(world)).some(
      (item) => item.targetId === "T1",
    ),
  );
  world.officers
    .filter((officer) => officer.id !== "P2")
    .forEach((officer) => {
      officer.angle = Math.PI / 2;
    });
  assert.equal(
    observe(world).some((item) => item.targetId === "T1"),
    false,
  );
  assert.equal(
    visibleTo(world, "P2", observe(world)).some(
      (item) => item.targetId === "T1",
    ),
    false,
  );
});

test("shared outlines respect receiver direction but ignore receiver distance", () => {
  const world = createWorld();
  world.officers[1].angle = Math.PI / 2;
  assert.equal(
    visibleTo(world, "P2", observe(world)).some(
      (item) => item.targetId === "T1",
    ),
    false,
  );
  world.officers[1].angle = -Math.PI / 2;
  world.officers[1].y = 650;
  assert.equal(
    visibleTo(world, "P2", observe(world, { range: 220 })).some(
      (item) => item.targetId === "T1",
    ),
    true,
  );
  assert.equal(visibleTo(world, "P2", observe(world, { range: 220 }), false)
    .some((item) => item.targetId === "T1"), false);
  assert.equal(visibleTo(world, "P2", observe(world, { range: 190 }))
    .some((item) => item.targetId === "T1"), false);
  assert.deepEqual(visibleTo(world, "missing", observe(world)), []);
});

test("distant sharing stops when the source turns away or becomes occluded", () => {
  const world = createWorld(5);
  world.officers = world.officers.slice(0, 2);
  world.officers[1].y = 650;
  world.targets = world.targets.slice(0, 1);
  const contacts = () => visibleTo(world, "P2", observe(world, { range: 220 }));
  assert.equal(contacts()[0].kind, "shared");
  world.officers[0].angle = Math.PI;
  assert.deepEqual(contacts(), []);
  world.officers[0].angle = 0;
  world.walls.push({ x: 250, y: 190, w: 10, h: 40 });
  assert.deepEqual(contacts(), []);
});

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `Expected ${actual} to be close to ${expected}`);
const angularDelta = (after, before) => Math.atan2(Math.sin(after - before), Math.cos(after - before));

test("automatic scanning rotates every stationary officer at the configured speed", () => {
  const world = createWorld(10);
  const before = structuredClone(world.officers);
  stepWorld(world, 0.5, { autoRotate: true, rotationSpeed: Math.PI / 2 });
  world.officers.forEach((officer, index) => {
    assert.equal(officer.x, before[index].x);
    assert.equal(officer.y, before[index].y);
    near(angularDelta(officer.angle, before[index].angle), Math.PI / 4);
  });
});

test("automatic rotation is opt-in, validates speed, and leaves paused worlds unchanged", () => {
  for (const [speed, expected] of [[undefined, Math.PI / 6], [NaN, Math.PI / 6],
    [Infinity, Math.PI / 6], [-1, 0], [0, 0], [100, Math.PI]]) {
    const world = createWorld();
    const start = world.officers[0].angle;
    stepWorld(world, 0.5, { autoRotate: true, rotationSpeed: speed });
    near(angularDelta(world.officers[0].angle, start), expected * 0.5);
  }
  const world = createWorld();
  const before = structuredClone(world.officers);
  stepWorld(world, 0.5);
  assert.deepEqual(world.officers, before);
  const paused = structuredClone(world);
  stepWorld(world, 0, { autoRotate: true, autoPatrol: true, turn: 1 });
  assert.deepEqual(world, paused);
});

test("manual rotation overrides automatic scanning for the selected officer", () => {
  for (const turn of [-1, 1]) {
    const world = createWorld();
    const before = structuredClone(world.officers);
    stepWorld(world, 0.5, { autoRotate: true, rotationSpeed: 0.4, selectedId: "P1", turn });
    near(angularDelta(world.officers[0].angle, before[0].angle), turn * 1.1);
    near(angularDelta(world.officers[1].angle, before[1].angle), 0.2);
    stepWorld(world, 0.5, { autoRotate: true, rotationSpeed: 0.4, selectedId: "P1" });
    near(angularDelta(world.officers[0].angle, before[0].angle), turn * 1.1 + 0.2);
  }
});

test("a full scan acquires and loses a target and returns to the starting heading", () => {
  const world = createWorld(5);
  world.officers = [world.officers[0]];
  world.officers[0].angle = -Math.PI / 2;
  world.targets = [];
  const target = { id: "T1", x: 380, y: 210, angle: 0, radius: 12 };
  // Observe a fixed target separately from motion to isolate camera scanning.
  const contacts = () => observe({ ...world, targets: [target] });
  assert.deepEqual(contacts(), []);
  stepWorld(world, 1, { autoRotate: true, rotationSpeed: Math.PI / 2 });
  assert.equal(contacts()[0].targetId, "T1");
  stepWorld(world, 1, { autoRotate: true, rotationSpeed: Math.PI / 2 });
  assert.deepEqual(contacts(), []);
  stepWorld(world, 2, { autoRotate: true, rotationSpeed: Math.PI / 2 });
  near(angularDelta(world.officers[0].angle, -Math.PI / 2), 0);
});

test("combined scanning and patrol match fixed ticks and keep the selected officer stationary", () => {
  const large = createWorld();
  const small = createWorld();
  const initial = structuredClone(large.officers);
  const options = { autoRotate: true, autoPatrol: true, rotationSpeed: 0.7 };
  stepWorld(large, 2, options);
  for (let i = 0; i < 120; i++) stepWorld(small, 1 / 60, options);
  assert.deepEqual(large, small);
  assert.equal(large.officers[1].x, initial[1].x);
  assert.equal(large.officers[1].y, initial[1].y);
  assert.notEqual(large.officers[0].x, initial[0].x);
  assert.notEqual(large.officers[0].y, initial[0].y);
});

test("multiple observer identities remain in an observation and positions update live", () => {
  const world = createWorld();
  Object.assign(world.officers[2], { x: 250, y: 170, angle: 0 });
  const before = observe(world).find((item) => item.targetId === "T1");
  assert.ok(before.observers.includes("P1") && before.observers.includes("P3"));
  stepWorld(world, 0.1);
  const after = observe(world).find((item) => item.targetId === "T1");
  assert.notEqual(after.x, before.x);
  assert.equal(after.x, world.targets[0].x);
});

test("large movements cannot tunnel through walls and can slide along them", () => {
  const agent = { x: 200, y: 200, radius: 12 };
  const walls = [{ x: 300, y: 0, w: 10, h: HEIGHT }];
  moveAgent(agent, 700, 100, walls);
  assert.ok(agent.x <= 288);
  assert.ok(agent.y > 290);
  moveAgent(agent, -2000, -2000, walls);
  assert.ok(agent.x >= 12 && agent.y >= 12);
});

test("agent collisions prevent overlapping circles", () => {
  const moving = { x: 100, y: 100, radius: 13 };
  const fixed = { x: 180, y: 100, radius: 13 };
  moveAgent(moving, 300, 0, [], [moving, fixed]);
  assert.ok(Math.hypot(moving.x - fixed.x, moving.y - fixed.y) >= 26);
  assert.ok(moving.x < fixed.x);
});

test("patrol remains deterministic and collision-free over a long run", () => {
  const world = createWorld(10);
  const second = createWorld(10);
  for (let frame = 0; frame < 1200; frame++) {
    stepWorld(world, 1 / 30, { autoPatrol: true });
    stepWorld(second, 1 / 30, { autoPatrol: true });
    const agents = [...world.officers, ...world.targets];
    for (const agent of agents) {
      assert.ok(agent.x >= agent.radius && agent.x <= WIDTH - agent.radius);
      assert.ok(agent.y >= agent.radius && agent.y <= HEIGHT - agent.radius);
      for (const wall of world.walls) {
        const dx =
          agent.x - Math.max(wall.x, Math.min(wall.x + wall.w, agent.x));
        const dy =
          agent.y - Math.max(wall.y, Math.min(wall.y + wall.h, agent.y));
        assert.ok(Math.hypot(dx, dy) >= agent.radius - 1e-7);
      }
      for (const other of agents) {
        if (other !== agent)
          assert.ok(
            Math.hypot(agent.x - other.x, agent.y - other.y) >=
              agent.radius + other.radius - 1e-7,
          );
      }
    }
  }
  assert.deepEqual(world, second);
  assert.ok(Math.abs(world.time - 40) < 1e-8);
});

const clearOfWalls = (agent, walls) => walls.every((wall) => {
  const x = Math.max(wall.x, Math.min(wall.x + wall.w, agent.x));
  const y = Math.max(wall.y, Math.min(wall.y + wall.h, agent.y));
  return Math.hypot(agent.x - x, agent.y - y) >= agent.radius - 1e-7;
});

test("landmarks are deterministic static scenery with valid placement", () => {
  const first = createWorld(5);
  const second = createWorld(10);
  assert.deepEqual(first.landmarks, second.landmarks);
  assert.ok(first.landmarks.length >= 20 && first.landmarks.length <= 40);
  assert.equal(new Set(first.landmarks.map((item) => item.id)).size, first.landmarks.length);
  first.landmarks.forEach((landmark) => {
    assert.ok(landmark.x >= 0 && landmark.x <= WIDTH);
    assert.ok(landmark.y >= 0 && landmark.y <= HEIGHT);
    assert.ok(landmark.strength >= 0 && landmark.strength <= 1);
    const floor = landmark.kind === "floor-marking";
    assert.equal(floor, landmark.normal.x === 0 && landmark.normal.y === 0);
    if (floor) {
      assert.equal(landmark.height, 0);
      assert.equal(first.walls.some((wall) =>
        landmark.x > wall.x && landmark.x < wall.x + wall.w &&
        landmark.y > wall.y && landmark.y < wall.y + wall.h), false);
      return;
    }
    near(Math.hypot(landmark.normal.x, landmark.normal.y), 1);
    assert.ok(first.walls.some((wall) =>
      (Math.abs(landmark.x - wall.x) < 1e-9 && landmark.normal.x === -1 &&
        landmark.y >= wall.y && landmark.y <= wall.y + wall.h) ||
      (Math.abs(landmark.x - (wall.x + wall.w)) < 1e-9 && landmark.normal.x === 1 &&
        landmark.y >= wall.y && landmark.y <= wall.y + wall.h) ||
      (Math.abs(landmark.y - wall.y) < 1e-9 && landmark.normal.y === -1 &&
        landmark.x >= wall.x && landmark.x <= wall.x + wall.w) ||
      (Math.abs(landmark.y - (wall.y + wall.h)) < 1e-9 && landmark.normal.y === 1 &&
        landmark.x >= wall.x && landmark.x <= wall.x + wall.w)));
  });
});

test("visible landmarks respect range, view, occlusion, and wall face direction", () => {
  const officer = { id: "P1", x: 0, y: 0, angle: 0, radius: 13 };
  const floor = { id: "L1", kind: "floor-marking", x: 80, y: 0, height: 0, width: 20,
    normal: { x: 0, y: 0 }, color: "#ffffff", strength: 1 };
  const art = { id: "L2", kind: "wall-art", x: 100, y: 0, height: 80, width: 30,
    normal: { x: -1, y: 0 }, color: "#ff0000", strength: 1 };
  const world = { ...createWorld(5), officers: [officer], targets: [],
    walls: [{ x: 100, y: -20, w: 20, h: 40 }], landmarks: [floor, art] };
  assert.deepEqual(visibleLandmarks(world, officer, { range: 90, fov: Math.PI / 2 })
    .map((item) => item.id), ["L1"]);
  assert.deepEqual(visibleLandmarks(world, officer, { range: 200, fov: Math.PI / 2 })
    .map((item) => item.id), ["L1", "L2"]);
  officer.angle = Math.PI / 2;
  assert.deepEqual(visibleLandmarks(world, officer, { range: 200, fov: Math.PI / 2 }), []);
  officer.angle = 0;
  world.walls.unshift({ x: 45, y: -15, w: 10, h: 30 });
  assert.deepEqual(visibleLandmarks(world, officer, { range: 200, fov: Math.PI / 2 }), []);
  world.walls.shift();
  officer.x = 140;
  officer.angle = Math.PI;
  assert.equal(visibleLandmarks(world, officer, { range: 200, fov: Math.PI / 2 })
    .some((item) => item.id === "L2"), false, "the back of wall art is not visible");
});

test("landmarks never become people, observations, or tracks", () => {
  const world = createWorld(5);
  const snapshot = observe(world);
  const landmarkIds = new Set(world.landmarks.map((item) => item.id));
  assert.equal(snapshot.some((item) => landmarkIds.has(item.targetId)), false);
  assert.equal(visibleTo(world, "P1", snapshot).some((item) => landmarkIds.has(item.targetId)), false);
  assert.equal(awareOf(world, "P1", snapshot).some((item) => landmarkIds.has(item.targetId)), false);
});

test("target locomotion is deterministic, bounded, and clears walls over a long run", () => {
  const first = createWorld(5);
  const second = createWorld(5);
  for (let frame = 0; frame < 1800; frame++) {
    stepWorld(first, 1 / 60);
    stepWorld(second, 1 / 60);
    for (const target of first.targets) {
      assert.ok(target.x >= target.radius && target.x <= WIDTH - target.radius);
      assert.ok(target.y >= target.radius && target.y <= HEIGHT - target.radius);
      assert.ok(clearOfWalls(target, first.walls));
    }
  }
  assert.deepEqual(first.targets, second.targets);
});

test("target gait eases through pauses, walks, and hurry stretches", () => {
  const world = createWorld(5);
  const speeds = [];
  for (let frame = 0; frame < 1800; frame++) {
    stepWorld(world, 1 / 60);
    speeds.push(world.targets[0].motion.speed);
  }
  assert.ok(Math.min(...speeds) < 1, "a person pauses");
  assert.ok(Math.max(...speeds) > 45, "a person occasionally hurries");
  for (let index = 1; index < speeds.length; index++)
    assert.ok(Math.abs(speeds[index] - speeds[index - 1]) <= 38 / 60 + 1e-9);
});

test("target motion has human-scale actual acceleration and modest steering", () => {
  const world = createWorld(5);
  let previous = world.targets.map((target) => ({ x: target.x, y: target.y, speed: 0, angle: target.angle }));
  let peakAcceleration = 0;
  let totalTurnRate = 0;
  let samples = 0;
  for (let frame = 0; frame < 900; frame++) {
    stepWorld(world, 1 / 60);
    world.targets.forEach((target, index) => {
      const before = previous[index];
      const speed = Math.hypot(target.x - before.x, target.y - before.y) * 60;
      if (frame) peakAcceleration = Math.max(peakAcceleration, Math.abs(speed - before.speed) * 60);
      totalTurnRate += Math.abs(angularDelta(target.angle, before.angle)) * 60;
      samples++;
      previous[index] = { x: target.x, y: target.y, speed, angle: target.angle };
    });
  }
  assert.ok(peakAcceleration < 200, `peak actual acceleration was ${peakAcceleration}`);
  assert.ok(totalTurnRate / samples < 0.5, "people mostly walk straight between course corrections");

  const steering = createWorld(5);
  steering.officers = [];
  steering.walls = [];
  steering.targets = [{ id: "T4", x: 200, y: 200, z: 200, angle: Math.PI / 2, radius: 12,
    motion: { seed: 4, goalX: 500, goalY: 200, speed: 0, desiredSpeed: 30,
      resumeSpeed: 30, phaseRemaining: 10, scanDirection: 1, scanAngle: null,
      avoidRemaining: 0, avoidAngle: null } }];
  const heading = steering.targets[0].angle;
  stepWorld(steering, 1);
  assert.ok(Math.abs(angularDelta(steering.targets[0].angle, heading)) > 0.2,
    "a target still turns to steer toward its goal");
});

test("idle glances settle instead of spinning at the turn cap", () => {
  const world = createWorld(5);
  world.officers = [];
  world.walls = [];
  world.targets = [{ id: "T4", x: 200, y: 200, z: 200, angle: 0, radius: 12,
    motion: { seed: 4, goalX: 200, goalY: 200, speed: 0, desiredSpeed: 0,
      resumeSpeed: 0, phaseRemaining: 10, scanDirection: 1, scanAngle: 0.3,
      avoidRemaining: 0, avoidAngle: null } }];
  const turnRates = [];
  for (let frame = 0; frame < 180; frame++) {
    const before = world.targets[0].angle;
    stepWorld(world, 1 / 60);
    turnRates.push(Math.abs(angularDelta(world.targets[0].angle, before)) * 60);
  }
  assert.ok(Math.max(...turnRates) <= 0.35 + 1e-9);
  assert.ok(turnRates.filter((rate) => rate > 1e-8).length < turnRates.length / 2);
  assert.equal(turnRates.at(-1), 0);
});

test("each target gets an independent deterministic motion stream", () => {
  const first = createWorld(5);
  const second = createWorld(5);
  assert.equal(new Set(first.targets.map((target) => target.motion.seed)).size, first.targets.length);
  for (let frame = 0; frame < 600; frame++) {
    stepWorld(first, 1 / 60);
    stepWorld(second, 1 / 60);
  }
  assert.deepEqual(first.targets, second.targets);
  assert.notEqual(first.targets[0].motion.seed, first.targets[1].motion.seed);
  assert.notEqual(first.targets[1].motion.phaseRemaining, first.targets[2].motion.phaseRemaining);
});

test("target facing turns at a capped rate and follows its travel direction", () => {
  const world = createWorld(5);
  for (let frame = 0; frame < 360; frame++) {
    const before = world.targets.map((target) => ({ x: target.x, y: target.y, angle: target.angle }));
    stepWorld(world, 1 / 60);
    world.targets.forEach((target, index) => {
      assert.ok(Math.abs(angularDelta(target.angle, before[index].angle)) <= 2.1 / 60 + 1e-9);
      const dx = target.x - before[index].x;
      const dy = target.y - before[index].y;
      if (Math.hypot(dx, dy) > 0.05)
        assert.ok(Math.abs(angularDelta(Math.atan2(dy, dx), target.angle)) < 1e-7);
    });
  }
});

test("a target turns away from a wall instead of remaining stuck against it", () => {
  const world = createWorld(5);
  const target = world.targets[0];
  Object.assign(target, {
    x: 515, y: 150, z: 150, angle: 0,
    motion: {
      seed: 0x4f1bbcdc, goalX: 700, goalY: 150, speed: 28, desiredSpeed: 28,
      phaseRemaining: 10, scanDirection: 1, avoidRemaining: 0,
    },
  });
  let pathLength = 0;
  for (let frame = 0; frame < 360; frame++) {
    const before = { x: target.x, y: target.y };
    stepWorld(world, 1 / 60);
    pathLength += Math.hypot(target.x - before.x, target.y - before.y);
  }
  assert.ok(pathLength > 80);
  assert.ok(clearOfWalls(target, world.walls));
});

test("a close wall-facing target keeps walking until it finds a route around the wall", () => {
  const world = createWorld(5);
  world.officers = [];
  world.targets = [{ id: "T4", x: 515, y: 150, z: 150, angle: 0, radius: 12,
    motion: { seed: 0x4f1bbcdc, goalX: 700, goalY: 150, speed: 20, desiredSpeed: 32,
      resumeSpeed: 32, phaseRemaining: 20, scanDirection: 1, scanAngle: null,
      avoidRemaining: 0, avoidAngle: null } }];
  const target = world.targets[0];
  let pathLength = 0;
  for (let frame = 0; frame < 360; frame++) {
    const before = { x: target.x, y: target.y };
    stepWorld(world, 1 / 60);
    pathLength += Math.hypot(target.x - before.x, target.y - before.y);
  }
  assert.ok(pathLength > 80);
  assert.ok(target.motion.speed > 1, "recovery must not settle at zero speed");
  assert.ok(clearOfWalls(target, world.walls));
});

test("targets remain mobile and collision-free through a 60-second wander", () => {
  const world = createWorld(5);
  const pathLengths = new Map(world.targets.map((target) => [target.id, 0]));
  for (let frame = 0; frame < 60 * 60; frame++) {
    const before = world.targets.map((target) => ({ x: target.x, y: target.y }));
    stepWorld(world, 1 / 60);
    world.targets.forEach((target, index) => {
      pathLengths.set(target.id, pathLengths.get(target.id) +
        Math.hypot(target.x - before[index].x, target.y - before[index].y));
      assert.ok(target.x >= target.radius && target.x <= WIDTH - target.radius);
      assert.ok(target.y >= target.radius && target.y <= HEIGHT - target.radius);
      assert.ok(clearOfWalls(target, world.walls));
    });
  }
  for (const [id, length] of pathLengths)
    assert.ok(length > 1_200, `${id} only travelled ${length} world units`);
});

test("target locomotion is bit-for-bit deterministic across matching steps", () => {
  const first = createWorld(7);
  const second = createWorld(7);
  for (let frame = 0; frame < 60 * 60; frame++) {
    stepWorld(first, 1 / 60);
    stepWorld(second, 1 / 60);
  }
  assert.deepEqual(first.targets, second.targets);
});

test("target locomotion never depends on the lab hostile flag", () => {
  const first = createWorld(5);
  const second = createWorld(5);
  second.targets.forEach((target) => { target.hostile = !target.hostile; });
  for (let frame = 0; frame < 600; frame++) {
    stepWorld(first, 1 / 60);
    stepWorld(second, 1 / 60);
  }
  const withoutGroundTruth = (targets) => targets.map((target) =>
    Object.fromEntries(Object.entries(target).filter(([key]) => key !== "hostile")));
  assert.deepEqual(withoutGroundTruth(first.targets), withoutGroundTruth(second.targets));
});

test("diagonal input has the same speed as axial input and invalid timesteps are ignored", () => {
  const axial = createWorld();
  const diagonal = createWorld();
  const start = { ...axial.officers[1] };
  stepWorld(axial, 0.2, { moveX: 1 });
  stepWorld(diagonal, 0.2, { moveX: 1, moveY: 1 });
  assert.ok(
    Math.abs(
      Math.hypot(axial.officers[1].x - start.x, axial.officers[1].y - start.y) -
        Math.hypot(
          diagonal.officers[1].x - start.x,
          diagonal.officers[1].y - start.y,
        ),
    ) < 1e-7,
  );
  const stopped = createWorld();
  const clone = structuredClone(stopped);
  stepWorld(stopped, NaN);
  stepWorld(stopped, -1);
  assert.deepEqual(stopped, clone);
});

test("local movement follows the selected officer's heading, including diagonals", () => {
  const advance = (angle, input) => {
    const world = createWorld(5);
    world.officers = [{ id: "P1", x: 400, y: 200, z: 200, angle, radius: 13 }];
    world.targets = [];
    world.walls = [];
    stepWorld(world, 0.1, { selectedId: "P1", ...input });
    return world.officers[0];
  };

  const east = advance(0, { moveForward: 1 });
  assert.ok(east.x > 400 && Math.abs(east.y - 200) < 1e-8);

  const north = advance(-Math.PI / 2, { moveForward: 1 });
  assert.ok(north.y < 200 && Math.abs(north.x - 400) < 1e-8);

  const northWest = advance(-3 * Math.PI / 4, { moveForward: 1 });
  assert.ok(northWest.x < 400 && northWest.y < 200);

  const rightOfNorth = advance(-Math.PI / 2, { moveRight: 1 });
  assert.ok(rightOfNorth.x > 400 && Math.abs(rightOfNorth.y - 200) < 1e-8);
});

test("one large timestep matches many fixed ticks without crossing the opaque wall", () => {
  const large = createWorld();
  const small = createWorld();
  const initialTargets = structuredClone(large.targets);
  stepWorld(large, 2, { moveY: -1 });
  for (let i = 0; i < 120; i++) stepWorld(small, 1 / 60, { moveY: -1 });
  assert.deepEqual(large, small);
  assert.ok(large.officers[1].y >= 342 + large.officers[1].radius);
  large.targets.forEach((target, index) => {
    assert.ok(
      Math.hypot(
        target.x - initialTargets[index].x,
        target.y - initialTargets[index].y,
      ) > 0,
    );
  });
});

test("simulated pose provider uses the production-shaped 3D data contract", () => {
  const world = createWorld(5);
  const poses = createSimulatedPoseProvider(world).read(1234);
  assert.equal(poses.length, 5);
  assert.deepEqual(Object.keys(poses[0]).sort(), ["officerId", "orientation", "position", "timestamp"]);
  assert.deepEqual(Object.keys(poses[0].position).sort(), ["x", "y", "z"]);
});

test("sensor fusion keeps a live, confidence-weighted track and expires stale location", () => {
  const store = new TrackStore({ staleAfterMs: 50 });
  const fused = new SensorFusion(store);
  const reports = [
    { trackId: "T9", officerId: "P1", timestamp: 100, confidence: 1, position: { x: 2, y: 1, z: 4 } },
    { trackId: "T9", officerId: "P2", timestamp: 100, confidence: 0.5, position: { x: 5, y: 1, z: 4 } },
  ];
  const tracks = fused.update(reports, 100);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].position.x, 3);
  assert.deepEqual(tracks[0].observers, ["P1", "P2"]);
  const observations = tracksToObservations(tracks, { range: 420, fov: 2 });
  assert.equal(observations[0].targetId, "T9");
  assert.deepEqual(store.ingest([], 151), []);
});

test("awareness keeps tracks behind the officer that the view filter drops", () => {
  const world = createWorld();
  const snapshot = observe(world);
  const officer = world.officers.find((item) => item.id === "P2");
  officer.angle += Math.PI;
  assert.equal(
    visibleTo(world, "P2", snapshot).some((item) => item.targetId === "T1"),
    false,
  );
  assert.equal(
    awareOf(world, "P2", snapshot).find((item) => item.targetId === "T1")
      ?.kind,
    "shared",
  );
  assert.equal(
    awareOf(world, "P2", snapshot, false).some(
      (item) => item.targetId === "T1",
    ),
    false,
  );
  assert.deepEqual(awareOf(world, "nobody", snapshot), []);
});

const settle = (world, sensor, limit = 900) => {
  for (let step = 0; step < limit && sensor.state === "flight"; step++)
    stepWorld(world, 1 / 60, { selectedId: "none" });
  return sensor;
};

test("a thrown sensor leaves the hand ahead of the officer and comes to rest", () => {
  const world = createWorld();
  const officer = world.officers.find((item) => item.id === "P1");
  const origin = { x: officer.x, y: officer.y };
  const sensor = throwSensor(world, "P1", { timestamp: 0 });
  assert.equal(sensor.ownerId, "P1");
  assert.equal(sensor.state, "flight");
  assert.ok(sensor.height > 30, "the puck leaves the hand at eye height");
  const forward = (sensor.x - origin.x) * Math.cos(officer.angle) + (sensor.y - origin.y) * Math.sin(officer.angle);
  assert.ok(forward > 0, "it starts ahead of the thrower");
  settle(world, sensor);
  assert.equal(sensor.state, "settled");
  assert.ok(sensor.settledAt > 0);
  assert.ok(Math.hypot(sensor.vx, sensor.vy) === 0 && sensor.vz === 0);
  assert.ok(Math.hypot(sensor.x - origin.x, sensor.y - origin.y) > 48, "it travels a usable distance");
});

test("a settled sensor stays put and never leaves the arena or a wall interior", () => {
  const world = createWorld();
  const sensor = settle(world, throwSensor(world, "P4", { timestamp: 0 }));
  const resting = { x: sensor.x, y: sensor.y };
  for (let step = 0; step < 120; step++) stepWorld(world, 1 / 60, { selectedId: "none" });
  assert.deepEqual({ x: sensor.x, y: sensor.y }, resting);
  assert.ok(sensor.x > 0 && sensor.x < WIDTH && sensor.y > 0 && sensor.y < HEIGHT);
  assert.equal(
    world.walls.some((wall) =>
      sensor.x > wall.x && sensor.x < wall.x + wall.w && sensor.y > wall.y && sensor.y < wall.y + wall.h),
    false,
  );
});

test("the kit holds a limited number of pucks and recall frees a slot", () => {
  const world = createWorld();
  for (let index = 0; index < MAX_SENSORS; index++)
    assert.ok(throwSensor(world, "P1", { timestamp: index }));
  assert.equal(world.sensors.length, MAX_SENSORS);
  assert.equal(throwSensor(world, "P1", { timestamp: 99 }), null);
  const ids = world.sensors.map((item) => item.id);
  assert.equal(new Set(ids).size, MAX_SENSORS, "ids are unique");
  assert.equal(recallSensor(world, ids[0]).id, ids[0]);
  assert.equal(recallSensor(world, "nope"), null);
  assert.ok(throwSensor(world, "P1", { timestamp: 100 }));
  assert.equal(throwSensor(world, "nobody", { timestamp: 101 }), null);
});

test("a track from an officer's own puck stays direct without shared vision", () => {
  const world = createWorld();
  const snapshot = observe(world);
  const radar = snapshot.map((item) => ({ ...item, observers: ["M1"] }));
  Object.defineProperty(radar, "vision", { value: snapshot.vision });
  Object.defineProperty(radar, "sensors", { value: [{ id: "M1", ownerId: "P2" }] });
  assert.equal(awareOf(world, "P2", radar, false).length, radar.length);
  assert.ok(awareOf(world, "P2", radar, false).every((item) => item.kind === "direct"));
  assert.equal(awareOf(world, "P1", radar, false).length, 0);
});

test("only the lab knows which detected body is actually hostile", () => {
  const world = createWorld();
  assert.deepEqual(world.targets.map((item) => item.hostile), [true, false, false]);
  const snapshot = observe(world);
  assert.equal(snapshot.some((item) => "hostile" in item), false);
});
