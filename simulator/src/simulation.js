/** Deterministic, renderer-independent simulation. All distances are world pixels. */
export const WIDTH = 1000;
export const HEIGHT = 680;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function createWorld(count = 7) {
  const officerCount = clamp(
    Number.isFinite(Number(count)) ? Math.round(Number(count)) : 7,
    5,
    10,
  );
  const positions = [
    [180, 210, 0],
    [380, 450, -Math.PI / 2],
    [710, 190, 0],
    [190, 545, 0],
    [780, 530, -Math.PI / 2],
    [120, 100, 0.4],
    [590, 110, 0],
    [560, 590, -Math.PI / 2],
    [880, 430, Math.PI],
    [110, 430, -0.7],
  ];
  return {
    time: 0,
    officers: positions.slice(0, officerCount).map(([x, y, angle], i) => ({
      id: `P${i + 1}`,
      x,
      y,
      angle,
      radius: 13,
    })),
    targets: [
      { id: "T1", x: 380, y: 210, angle: 0.35, radius: 12 },
      { id: "T2", x: 850, y: 160, angle: 1.2, radius: 12 },
      { id: "T3", x: 400, y: 540, angle: -0.6, radius: 12 },
    ],
    walls: [
      { x: 100, y: 320, w: 800, h: 22 },
      { x: 535, y: 65, w: 20, h: 175 },
      { x: 645, y: 440, w: 20, h: 190 },
      { x: 80, y: 605, w: 200, h: 18 },
    ],
  };
}

/** Inclusive segment / rectangle intersection: touching an opaque edge blocks sight. */
export function segmentBlocked(start, end, walls) {
  return walls.some((wall) => {
    let entry = 0;
    let exit = 1;
    for (const [axis, minimum, maximum] of [
      ["x", wall.x, wall.x + wall.w],
      ["y", wall.y, wall.y + wall.h],
    ]) {
      const delta = end[axis] - start[axis];
      if (Math.abs(delta) < 1e-10) {
        if (start[axis] < minimum || start[axis] > maximum) return false;
      } else {
        const a = (minimum - start[axis]) / delta;
        const b = (maximum - start[axis]) / delta;
        entry = Math.max(entry, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
        if (entry > exit) return false;
      }
    }
    return true;
  });
}

function inView(observer, target, range, fov) {
  const dx = target.x - observer.x;
  const dy = target.y - observer.y;
  return (
    Math.hypot(dx, dy) <= range &&
    Math.abs(angleDifference(Math.atan2(dy, dx), observer.angle)) <=
      fov / 2 + 1e-10
  );
}

export function canSee(
  observer,
  target,
  walls,
  range = 420,
  fov = Math.PI * 0.65,
) {
  return (
    inView(observer, target, range, fov) &&
    !segmentBlocked(observer, target, walls)
  );
}

/** Only live measurements are emitted; unknown targets do not leak ground truth. */
export function observe(world, { range = 420, fov = Math.PI * 0.65 } = {}) {
  const observations = world.targets.flatMap((target) => {
    const observers = world.officers
      .filter((officer) => canSee(officer, target, world.walls, range, fov))
      .map((officer) => officer.id);
    return observers.length
      ? [{ targetId: target.id, x: target.x, y: target.y, observers }]
      : [];
  });
  // Keep projection settings with the snapshot without changing its array/JSON shape.
  Object.defineProperty(observations, "vision", { value: { range, fov } });
  return observations;
}

export function visibleTo(world, officerId, observations, sharing = true) {
  const officer = world.officers.find((item) => item.id === officerId);
  if (!officer) return [];
  const { fov = Math.PI * 0.65 } = observations.vision ?? {};
  return observations.flatMap((observation) => {
    // A live teammate measurement has no receiving camera distance limit.
    if (!inView(officer, observation, Infinity, fov)) return [];
    const direct = observation.observers.includes(officerId);
    return direct || sharing
      ? [{ ...observation, kind: direct ? "direct" : "shared" }]
      : [];
  });
}

function fits(agent, x, y, walls, others) {
  const radius = agent.radius;
  if (x < radius || y < radius || x > WIDTH - radius || y > HEIGHT - radius)
    return false;
  for (const wall of walls) {
    const nearX = clamp(x, wall.x, wall.x + wall.w);
    const nearY = clamp(y, wall.y, wall.y + wall.h);
    if (Math.hypot(x - nearX, y - nearY) < radius - 1e-8) return false;
  }
  return !others.some(
    (other) =>
      other !== agent &&
      Math.hypot(x - other.x, y - other.y) < radius + other.radius - 1e-8,
  );
}

/** Substeps prevent tunneling; independent axes let an agent slide along a wall. */
export function moveAgent(agent, dx, dy, walls, others = []) {
  if (![dx, dy].every(Number.isFinite))
    return { blockedX: false, blockedY: false };
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(dx, dy) / Math.max(1, agent.radius / 2)),
  );
  const sx = dx / steps;
  const sy = dy / steps;
  let blockedX = false;
  let blockedY = false;
  for (let i = 0; i < steps; i++) {
    if (fits(agent, agent.x + sx, agent.y, walls, others)) agent.x += sx;
    else if (sx) blockedX = true;
    if (fits(agent, agent.x, agent.y + sy, walls, others)) agent.y += sy;
    else if (sy) blockedY = true;
  }
  return { blockedX, blockedY };
}

function patrol(agent, speed, dt, walls, others) {
  const result = moveAgent(
    agent,
    Math.cos(agent.angle) * speed * dt,
    Math.sin(agent.angle) * speed * dt,
    walls,
    others,
  );
  if (result.blockedX) agent.angle = Math.PI - agent.angle;
  if (result.blockedY) agent.angle = -agent.angle;
  agent.angle = angleDifference(agent.angle, 0);
}

export function stepWorld(
  world,
  dt,
  {
    autoPatrol = false,
    autoRotate = false,
    rotationSpeed = Math.PI / 6,
    selectedId = "P2",
    moveX = 0,
    moveY = 0,
    turn = 0,
  } = {},
) {
  if (!Number.isFinite(dt) || dt <= 0) return world;
  const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
  const tick = dt / steps;
  const others = [...world.officers, ...world.targets];
  const selected = world.officers.find((officer) => officer.id === selectedId);
  moveX = Number.isFinite(moveX) ? moveX : 0;
  moveY = Number.isFinite(moveY) ? moveY : 0;
  turn = Number.isFinite(turn) ? clamp(turn, -1, 1) : 0;
  rotationSpeed = Number.isFinite(rotationSpeed)
    ? clamp(rotationSpeed, 0, Math.PI)
    : Math.PI / 6;
  const magnitude = Math.max(1, Math.hypot(moveX, moveY));
  for (let i = 0; i < steps; i++) {
    for (const officer of world.officers) {
      const angularSpeed = officer === selected && turn !== 0
        ? turn * 2.2
        : autoRotate ? rotationSpeed : 0;
      officer.angle = angleDifference(officer.angle + angularSpeed * tick, 0);
    }
    if (selected) {
      moveAgent(
        selected,
        (moveX / magnitude) * 130 * tick,
        (moveY / magnitude) * 130 * tick,
        world.walls,
        others,
      );
    }
    if (autoPatrol) {
      for (const officer of world.officers) {
        if (officer !== selected)
          patrol(officer, 32, tick, world.walls, others);
      }
    }
    for (const target of world.targets)
      patrol(target, 44, tick, world.walls, others);
    world.time += tick;
  }
  return world;
}
