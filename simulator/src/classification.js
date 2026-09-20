const DEFAULTS = {
  graceMs: 6000,
  sightGraceMs: 1200,
  maxEntries: 256,
};

export const THREAT_STATES = ["hostile", "cleared"];
export const DEFAULT_STATE = "hostile";

const finite = (value) => Number.isFinite(value);
const validChange = (trackId, timestamp) => typeof trackId === "string" && finite(timestamp);

function copyArrayProperties(source, target) {
  for (const key of Reflect.ownKeys(source)) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor && !descriptor.enumerable) Object.defineProperty(target, key, descriptor);
  }
  return target;
}

function truthFor(truth, trackId) {
  if (truth instanceof Map) return truth.has(trackId) ? truth.get(trackId) : undefined;
  if (truth && typeof truth === "object" && Object.prototype.hasOwnProperty.call(truth, trackId)) return truth[trackId];
  return undefined;
}

/** Shared human correction state for threat detections seen by every officer. */
export class ThreatRegistry {
  constructor(options = {}) {
    if (!options || typeof options !== "object") options = {};
    this.graceMs = finite(options.graceMs) ? Math.max(0, options.graceMs) : DEFAULTS.graceMs;
    this.sightGraceMs = finite(options.sightGraceMs) ? Math.max(0, options.sightGraceMs) : DEFAULTS.sightGraceMs;
    this.maxEntries = finite(options.maxEntries) ? Math.max(0, Math.floor(options.maxEntries)) : DEFAULTS.maxEntries;
    this.entries = new Map();
    this.lastSeen = new Map();
    this.lastSight = new Map();
    this.changes = new Map();
    this.sequence = 0;
  }

  clear(trackId, officerId, timestamp, options = {}) {
    if (!validChange(trackId, timestamp)) return null;
    const previous = this.entries.get(trackId);
    const source = options && typeof options === "object" ? options : {};
    const entry = {
      trackId,
      state: "cleared",
      officerId,
      timestamp,
      ...(source.reason !== undefined ? { reason: source.reason } : {}),
      revision: (previous?.revision ?? 0) + 1,
    };
    this.entries.set(trackId, entry);
    this.lastSeen.set(trackId, timestamp);
    this.lastSight.set(trackId, timestamp);
    this.changes.set(trackId, ++this.sequence);
    this.enforceMaxEntries();
    return { ...entry };
  }

  restore(trackId, officerId, timestamp) {
    if (!validChange(trackId, timestamp)) return null;
    const previous = this.entries.get(trackId);
    const entry = {
      trackId,
      state: "hostile",
      ...(previous ? { officerId: previous.officerId, timestamp: previous.timestamp } : { officerId, timestamp }),
      ...(previous?.reason !== undefined ? { reason: previous.reason } : {}),
      restoredBy: officerId,
      restoredAt: timestamp,
      revision: (previous?.revision ?? 0) + 1,
    };
    this.entries.set(trackId, entry);
    this.lastSeen.set(trackId, timestamp);
    this.changes.set(trackId, ++this.sequence);
    this.enforceMaxEntries();
    return { ...entry };
  }

  observeSight(inSightTrackIds, timestamp) {
    if (!finite(timestamp)) return 0;
    const inSight = new Set();
    if (inSightTrackIds && typeof inSightTrackIds[Symbol.iterator] === "function") {
      for (const trackId of inSightTrackIds) if (typeof trackId === "string") inSight.add(trackId);
    }
    for (const trackId of inSight) if (this.entries.has(trackId)) this.lastSight.set(trackId, timestamp);

    let lapsed = 0;
    for (const [trackId, previous] of this.entries) {
      if (previous.state !== "cleared" || inSight.has(trackId) || timestamp - (this.lastSight.get(trackId) ?? timestamp) <= this.sightGraceMs) continue;
      const entry = {
        trackId,
        state: "hostile",
        officerId: previous.officerId,
        timestamp: previous.timestamp,
        ...(previous.reason !== undefined ? { reason: previous.reason } : {}),
        restoredBy: "system",
        restoredAt: timestamp,
        restoredReason: "left sight",
        revision: previous.revision + 1,
      };
      this.entries.set(trackId, entry);
      this.changes.set(trackId, ++this.sequence);
      lapsed += 1;
    }
    return lapsed;
  }

  toggle(trackId, officerId, timestamp, options) {
    return this.isCleared(trackId)
      ? this.restore(trackId, officerId, timestamp)
      : this.clear(trackId, officerId, timestamp, options);
  }

  stateOf(trackId) {
    return this.entries.get(trackId)?.state ?? DEFAULT_STATE;
  }

  entryOf(trackId) {
    const entry = this.entries.get(trackId);
    return entry && { ...entry };
  }

