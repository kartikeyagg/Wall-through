/**
 * Shared human-in-the-loop threat corrections. Live tracks default to hostile
 * until an officer clears one, and every officer sees that same correction.
 */
export type ThreatState = "hostile" | "cleared";
export const THREAT_STATES: ThreatState[];
export const DEFAULT_STATE: "hostile";

export interface ThreatRegistryOptions {
  /** Retain a non-live track's clearance for this many milliseconds. */
  graceMs?: number;
  /** Maximum retained correction entries, evicting least recently seen first. */
  maxEntries?: number;
}
export interface ClearanceOptions {
  /** Optional officer-supplied explanation for clearing the track. */
  reason?: string;
}
export interface ThreatEntry {
  trackId: string;
  state: ThreatState;
  /** Officer who made the original clearance, or the restore for a new entry. */
  officerId?: string;
  /** Original clearance timestamp, or restore timestamp for a new hostile entry. */
  timestamp: number;
  reason?: string;
  /** Officer who restored this track to hostile. */
  restoredBy?: string;
  /** Restore timestamp, milliseconds. */
  restoredAt?: number;
  /** Increments whenever this track's registry entry changes. */
  revision: number;
}
export interface ThreatAnnotation {
  threat: ThreatState;
  /** Present only while `threat` is `"cleared"`. */
  clearedBy?: string;
  /** Original clearance timestamp, milliseconds. */
  clearedAt?: number;
  /** Original clearance reason, when supplied. */
  clearedReason?: string;
}
export type ClassifiedObservation<T extends object = { targetId: string }> = T & ThreatAnnotation;
export interface ThreatStats {
  total: number;
  hostile: number;
  cleared: number;
}
export interface ClearanceScore {
  correctlyCleared: number;
  wronglyCleared: number;
  missedHostiles: number;
  correctlyFlagged: number;
}

export class ThreatRegistry {
  constructor(options?: ThreatRegistryOptions);
  readonly graceMs: number;
  readonly maxEntries: number;
  /** Clear a false-positive track for the whole team. */
  clear(trackId: string, officerId: string, timestamp: number, options?: ClearanceOptions): ThreatEntry | null;
  /** Restore a cleared track to the hostile state while retaining its audit entry. */
  restore(trackId: string, officerId: string, timestamp: number): ThreatEntry | null;
  /** Clear a hostile track or restore a cleared one. */
  toggle(trackId: string, officerId: string, timestamp: number, options?: ClearanceOptions): ThreatEntry | null;
  /** Current track state; unknown tracks are hostile. */
  stateOf(trackId: string): ThreatState;
  /** Full current audit entry for a known track. */
  entryOf(trackId: string): ThreatEntry | undefined;
  /** Whether the current shared state is cleared. */
  isCleared(trackId: string): boolean;
  /** Return shallow-copied observations with shared threat state annotations. */
  annotate<T extends object>(observations: T[]): Array<ClassifiedObservation<T>>;
  annotate(observations: unknown): ThreatAnnotation[];
  /** Return annotated observations that remain flagged as hostile. */
  hostileOnly<T extends object>(observations: T[]): Array<ClassifiedObservation<T>>;
  hostileOnly(observations: unknown): ThreatAnnotation[];
  /** Refresh live entries, expire absent entries past the grace period, and enforce capacity. */
  prune(liveTrackIds: Iterable<string>, timestamp: number): number;
  /** Count states in observations, or in the registry itself when omitted. */
  stats(): ThreatStats;
  stats<T extends object>(observations: T[]): ThreatStats;
  /** Current entries, newest change first, for UI audit displays. */
  snapshot(): ThreatEntry[];
  reset(): void;
}
/**
 * Compare annotated states with simulation-only ground truth. Ground truth is
 * deliberately excluded from the detection path.
 */
export function scoreClearances(
  observations: Array<{ targetId?: string; threat?: ThreatState }>,
  truth: Map<string, boolean> | Record<string, boolean>,
): ClearanceScore;
