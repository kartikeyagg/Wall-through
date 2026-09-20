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
const TARGET_TURN_RATE = 2.1;
const TARGET_IDLE_TURN_RATE = 0.35;
const TARGET_REPLAN_INTERVAL = 0.65;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function seedForId(id) {
  let seed = 2166136261;
  for (let index = 0; index < id.length; index++) {
    seed ^= id.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

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
    scanAngle: null,
    avoidRemaining: 0,
    avoidAngle: null,
    resumeSpeed: TARGET_WALK_MIN,
    navigationAngle: null,
    replanRemaining: 0,
    stuckElapsed: 0,
    stuckX: null,
    stuckY: null,
    turnDirection: 0,
    turnHoldRemaining: 0,
  };
}

function nextLandmarkRandom(state) {
  state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0;
  return state.value / 0x100000000;
}

function createLandmarks(walls) {
  const random = { value: 0x6c8e9cf5 };
  const colors = ["#d95f5f", "#e6ad3d", "#5ca9d6", "#72b978", "#9b75cf", "#d676a7"];
  const landmarks = [];
  const wallItem = (wallIndex, face, along, kind) => {
    const wall = walls[wallIndex];
    const horizontal = face === "top" || face === "bottom";
    const normal = horizontal
      ? { x: 0, y: face === "top" ? -1 : 1 }
      : { x: face === "left" ? -1 : 1, y: 0 };
    landmarks.push({
      id: `L${landmarks.length + 1}`,
      kind,
      x: horizontal ? wall.x + along * wall.w : face === "left" ? wall.x : wall.x + wall.w,
      y: horizontal ? face === "top" ? wall.y : wall.y + wall.h : wall.y + along * wall.h,
      height: kind === "fixture" ? 34 + nextLandmarkRandom(random) * 35 : 65 + nextLandmarkRandom(random) * 85,
      width: kind === "fixture" ? 16 + nextLandmarkRandom(random) * 18 : 24 + nextLandmarkRandom(random) * 48,
      normal,
      color: colors[Math.floor(nextLandmarkRandom(random) * colors.length)],
      strength: 0.25 + nextLandmarkRandom(random) * 0.75,
    });
  };
  // The long middle of the main partition is intentionally bare for weak fixes.
  [0.08, 0.19, 0.79, 0.91].forEach((along, index) =>
    wallItem(0, index % 2 ? "bottom" : "top", along, index === 1 ? "wall-panel" : "wall-art"));
  [[1, "left"], [1, "right"], [2, "left"], [2, "right"], [3, "top"], [3, "bottom"]]
    .forEach(([wallIndex, face], index) => {
      for (let item = 0; item < (index < 2 ? 3 : 2); item++)
        wallItem(wallIndex, face, 0.16 + item * 0.31 + nextLandmarkRandom(random) * 0.08,
          (index + item) % 4 === 0 ? "fixture" : (index + item) % 2 ? "wall-panel" : "wall-art");
    });
  const clearFloor = (x, y) => !walls.some((wall) =>
    x > wall.x - 18 && x < wall.x + wall.w + 18 && y > wall.y - 18 && y < wall.y + wall.h + 18);
  while (landmarks.length < 30) {
    const x = 55 + nextLandmarkRandom(random) * (WIDTH - 110);
    const y = 55 + nextLandmarkRandom(random) * (HEIGHT - 110);
    if (!clearFloor(x, y)) continue;
    landmarks.push({
      id: `L${landmarks.length + 1}`,
      kind: "floor-marking",
      x,
      y,
      height: 0,
      width: 18 + nextLandmarkRandom(random) * 38,
      normal: { x: 0, y: 0 },
      color: colors[Math.floor(nextLandmarkRandom(random) * colors.length)],
      strength: 0.18 + nextLandmarkRandom(random) * 0.72,
    });
  }
  return landmarks;
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
  const walls = [
    { x: 100, y: 320, w: 800, h: 22 },
    { x: 535, y: 65, w: 20, h: 175 },
    { x: 645, y: 440, w: 20, h: 190 },
    { x: 80, y: 605, w: 200, h: 18 },
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
        motion: targetMotion(seedForId("T1"), 470, 205) },
      { id: "T2", x: 850, y: 160, z: 160, angle: 1.2, radius: 12, hostile: false,
        motion: targetMotion(seedForId("T2"), 760, 245) },
      { id: "T3", x: 400, y: 540, z: 540, angle: -0.6, radius: 12, hostile: false,
        motion: targetMotion(seedForId("T3"), 340, 470) },
    ],
    sensors: [],
    walls,
    landmarks: createLandmarks(walls),
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

