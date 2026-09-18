/**
 * Small, deterministic physics boundary for the simulator.  Bodies are
 * kinematic today, but callers only depend on this adapter's API so a Rapier
 * implementation can replace it without changing input, tracking or UI code.
 */
export const WORLD_WIDTH = 1000;
export const WORLD_DEPTH = 680;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function fits(agent, x, y, walls, others) {
  const radius = agent.radius;
  if (x < radius || y < radius || x > WORLD_WIDTH - radius || y > WORLD_DEPTH - radius)
    return false;
  for (const wall of walls) {
    const nearX = clamp(x, wall.x, wall.x + wall.w);
    const nearY = clamp(y, wall.y, wall.y + wall.h);
    if (Math.hypot(x - nearX, y - nearY) < radius - 1e-8) return false;
  }
  return !others.some(
    (other) => other !== agent && Math.hypot(x - other.x, y - other.y) < radius + other.radius - 1e-8,
  );
}

/** Move a kinematic capsule on the ground plane without tunnelling. */
export function moveKinematic(agent, dx, dy, walls, others = []) {
  if (![dx, dy].every(Number.isFinite)) return { blockedX: false, blockedY: false };
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, agent.radius / 2)));
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

/**
 * Extensible adapter contract.  Static walls and all people are registered as
 * colliders / kinematic bodies; this simple fallback performs their sweeps in
 * JS. A future RapierPhysicsAdapter can expose the same methods.
 */
export class KinematicPhysicsAdapter {
  constructor({ walls = [], bodies = [] } = {}) {
    this.staticWalls = walls;
    this.kinematicBodies = bodies;
  }

  setStaticWalls(walls) {
    this.staticWalls = walls;
  }

  syncKinematicBodies(bodies) {
    this.kinematicBodies = bodies;
  }

  moveKinematic(body, dx, dy) {
    return moveKinematic(body, dx, dy, this.staticWalls, this.kinematicBodies);
  }
}
