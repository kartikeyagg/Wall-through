/** Deterministic, renderer-independent simulation. Ground plane distances are world units. */
import { KinematicPhysicsAdapter, WORLD_DEPTH, WORLD_WIDTH, moveKinematic } from "./physics.js";
export const WIDTH = WORLD_WIDTH;
export const HEIGHT = WORLD_DEPTH;
/** Pucks an officer carries. A thrown sensor stays in the world until recalled. */
export const MAX_SENSORS = 4;
const SENSOR_RADIUS = 5;
const THROW_SPEED = 260;
const THROW_LIFT = 150;
const GRAVITY = 235;
const AIR_DRAG = 0.72;
const BOUNCE = 0.34;
const RESTING_SPEED = 9;
const TARGET_WALK_MIN = 24;
const TARGET_WALK_MAX = 42;
const TARGET_HURRY_MIN = 48;
const TARGET_HURRY_MAX = 58;
const TARGET_ACCELERATION = 30;
const TARGET_BRAKING = 38;
const TARGET_TURN_RATE = 1.35;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// A local PRNG makes wandering repeatable without coupling targets to one another.
function nextTargetRandom(motion) {
  let value = motion.seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  motion.seed = value >>> 0;
  return motion.seed / 0x100000000;
}

function targetMotion(seed, goalX, goalY) {
  return {
    seed,
    goalX,
    goalY,
    speed: 0,
    desiredSpeed: TARGET_WALK_MIN,
    phaseRemaining: 1.5,
    scanDirection: seed & 1 ? 1 : -1,
    avoidRemaining: 0,
  };
}

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
      z: y,
      angle,
      radius: 13,
    })),
    // `hostile` is lab ground truth only. No sensor, track or officer-facing
    // projection may read it: the system flags every detected body, and an
    // officer has to clear the bystanders by hand.
    targets: [
      { id: "T1", x: 380, y: 210, z: 210, angle: 0.35, radius: 12, hostile: true,
        motion: targetMotion(0x4f1bbcdc, 470, 205) },
      { id: "T2", x: 850, y: 160, z: 160, angle: 1.2, radius: 12, hostile: false,
        motion: targetMotion(0x71e2a9c3, 760, 245) },
      { id: "T3", x: 400, y: 540, z: 540, angle: -0.6, radius: 12, hostile: false,
        motion: targetMotion(0x19c84a6d, 340, 470) },
    ],
    sensors: [],
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

/**
 * A track reported by a puck this officer threw is their own measurement, not a
 * teammate's, so it survives with shared vision switched off. Sensor ownership
 * travels with the observation array, beside its vision settings.
 */
function ownsObservation(observation, officerId, observations) {
  if (observation.observers.includes(officerId)) return true;
  const sensors = observations.sensors ?? [];
  return observation.observers.some((observer) =>
    sensors.some((sensor) => sensor.id === observer && sensor.ownerId === officerId),
  );
}

export function visibleTo(world, officerId, observations, sharing = true) {
  const officer = world.officers.find((item) => item.id === officerId);
  if (!officer) return [];
  const { fov = Math.PI * 0.65 } = observations.vision ?? {};
  return observations.flatMap((observation) => {
    // A live teammate measurement has no receiving camera distance limit.
    if (!inView(officer, observation, Infinity, fov)) return [];
    const direct = ownsObservation(observation, officerId, observations);
    return direct || sharing
      ? [{ ...observation, kind: direct ? "direct" : "shared" }]
      : [];
  });
}

/**
 * Every live track the officer knows about, in any direction: their own
 * measurements plus, with sharing on, teammates'. Unlike `visibleTo`, nothing is
 * dropped for lying outside the officer's field of view — this feeds the HUD
 * arrows that point at targets behind their back.
 */
export function awareOf(world, officerId, observations, sharing = true) {
  if (!world.officers.some((item) => item.id === officerId)) return [];
  return observations.flatMap((observation) => {
    const direct = ownsObservation(observation, officerId, observations);
    return direct || sharing
      ? [{ ...observation, kind: direct ? "direct" : "shared" }]
      : [];
  });
}

/**
 * Throw an mmWave puck along the officer's heading. It leaves their hand at eye
 * height, arcs, bounces off walls and settles wherever it stops — nobody,
 * including the puck, knows where that is until a stereo camera fixes it.
 */
export function throwSensor(world, officerId, { timestamp = world.time * 1000, speed = THROW_SPEED, lift = THROW_LIFT } = {}) {
  const officer = world.officers.find((item) => item.id === officerId);
  if (!officer) return null;
  world.sensors ??= [];
  if (world.sensors.length >= MAX_SENSORS) return null;
  const serial = world.sensors.reduce((highest, sensor) => Math.max(highest, Number(sensor.id.slice(1)) || 0), 0) + 1;
  const push = officer.radius + SENSOR_RADIUS + 1;
  const sensor = {
    id: `M${serial}`,
    ownerId: officerId,
    x: officer.x + Math.cos(officer.angle) * push,
    y: officer.y + Math.sin(officer.angle) * push,
    z: officer.y + Math.sin(officer.angle) * push,
    angle: officer.angle,
    radius: SENSOR_RADIUS,
    height: 40.8, // eye height in world units: the puck leaves the hand, not the floor
    vx: Math.cos(officer.angle) * speed,
    vy: Math.sin(officer.angle) * speed,
    vz: lift,
    spin: 5.4,
    state: "flight",
    thrownAt: timestamp,
    settledAt: null,
  };
  world.sensors.push(sensor);
  return sensor;
}