/** Static visual features visible to one camera, excluding their back faces. */
export function visibleLandmarks(
  world,
  officer,
  { range = 420, fov = Math.PI * 0.65 } = {},
) {
  return (world.landmarks ?? []).filter((landmark) => {
    if (!inView(officer, landmark, range, fov)) return false;
    const { normal } = landmark;
    if (normal.x || normal.y) {
      const facingSide = (officer.x - landmark.x) * normal.x +
        (officer.y - landmark.y) * normal.y;
      if (facingSide <= 1e-8) return false;
    }
    // The item itself is flush with its opaque wall, so trace to its visible face.
    const visibleFace = {
      x: landmark.x + normal.x * 1e-6,
      y: landmark.y + normal.y * 1e-6,
    };
    return !segmentBlocked(officer, visibleFace, world.walls);
  });
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
    // Goals are destinations, rather than immediate steering instructions. A
    // route may cross a partition; the local planner below takes it around.
    if (targetFits(target, x, y, world.walls)) {
      motion.goalX = x;
      motion.goalY = y;
      return;
    }
  }
  // Every listed waypoint is normally valid. Retaining the previous goal is
  // safer than turning a failed selection into a per-frame goal churn.
}

function rayBoxDistance(x, y, dx, dy, left, top, right, bottom) {
  let entry = -Infinity;
  let exit = Infinity;
  for (const [origin, delta, low, high] of [[x, dx, left, right], [y, dy, top, bottom]]) {
    if (Math.abs(delta) < 1e-10) {
      if (origin < low || origin > high) return Infinity;
      continue;
    }
    const first = (low - origin) / delta;
    const second = (high - origin) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
  }
  return exit >= Math.max(entry, 0) ? Math.max(entry, 0) : Infinity;
}

function forwardClearance(target, world, angle = target.angle) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let nearest = Infinity;
  if (dx > 1e-10) nearest = (WIDTH - target.radius - target.x) / dx;
  if (dx < -1e-10) nearest = (target.radius - target.x) / dx;
  if (dy > 1e-10) nearest = Math.min(nearest, (HEIGHT - target.radius - target.y) / dy);
  if (dy < -1e-10) nearest = Math.min(nearest, (target.radius - target.y) / dy);
  for (const wall of world.walls) {
    const clearanceRadius = target.radius - 1e-6;
    nearest = Math.min(nearest, rayBoxDistance(target.x, target.y, dx, dy,
      wall.x - clearanceRadius, wall.y - clearanceRadius,
      wall.x + wall.w + clearanceRadius, wall.y + wall.h + clearanceRadius));
  }
  for (const body of [...world.officers, ...world.targets]) {
    if (body === target) continue;
    const offsetX = body.x - target.x;
    const offsetY = body.y - target.y;
    const along = offsetX * dx + offsetY * dy;
    const across = offsetX * -dy + offsetY * dx;
    const radius = target.radius + body.radius;
    if (along > 0 && Math.abs(across) < radius)
      nearest = Math.min(nearest, along - Math.sqrt(radius ** 2 - across ** 2));
  }
  return nearest;
}

function nearestObstructionAngle(target, world) {
  let nearest = Infinity;
  let awayX = 0;
  let awayY = 0;
  const consider = (x, y) => {
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance < nearest) {
      nearest = distance;
      awayX = target.x - x;
      awayY = target.y - y;
    }
  };
  for (const wall of world.walls)
    consider(clamp(target.x, wall.x, wall.x + wall.w), clamp(target.y, wall.y, wall.y + wall.h));
  consider(0, target.y);
  consider(WIDTH, target.y);
  consider(target.x, 0);
  consider(target.x, HEIGHT);
  return Math.hypot(awayX, awayY) > 1e-8 ? Math.atan2(awayY, awayX) : target.angle + Math.PI;
}