  isCleared(trackId) {
    return this.stateOf(trackId) === "cleared";
  }

  annotate(observations) {
    if (!Array.isArray(observations)) return [];
    const annotated = observations.map((observation) => {
      const entry = this.entries.get(observation?.targetId);
      const threat = entry?.state ?? DEFAULT_STATE;
      return {
        ...observation,
        threat,
        ...(threat === "cleared" ? {
          clearedBy: entry.officerId,
          clearedAt: entry.timestamp,
          ...(entry.reason !== undefined ? { clearedReason: entry.reason } : {}),
        } : {}),
        // Why a flag is back belongs on the observation, not in registry lookups
        // at render time: a consumer showing "cleared by" owes the reader the
        // symmetric "re-flagged by", and a lapse reads differently from an
        // officer's own correction.
        ...(threat === "hostile" && entry?.restoredBy !== undefined ? {
          restoredBy: entry.restoredBy,
          restoredAt: entry.restoredAt,
          ...(entry.restoredReason !== undefined ? { restoredReason: entry.restoredReason } : {}),
        } : {}),
      };
    });
    return copyArrayProperties(observations, annotated);
  }

  hostileOnly(observations) {
    const annotated = this.annotate(observations);
    return copyArrayProperties(annotated, annotated.filter((observation) => observation.threat === "hostile"));
  }

  prune(liveTrackIds, timestamp) {
    if (!finite(timestamp)) return 0;
    const live = new Set();
    if (liveTrackIds && typeof liveTrackIds[Symbol.iterator] === "function") {
      for (const trackId of liveTrackIds) if (typeof trackId === "string") live.add(trackId);
    }
    for (const trackId of live) if (this.entries.has(trackId)) this.lastSeen.set(trackId, timestamp);

    let dropped = 0;
    for (const trackId of this.entries.keys()) {
      if (!live.has(trackId) && timestamp - (this.lastSeen.get(trackId) ?? timestamp) > this.graceMs) {
        this.delete(trackId);
        dropped += 1;
      }
    }
    return dropped + this.enforceMaxEntries();
  }

  stats(observations) {
    if (!Array.isArray(observations)) {
      let cleared = 0;
      for (const entry of this.entries.values()) if (entry.state === "cleared") cleared += 1;
      return { total: this.entries.size, hostile: this.entries.size - cleared, cleared };
    }
    const annotated = this.annotate(observations);
    let cleared = 0;
    for (const observation of annotated) if (observation.threat === "cleared") cleared += 1;
    return { total: annotated.length, hostile: annotated.length - cleared, cleared };
  }

  snapshot() {
    return [...this.entries.values()]
      .sort((left, right) => (right.restoredAt ?? right.timestamp) - (left.restoredAt ?? left.timestamp)
        || (this.changes.get(right.trackId) ?? 0) - (this.changes.get(left.trackId) ?? 0))
      .map((entry) => ({ ...entry }));
  }

  reset() {
    this.entries.clear();
    this.lastSeen.clear();
    this.lastSight.clear();
    this.changes.clear();
    this.sequence = 0;
  }

  delete(trackId) {
    this.entries.delete(trackId);
    this.lastSeen.delete(trackId);
    this.lastSight.delete(trackId);
    this.changes.delete(trackId);
  }

  enforceMaxEntries() {
    let dropped = 0;
    // Capacity evicts least-recently-seen entries; change order breaks equal-time ties.
    while (this.entries.size > this.maxEntries) {
      let oldestId;
      for (const trackId of this.entries.keys()) {
        if (oldestId === undefined) {
          oldestId = trackId;
          continue;
        }
        const seen = this.lastSeen.get(trackId) ?? -Infinity;
        const oldestSeen = this.lastSeen.get(oldestId) ?? -Infinity;
        if (seen < oldestSeen || (seen === oldestSeen && (this.changes.get(trackId) ?? 0) < (this.changes.get(oldestId) ?? 0))) oldestId = trackId;
      }
      this.delete(oldestId);
      dropped += 1;
    }
    return dropped;
  }
}

/** Ground truth is simulation-only and must never enter the detection path. */
export function scoreClearances(observations, truth) {
  const scores = { correctlyCleared: 0, wronglyCleared: 0, bystandersLeftFlagged: 0, correctlyFlagged: 0 };
  for (const observation of Array.isArray(observations) ? observations : []) {
    const hostile = truthFor(truth, observation?.targetId);
    if (hostile === undefined) continue;
    if (observation.threat === "cleared") {
      if (hostile) scores.wronglyCleared += 1;
      else scores.correctlyCleared += 1;
    } else if (hostile) {
      scores.correctlyFlagged += 1;
    } else {
      scores.bystandersLeftFlagged += 1;
    }
  }
  return scores;
}
