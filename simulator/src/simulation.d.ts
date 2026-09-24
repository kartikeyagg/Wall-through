export const WIDTH: number;
export const HEIGHT: number;
/** How many pucks the team may have deployed at once. */
export const MAX_SENSORS: number;
export interface Point {
  x: number;
  y: number;
}
export interface Agent extends Point {
  /** Ground-plane depth duplicated for consumers that use x/y/z coordinates. */
  z?: number;
  id: string;
  angle: number;
  radius: number;
}
export interface Wall extends Point {
  w: number;
  h: number;
}
export interface Landmark extends Point {
  id: string;
  kind: "wall-art" | "wall-panel" | "floor-marking" | "fixture";
  /** Centre height above the floor; floor markings use zero. */
  height: number;
  width: number;
  /** Face direction, or zero for a floor marking. */
  normal: Point;
  color: string;
  strength: number;
}
export interface Target extends Agent {
  /** Lab ground truth. Never read by sensors, tracks or anything officer-facing. */
  hostile?: boolean;
  /** Private deterministic locomotion state; callers may ignore it. */
  motion?: TargetMotion;
}
export interface TargetMotion {
  seed: number;
  goalX: number;
  goalY: number;
  /** Current ground speed in world units per second. */
  speed: number;
  desiredSpeed: number;
  phaseRemaining: number;
  scanDirection: number;
  scanAngle?: number | null;
  avoidRemaining: number;
  avoidAngle?: number | null;
  resumeSpeed?: number;
  /** Locally planned course used to route around walls and other bodies. */
  navigationAngle?: number | null;
  replanRemaining?: number;
  /** One-second displacement sample used to recover from an obstruction. */
  stuckElapsed?: number;
  stuckX?: number | null;
  stuckY?: number | null;
  /** Last non-zero steering direction, retained to suppress micro-wagging. */
  turnDirection?: number;
  /** Brief reversal cooldown to keep a walking course visually smooth. */
  turnHoldRemaining?: number;
  /** Accumulates sub-60 Hz caller ticks for fixed-rate locomotion integration. */
  stepRemainder?: number;
}
/** A thrown mmWave puck. Its own position is unknown until stereo fixes it. */
export interface DeployedSensor extends Agent {
  /** Officer who threw it. */
  ownerId: string;
  /** Height above the floor in world units. */
  height: number;
  vx: number;
  vy: number;
  /** Vertical velocity in world units per second. */
  vz: number;
  /** Tumble rate in radians per second while airborne. */
  spin: number;
  state: "flight" | "settled";
  /** Milliseconds. */
  thrownAt: number;
  /** Milliseconds, or null while still airborne. */
  settledAt: number | null;
}
export interface World {
  environment?: "indoor" | "outdoor";
  officers: Agent[];
  targets: Target[];
  walls: Wall[];
  landmarks: Landmark[];
  sensors: DeployedSensor[];
  time: number;
}
export interface Observation extends Point {
  z?: number;
  confidence?: number;
  timestamp?: number;
  targetId: string;
  observers: string[];
}
export type Contact = Observation & { kind: "direct" | "shared" };
export interface VisionOptions {
  range?: number;
  fov?: number;
}
export interface StepOptions {
  autoPatrol?: boolean;
  autoRotate?: boolean;
  /** Automatic scan speed in radians per second, clamped to 0–Math.PI. */
  rotationSpeed?: number;
  selectedId?: string;
  /** World-space horizontal movement, retained for programmatic consumers. */
  moveX?: number;
  /** World-space vertical movement, retained for programmatic consumers. */
  moveY?: number;
  /** Local forward/backward movement; positive values follow the selected officer's heading. */
  moveForward?: number;
  /** Local strafe movement; positive values move to the selected officer's right. */
  moveRight?: number;
  turn?: number;
}
export function createWorld(count?: number, options?: { environment?: "indoor" | "outdoor" }): World;
export function stepWorld(
  world: World,
  dt: number,
  options?: StepOptions,
): World;
export function observe(world: World, options?: VisionOptions): Observation[];
export function visibleTo<T extends Observation>(
  world: World,
  officerId: string,
  observations: T[],
  sharing?: boolean,
): Array<T & { kind: "direct" | "shared" }>;
/** Every live track the officer knows about, regardless of their field of view. */
export function awareOf<T extends Observation>(
  world: World,
  officerId: string,
  observations: T[],
  sharing?: boolean,
): Array<T & { kind: "direct" | "shared" }>;
/**
 * Throw a puck along the officer's heading. Returns the new sensor, or null if
 * the officer is unknown or the team already has `MAX_SENSORS` deployed.
 */
export function throwSensor(
  world: World,
  officerId: string,
  options?: { timestamp?: number; speed?: number; lift?: number },
): DeployedSensor | null;
/** Pick a deployed puck back up; returns it, or null when the id is unknown. */
export function recallSensor(world: World, sensorId: string): DeployedSensor | null;
export function canSee(
  observer: Point & { angle: number },
  target: Point,
  walls: Wall[],
  range?: number,
  fov?: number,
): boolean;
/** Static scenery inside range and view, clear of walls and facing the officer. */
export function visibleLandmarks(
  world: World,
  officer: Agent,
  options?: VisionOptions,
): Landmark[];
export function segmentBlocked(
  start: Point,
  end: Point,
  walls: Wall[],
): boolean;
export function moveAgent(
  agent: Agent,
  dx: number,
  dy: number,
  walls: Wall[],
  others?: Agent[],
): { blockedX: boolean; blockedY: boolean };