function planTargetHeading(target, motion, world, escapeAngle = null) {
  const goalAngle = Math.atan2(motion.goalY - target.y, motion.goalX - target.x);
  const centre = escapeAngle ?? goalAngle;
  const offsets = [0, 0.32, -0.32, 0.64, -0.64, 0.98, -0.98, 1.35, -1.35, 1.75, -1.75, Math.PI];
  let bestAngle = centre;
  let bestScore = -Infinity;
  for (const offset of offsets) {
    const angle = angleDifference(centre + offset, 0);
    const clearance = forwardClearance(target, world, angle);
    const probe = Math.min(34, Math.max(0, clearance - 2));
    const probeFits = targetFits(target,
      target.x + Math.cos(angle) * probe,
      target.y + Math.sin(angle) * probe,
      world.walls);
    if (!probeFits) continue;
    const progress = Math.cos(angleDifference(angle, goalAngle));
    const continuity = Math.cos(angleDifference(angle, target.angle));
    // Clearance dominates near a wall, while progress and continuity prevent
    // needless zig-zags in open floor.
    const score = Math.min(clearance, 120) + progress * 42 + continuity * 10;
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  motion.navigationAngle = bestAngle;
  motion.replanRemaining = TARGET_REPLAN_INTERVAL + nextTargetRandom(motion) * 0.2;
  motion.scanDirection = Math.sign(angleDifference(bestAngle, target.angle)) || motion.scanDirection;
  if (escapeAngle !== null || forwardClearance(target, world) < 15)
    motion.turnHoldRemaining = 0;
}

function beginAvoid(target, motion, world, forceGoal = false) {
  if (forceGoal) chooseTargetGoal(target, world);
  motion.avoidRemaining = 0;
  motion.avoidAngle = null;
  motion.desiredSpeed = motion.resumeSpeed;
  planTargetHeading(target, motion, world, nearestObstructionAngle(target, world));
}

function stepTarget(target, dt, physics, world) {
  const motion = target.motion ??= targetMotion(seedForId(target.id), target.x, target.y);
  motion.resumeSpeed ??= motion.desiredSpeed;
  motion.navigationAngle ??= null;
  motion.replanRemaining ??= 0;
  motion.stuckElapsed ??= 0;
  motion.stuckX ??= target.x;
  motion.stuckY ??= target.y;
  motion.turnDirection ??= 0;
  motion.turnHoldRemaining ??= 0;
  motion.phaseRemaining -= dt;
  if (motion.phaseRemaining <= 0) {
    const choice = nextTargetRandom(motion);
    motion.phaseRemaining = choice < 0.22
      ? 0.7 + nextTargetRandom(motion) * 1.1
      : 2.5 + nextTargetRandom(motion) * 3.5;
    const nextSpeed = choice < 0.22
      ? 0
      : choice > 0.88
        ? TARGET_HURRY_MIN + nextTargetRandom(motion) * (TARGET_HURRY_MAX - TARGET_HURRY_MIN)
        : TARGET_WALK_MIN + nextTargetRandom(motion) * (TARGET_WALK_MAX - TARGET_WALK_MIN);
    motion.scanDirection = nextTargetRandom(motion) < 0.5 ? -1 : 1;
    motion.resumeSpeed = nextSpeed;
    if (motion.avoidRemaining <= 0) motion.desiredSpeed = nextSpeed;
    // A pause gets at most one small, occasional glance, then settles.
    motion.scanAngle = nextSpeed === 0 && nextTargetRandom(motion) < 0.55
      ? angleDifference(target.angle + motion.scanDirection * (0.2 + nextTargetRandom(motion) * 0.35), 0)
      : null;
    if (nextSpeed > 0) {
      chooseTargetGoal(target, world);
      motion.replanRemaining = 0;
    }
  }

  const distance = Math.hypot(motion.goalX - target.x, motion.goalY - target.y);
  if (distance < 22 && motion.resumeSpeed > 0) {
    chooseTargetGoal(target, world);
    motion.replanRemaining = 0;
  }
  const goalAngle = Math.atan2(motion.goalY - target.y, motion.goalX - target.x);
  let desiredAngle = goalAngle;
  if (motion.resumeSpeed === 0) {
    desiredAngle = motion.scanAngle ?? target.angle;
  }
  if (motion.resumeSpeed > 0) {
    motion.replanRemaining -= dt;
    const directBlocked = segmentBlocked(target, { x: motion.goalX, y: motion.goalY }, world.walls);
    const clearance = forwardClearance(target, world);
    if (directBlocked || clearance < 20) {
      if (motion.replanRemaining <= 0 || motion.navigationAngle === null)
        planTargetHeading(target, motion, world);
      desiredAngle = motion.navigationAngle ?? goalAngle;
    } else {
      motion.navigationAngle = null;
      desiredAngle = goalAngle;
    }
  }
  const turnRate = motion.resumeSpeed === 0 ? TARGET_IDLE_TURN_RATE : TARGET_TURN_RATE;
  const angleToDesired = angleDifference(desiredAngle, target.angle);
  let turnDirection = Math.sign(angleToDesired);
  // A moving goal can straddle the current heading by a fraction of a degree.
  // Hold the previous turn through that tiny error band so the body does not
  // visibly wag left/right every render frame.
  if (turnDirection && motion.turnDirection && turnDirection !== motion.turnDirection &&
      Math.abs(angleToDesired) < 0.24)
    turnDirection = 0;
  motion.turnHoldRemaining = Math.max(0, motion.turnHoldRemaining - dt);
  if (turnDirection && motion.turnDirection && turnDirection !== motion.turnDirection) {
    if (motion.turnHoldRemaining > 0) turnDirection = 0;
    else motion.turnHoldRemaining = 1.2;
  }
  if (turnDirection) motion.turnDirection = turnDirection;
  const turn = turnDirection * Math.min(Math.abs(angleToDesired), turnRate * dt);
  target.angle = angleDifference(target.angle + turn, 0);
  if (motion.resumeSpeed > 0) {
    // Brake for the heading being turned onto as well as the one held now: a
    // course correction must not carry the body into a wall it has yet to face.
    const ahead = angleDifference(target.angle + turnDirection * turnRate * 0.4, 0);
    const clearance = Math.min(
      forwardClearance(target, world),
      forwardClearance(target, world, ahead),
    );
    // Ease down for a tight turn; unlike the former stop state, the active
    // course correction continues turning and resumes as soon as it is clear.
    const safeSpeed = Math.sqrt(2 * TARGET_BRAKING * Math.max(0, clearance - 8));
    motion.desiredSpeed = Math.min(motion.resumeSpeed, safeSpeed);
  }
  const acceleration = motion.desiredSpeed > motion.speed ? TARGET_ACCELERATION : TARGET_BRAKING;
  motion.speed += clamp(motion.desiredSpeed - motion.speed, -acceleration * dt, acceleration * dt);
  if (motion.speed > 1e-8) {
    const step = motion.speed * dt;
    const fromX = target.x;
    const fromY = target.y;
    const result = physics.moveKinematic(
      target,
      Math.cos(target.angle) * step,
      Math.sin(target.angle) * step,
    );
    // Contact is a graze, never a dead stop: the adapter slides the body along
    // the surface and the speed it actually achieved becomes the speed it
    // carries, so a brushed wall costs momentum instead of snapping the gait.
    if (result.blockedX || result.blockedY) {
      motion.speed = Math.min(motion.speed, Math.hypot(target.x - fromX, target.y - fromY) / dt);
      if (motion.replanRemaining <= 0) beginAvoid(target, motion, world, true);
    }
  }
  if (motion.resumeSpeed > 0) {
    motion.stuckElapsed += dt;
    if (motion.stuckElapsed >= 1) {
      if (Math.hypot(target.x - motion.stuckX, target.y - motion.stuckY) < 5)
        beginAvoid(target, motion, world, true);
      motion.stuckElapsed = 0;
      motion.stuckX = target.x;
      motion.stuckY = target.y;
    }
  } else {
    motion.stuckElapsed = 0;
    motion.stuckX = target.x;
    motion.stuckY = target.y;
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
    for (const target of world.targets) {
      const motion = target.motion ??= targetMotion(seedForId(target.id), target.x, target.y);
      // Targets integrate on the same 60 Hz locomotion clock regardless of
      // render cadence. This makes a 120 Hz caller consume two half samples as
      // one walking step instead of taking a meaningfully different route.
      motion.stepRemainder = (motion.stepRemainder ?? 0) + tick;
      if (motion.stepRemainder + 1e-12 >= 1 / 60) {
        const targetTick = motion.stepRemainder;
        motion.stepRemainder = 0;
        stepTarget(target, targetTick, physics, world);
      }
    }
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
