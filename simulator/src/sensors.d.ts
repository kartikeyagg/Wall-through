import type { World } from "./simulation.js";

export interface Pose {
  officerId: string;
  timestamp: number;
  position: { x: number; y: number; z: number };
  orientation: { yaw: number; pitch: number; roll: number };
}

export interface LocalizationEstimate extends Pose {
  sources: { stereo: true; compass: true; imu: boolean };
  fix: { quality: number; landmarks: number; spread: number; sigma: number };
  imu?: { velocity: { x: number; z: number }; yawRate: number };
}

export function toSensorPosition(agent: { x: number; y: number }, height?: number): { x: number; y: number; z: number };
export function createSimulatedPoseProvider(world: World): { source: string; read(timestamp?: number): Pose[] };
export class SelfLocalization {
  constructor(options?: {
    stereoPositionError?: number;
    compassError?: number;
    imuWeight?: number;
    stereoGoodPositionError?: number;
    stereoPoorPositionError?: number;
    landmarkRange?: number;
    landmarkFov?: number;
    landmarkQualityScale?: number;
    lostFixGrowth?: number;
  });
  update(world: World, timestamp?: number, options?: { imuEnabled?: boolean }): LocalizationEstimate[];
  reset(): void;
}
