import test from "node:test";
import assert from "node:assert/strict";
import {
  WIDTH,
  HEIGHT,
  createWorld,
  stepWorld,
  canSee,
  observe,
  visibleTo,
  segmentBlocked,
  moveAgent,
} from "../src/simulation.js";

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