export function recallSensor(world, sensorId) {
  const index = world.sensors?.findIndex((sensor) => sensor.id === sensorId) ?? -1;
  if (index < 0) return null;
  return world.sensors.splice(index, 1)[0];
}

/** Ballistic flight with drag, wall bounces and a resting threshold. */
function flySensor(sensor, dt, physics) {
  sensor.vz -= GRAVITY * dt;
  sensor.height += sensor.vz * dt;
  sensor.angle = angleDifference(sensor.angle + sensor.spin * dt, 0);
  const result = physics.moveKinematic(sensor, sensor.vx * dt, sensor.vy * dt);
  if (result.blockedX) sensor.vx = -sensor.vx * BOUNCE;
  if (result.blockedY) sensor.vy = -sensor.vy * BOUNCE;
  if (sensor.height <= SENSOR_RADIUS) {
    sensor.height = SENSOR_RADIUS;
    sensor.vz = Math.abs(sensor.vz) > 40 ? Math.abs(sensor.vz) * BOUNCE : 0;
    sensor.vx *= 1 - AIR_DRAG * dt * 3;
    sensor.vy *= 1 - AIR_DRAG * dt * 3;
    sensor.spin *= 1 - AIR_DRAG * dt * 3;
  } else {
    sensor.vx *= 1 - AIR_DRAG * dt;
    sensor.vy *= 1 - AIR_DRAG * dt;
  }
  sensor.z = sensor.y;
  if (sensor.height <= SENSOR_RADIUS && sensor.vz === 0 && Math.hypot(sensor.vx, sensor.vy) < RESTING_SPEED) {
    sensor.vx = 0;
    sensor.vy = 0;
    sensor.spin = 0;
    sensor.state = "settled";
  }
}

/** @deprecated Use KinematicPhysicsAdapter; retained for compatible consumers. */
export function moveAgent(agent, dx, dy, walls, others = []) {
  return moveKinematic(agent, dx, dy, walls, others);
}

function patrol(agent, speed, dt, physics) {
  const result = physics.moveKinematic(
    agent,
    Math.cos(agent.angle) * speed * dt,
    Math.sin(agent.angle) * speed * dt,
  );
  if (result.blockedX) agent.angle = Math.PI - agent.angle;
  if (result.blockedY) agent.angle = -agent.angle;
  agent.angle = angleDifference(agent.angle, 0);
}

function targetFits(target, x, y, walls) {
  if (x < target.radius || y < target.radius || x > WIDTH - target.radius || y > HEIGHT - target.radius)
    return false;
  return !walls.some((wall) => {
    const nearX = clamp(x, wall.x, wall.x + wall.w);
    const nearY = clamp(y, wall.y, wall.y + wall.h);
    return Math.hypot(x - nearX, y - nearY) < target.radius + 8;
  });
}

function chooseTargetGoal(target, world) {
  const motion = target.motion;
  // These spread routes across both sides of the interior partitions.
  const waypoints = [
    [130, 120], [280, 180], [440, 250], [680, 150], [840, 245],
    [150, 430], [300, 520], [470, 440], [580, 560], [770, 540], [900, 420],
  ];
  const start = Math.floor(nextTargetRandom(motion) * waypoints.length);
  for (let offset = 0; offset < waypoints.length; offset++) {
    const [x, y] = waypoints[(start + offset) % waypoints.length];
    if (targetFits(target, x, y, world.walls) && !segmentBlocked(target, { x, y }, world.walls)) {
      motion.goalX = x;
      motion.goalY = y;
      return;
    }
  }
  // The current location is always safe; trying again later is safer than clipping a wall.
  motion.goalX = target.x;
  motion.goalY = target.y;
}

