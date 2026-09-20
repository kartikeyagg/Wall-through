export const WIDTH: number;
export const HEIGHT: number;
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
export interface World {
  officers: Agent[];
  targets: Agent[];
  walls: Wall[];
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
export function createWorld(count?: number): World;
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
export function canSee(
  observer: Point & { angle: number },
  target: Point,
  walls: Wall[],
  range?: number,
  fov?: number,
): boolean;
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
