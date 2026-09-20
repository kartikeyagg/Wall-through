/** Hardware-neutral 60 GHz moving-body radar puck model. */
export interface MmWaveRadarConfig {
  maxRangeMetres?: number; minRangeMetres?: number; fovRad?: number;
  rangeSigmaMetres?: number; azimuthSigmaRad?: number;
  /** Metres per second. */ dopplerSigma?: number;
  wallLossDb?: number; maxWalls?: number;
  /** Default: 62 dB. */ snrAtOneMetreDb?: number;
  detectionSnrDb?: number;
  /** Metres per second. */ minSpeed?: number;
  unitsPerMetre?: number;
}
export interface MmWaveRadar extends Required<MmWaveRadarConfig> {
  /** Maximum and minimum ranges, converted to world units. */
  maxRange: number; minRange: number;
  /** One-sigma radial error, converted to world units. */
  rangeSigma: number;
}
export interface GroundPoint { x: number; y: number; }
export interface SensorPose extends GroundPoint { id: string; angle: number; }
export interface RadarSubject extends GroundPoint { id: string; vx: number; vy: number; }
export interface Wall { x: number; y: number; w: number; h: number; }
export interface RadarReturn {
  sensorId: string; timestamp: number; range: number; azimuth: number;
  /** Metres per second, positive away from the sensor. */ doppler: number;
  snrDb: number; wallsCrossed: number; rangeSigma: number; crossSigma: number; confidence: number;
}
/** Create a puck specification. Input distances are metres; derived values are world units. */
export function createMmWaveRadar(config?: MmWaveRadarConfig): MmWaveRadar;
/** Tangential one-sigma error in world units at a given world-unit range. */
export function crossRangeSigma(range: number, radar: MmWaveRadar): number;
/** Return SNR after two-way range loss and drywall attenuation. */
export function returnStrengthDb(range: number, wallsCrossed: number, radar: MmWaveRadar): number;
/** Convert a radar polar measurement into a world-ground-plane point. */
export function polarToWorld(measurement: Pick<RadarReturn, "range" | "azimuth">, sensorPose: SensorPose): GroundPoint;
/** Convert a world-ground-plane point into radar polar coordinates. */
export function worldToPolar(point: GroundPoint, sensorPose: SensorPose): Pick<RadarReturn, "range" | "azimuth">;
/** Sample unlabelled moving-body returns; the non-enumerable test-only truthId must not be consumed. */
export function sampleReturns(radar: MmWaveRadar, sensor: SensorPose, subjects: RadarSubject[], walls: Wall[], options?: { timestamp?: number; random?: () => number }): RadarReturn[];
export interface RadarTrack {
  trackId: string; sensorId: string; position: GroundPoint; velocity: GroundPoint;
  speed: number; heading: number; sigma: number; confidence: number; hits: number; misses: number;
  confirmed: boolean; timestamp: number; createdAt: number; coasting: boolean; wallsCrossed: number;
}
export interface MmWaveTrackerOptions {
  processNoise?: number; gateChiSq?: number; staleAfterMs?: number; confirmAfterHits?: number; radar?: MmWaveRadar;
}
/** Polar EKF with greedy smallest-normalised-innovation association. */
export class MmWaveTracker {
  constructor(options?: MmWaveTrackerOptions);
  update(returns: RadarReturn[], timestamp: number, sensorPose: SensorPose): RadarTrack[];
  snapshot(): RadarTrack[];
  reset(): void;
}
/** One-sigma major-axis uncertainty for the x/y position portion of a state covariance. */
export function positionSigma(covariance: number[][]): number;
/** Associate transient radar IDs with stable stereo IDs, using stereo x/z as the ground plane. */
export function associateRadarTracks(radarTracks: RadarTrack[], visionTracks: { trackId: string; position: { x: number; z: number } }[], options?: { gate?: number }): Map<string, string>;
/** Convert confirmed radar tracks into MotionTracker-compatible x/y/z reports. */
export function radarMeasurements(radarTracks: RadarTrack[], association: Map<string, string>, options?: { includeTentative?: boolean }): Array<{ trackId: string; position: { x: number; y: number; z: number }; sigma: number; timestamp: number; officerId: string; confidence: number; source: "mmwave" }>;
export interface SensorFix { position: GroundPoint; sigma: number; officerId?: string; timestamp?: number; }
export interface SensorEstimate { sensorId: string; position: GroundPoint; sigma: number; fixes: number; observers: string[]; located: boolean; timestamp: number; lastFixAt?: number; }
/** Inverse-variance 2D puck geolocation with random-walk covariance aging. */
export class SensorLocalizer {
  constructor(options?: { locatedSigma?: number; driftSigma?: number; maxFixes?: number });
  update(sensorId: string, fixes: SensorFix[], timestamp: number): SensorEstimate | undefined;
  estimateFor(sensorId: string): SensorEstimate | undefined;
  forget(sensorId: string): boolean;
  reset(): void;
}