function stepTarget(target, dt, physics, world) {
  const motion = target.motion ??= targetMotion(0x9e3779b9, target.x, target.y);
  motion.phaseRemaining -= dt;
  if (motion.phaseRemaining <= 0) {
    const choice = nextTargetRandom(motion);
    motion.phaseRemaining = choice < 0.22
      ? 1.2 + nextTargetRandom(motion) * 2.4
      : 2.5 + nextTargetRandom(motion) * 3.5;
    motion.desiredSpeed = choice < 0.22
      ? 0
      : choice > 0.88
        ? TARGET_HURRY_MIN + nextTargetRandom(motion) * (TARGET_HURRY_MAX - TARGET_HURRY_MIN)
        : TARGET_WALK_MIN + nextTargetRandom(motion) * (TARGET_WALK_MAX - TARGET_WALK_MIN);
    motion.scanDirection = nextTargetRandom(motion) < 0.5 ? -1 : 1;
    if (motion.desiredSpeed > 0) chooseTargetGoal(target, world);
  }

  const distance = Math.hypot(motion.goalX - target.x, motion.goalY - target.y);
  if (distance < 22 && motion.desiredSpeed > 0) chooseTargetGoal(target, world);
  let desiredAngle = Math.atan2(motion.goalY - target.y, motion.goalX - target.x);
  if (motion.desiredSpeed === 0) {
    // A pause is a look-around, not a frozen mannequin.
    desiredAngle = target.angle + motion.scanDirection * 0.55;
  } else if (motion.avoidRemaining > 0) {
    desiredAngle = target.angle + motion.scanDirection * Math.PI / 2;
    motion.avoidRemaining -= dt;
  }
  const turn = clamp(angleDifference(desiredAngle, target.angle), -TARGET_TURN_RATE * dt, TARGET_TURN_RATE * dt);
  target.angle = angleDifference(target.angle + turn, 0);
  const acceleration = motion.desiredSpeed > motion.speed ? TARGET_ACCELERATION : TARGET_BRAKING;
  motion.speed += clamp(motion.desiredSpeed - motion.speed, -acceleration * dt, acceleration * dt);
  if (motion.speed <= 1e-8) return;
  const result = physics.moveKinematic(
    target,
    Math.cos(target.angle) * motion.speed * dt,
    Math.sin(target.angle) * motion.speed * dt,
  );
  if (result.blockedX || result.blockedY) {
    // Turn along an obstruction and select a route rather than reflecting off it.
    if (motion.avoidRemaining <= 0) {
      motion.scanDirection = nextTargetRandom(motion) < 0.5 ? -1 : 1;
      motion.avoidRemaining = 0.8 + nextTargetRandom(motion) * 0.5;
      motion.desiredSpeed = Math.min(motion.desiredSpeed, TARGET_WALK_MAX);
      chooseTargetGoal(target, world);
    }
  }
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
    moveForward = 0,
    moveRight = 0,
    turn = 0,
  } = {},
) {
  if (!Number.isFinite(dt) || dt <= 0) return world;
  const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
  const tick = dt / steps;
  const others = [...world.officers, ...world.targets];
  const physics = new KinematicPhysicsAdapter({ walls: world.walls, bodies: others });
  // A thrown puck is small enough to skitter past people; only walls stop it.
  const sensorPhysics = new KinematicPhysicsAdapter({ walls: world.walls, bodies: [] });
  const selected = world.officers.find((officer) => officer.id === selectedId);
  moveX = Number.isFinite(moveX) ? moveX : 0;
  moveY = Number.isFinite(moveY) ? moveY : 0;
  moveForward = Number.isFinite(moveForward) ? moveForward : 0;
  moveRight = Number.isFinite(moveRight) ? moveRight : 0;
  turn = Number.isFinite(turn) ? clamp(turn, -1, 1) : 0;
  rotationSpeed = Number.isFinite(rotationSpeed)
    ? clamp(rotationSpeed, 0, Math.PI)
    : Math.PI / 6;
  for (let i = 0; i < steps; i++) {
    for (const officer of world.officers) {
      const angularSpeed = officer === selected && turn !== 0
        ? turn * 2.2
        : autoRotate ? rotationSpeed : 0;
      officer.angle = angleDifference(officer.angle + angularSpeed * tick, 0);
    }
    if (selected) {
      // Keyboard movement is expressed in the selected officer's frame: forward
      // follows their gaze, while right is perpendicular to it. World-axis input
      // remains available for programmatic consumers of the simulation.
      const forwardX = Math.cos(selected.angle) * moveForward;
      const forwardY = Math.sin(selected.angle) * moveForward;
      const rightX = -Math.sin(selected.angle) * moveRight;
      const rightY = Math.cos(selected.angle) * moveRight;
      const dx = moveX + forwardX + rightX;
      const dy = moveY + forwardY + rightY;
      const magnitude = Math.max(1, Math.hypot(dx, dy));
      physics.moveKinematic(
        selected,
        (dx / magnitude) * 130 * tick,
        (dy / magnitude) * 130 * tick,
      );
    }
    if (autoPatrol) {
      for (const officer of world.officers) {
        if (officer !== selected)
          patrol(officer, 32, tick, physics);
      }
    }
    for (const target of world.targets)
      stepTarget(target, tick, physics, world);
    for (const sensor of world.sensors ?? []) {
      if (sensor.state !== "flight") continue;
      flySensor(sensor, tick, sensorPhysics);
      if (sensor.state === "settled" && sensor.settledAt === null)
        sensor.settledAt = (world.time + tick) * 1000;
    }
    for (const agent of others) agent.z = agent.y;
    world.time += tick;
  }
  return world;
}
