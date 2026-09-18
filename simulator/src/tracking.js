const DEFAULTS = {
  processNoise: 60,
  staleAfterMs: 750,
  movingSpeed: 6,
  trailLength: 28,
  trailIntervalMs: 60,
  lookaheadMs: 400,
};
const SIGMA_FLOOR = 1e-3;
const AXES = ["x", "y", "z"];

const finite = (value) => Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const validPosition = (position) => position && AXES.every((axis) => finite(position[axis]));
const validMeasurement = (report) => report && typeof report.trackId === "string" && validPosition(report.position) && finite(report.timestamp);
const measurementSigma = (report) => finite(report.sigma) && report.sigma > 0 ? Math.max(report.sigma, SIGMA_FLOOR) : SIGMA_FLOOR;
const measurementConfidence = (report) => finite(report.confidence) ? clamp(report.confidence, 0, 1) : 0;

/** Inverse-variance fusion for reports produced in the same tracker update. */
export function fuseMeasurements(reports) {
  const usable = reports.filter(validMeasurement);
  if (!usable.length) throw new TypeError("fuseMeasurements requires a finite measurement");

  let totalWeight = 0;
  const position = { x: 0, y: 0, z: 0 };
  let combinedMiss = 1;
  let latest = usable[0];
  let mostConfident = usable[0];
  for (const report of usable) {
    const weight = 1 / measurementSigma(report) ** 2;
    totalWeight += weight;
    for (const axis of AXES) position[axis] += report.position[axis] * weight;
    const confidence = measurementConfidence(report);
    combinedMiss *= 1 - confidence;
    if (report.timestamp > latest.timestamp) latest = report;
    if (confidence > measurementConfidence(mostConfident)) mostConfident = report;
  }
  for (const axis of AXES) position[axis] /= totalWeight;
  return {
    trackId: usable[0].trackId,
    position,
    sigma: 1 / Math.sqrt(totalWeight),
    timestamp: latest.timestamp,
    officerId: mostConfident.officerId,
    confidence: clamp(1 - combinedMiss, 0, 1),
    outline: mostConfident.outline,
  };
}

function makeAxis(position, sigma, processNoise) {
  return { position, velocity: 0, p00: sigma ** 2, p01: 0, p10: 0, p11: (10 * processNoise + 1) ** 2 };
}

function predictAxis(axis, dt, processNoise) {
  if (!(dt > 0)) return;
  const { p00, p01, p10, p11 } = axis;
  const q = processNoise ** 2;
  axis.position += axis.velocity * dt;
  axis.p00 = p00 + dt * (p01 + p10) + dt * dt * p11 + q * dt ** 4 / 4;
  axis.p01 = p01 + dt * p11 + q * dt ** 3 / 2;
  axis.p10 = p10 + dt * p11 + q * dt ** 3 / 2;
  axis.p11 = p11 + q * dt ** 2;
}

function correctAxis(axis, measurement, sigma) {
  const old00 = axis.p00;
  const old01 = axis.p01;
  const old10 = axis.p10;
  const old11 = axis.p11;
  const s = old00 + sigma ** 2;
  if (!(s > 0) || !finite(s)) return;
  const k0 = old00 / s;
  const k1 = old10 / s;
  const innovation = measurement - axis.position;
  axis.position += k0 * innovation;
  axis.velocity += k1 * innovation;
  axis.p00 = (1 - k0) * old00;
  axis.p01 = (1 - k0) * old01;
  axis.p10 = old10 - k1 * old00;
  axis.p11 = old11 - k1 * old01;
}

export class MotionTracker {
  constructor(options = {}) {
    for (const [key, value] of Object.entries(DEFAULTS)) this[key] = finite(options[key]) ? options[key] : value;
    this.trailLength = Math.max(0, Math.floor(this.trailLength));
    this.tracks = new Map();
  }

  update(measurements, timestamp) {
    if (!finite(timestamp)) return this.snapshot();
    const grouped = new Map();
    for (const report of Array.isArray(measurements) ? measurements : []) {
      if (!validMeasurement(report)) continue;
      const group = grouped.get(report.trackId) ?? [];
      group.push(report);
      grouped.set(report.trackId, group);
    }

    for (const track of this.tracks.values()) {
      const elapsed = Math.max(0, timestamp - track.lastUpdate);
      for (const axis of AXES) predictAxis(track.axes[axis], elapsed / 1000, this.processNoise);
      track.lastUpdate = timestamp;
      const reports = grouped.get(track.trackId);
      if (reports) {
        const fused = fuseMeasurements(reports);
        const sigma = measurementSigma(fused);
        for (const axis of AXES) correctAxis(track.axes[axis], fused.position[axis], sigma);
        track.timestamp = fused.timestamp;
        track.confidence = fused.confidence;
        track.outline = fused.outline;
        track.observers = [...new Set(reports.map((report) => report.officerId).filter((id) => id != null))].sort();
        track.missedMs = 0;
        track.coasting = false;
        grouped.delete(track.trackId);
      } else {
        track.missedMs += elapsed;
        track.coasting = true;
        track.confidence *= Math.max(0, 1 - elapsed / this.staleAfterMs);
      }
      this.derive(track, timestamp);
    }

    for (const [trackId, reports] of grouped) {
      const fused = fuseMeasurements(reports);
      const sigma = measurementSigma(fused);
      const track = {
        trackId,
        axes: Object.fromEntries(AXES.map((axis) => [axis, makeAxis(fused.position[axis], sigma, this.processNoise)])),
        createdAt: timestamp,
        lastUpdate: timestamp,
        timestamp: fused.timestamp,
        confidence: fused.confidence,
        outline: fused.outline,
        observers: [...new Set(reports.map((report) => report.officerId).filter((id) => id != null))].sort(),
        missedMs: 0,
        coasting: false,
        moving: false,
        aboveCount: 0,
        belowCount: 0,
        trail: [],
        lastTrailTime: undefined,
      };
      this.derive(track, timestamp);
      this.tracks.set(trackId, track);
    }

    for (const [trackId, track] of this.tracks) if (track.missedMs > this.staleAfterMs) this.tracks.delete(trackId);
    return this.snapshot();
  }

  derive(track, timestamp) {
    const position = Object.fromEntries(AXES.map((axis) => [axis, track.axes[axis].position]));
    const velocity = Object.fromEntries(AXES.map((axis) => [axis, track.axes[axis].velocity]));
    track.position = position;
    track.velocity = velocity;
    track.speed = Math.hypot(velocity.x, velocity.z);
    track.heading = Math.atan2(velocity.z, velocity.x);
    track.sigma = Math.sqrt(Math.max(...AXES.map((axis) => Math.max(0, track.axes[axis].p00))));
    if (track.speed > this.movingSpeed) {
      track.aboveCount += 1;
      track.belowCount = 0;
      if (track.aboveCount >= 2) track.moving = true;
    } else if (track.speed < this.movingSpeed * 0.6) {
      track.belowCount += 1;
      track.aboveCount = 0;
      if (track.belowCount >= 2) track.moving = false;
    } else {
      track.aboveCount = 0;
      track.belowCount = 0;
    }
    if (this.trailLength && (track.lastTrailTime === undefined || timestamp - track.lastTrailTime >= this.trailIntervalMs)) {
      track.trail.push({ ...position, t: timestamp });
      if (track.trail.length > this.trailLength) track.trail.shift();
      track.lastTrailTime = timestamp;
    }
    const lookahead = this.lookaheadMs / 1000;
    track.predicted = Object.fromEntries(AXES.map((axis) => [axis, position[axis] + velocity[axis] * lookahead]));
    track.age = Math.max(0, timestamp - track.createdAt);
  }

  snapshot() {
    return [...this.tracks.values()].map((track) => ({
      trackId: track.trackId,
      position: { ...track.position }, velocity: { ...track.velocity }, speed: track.speed, heading: track.heading,
      moving: track.moving, sigma: track.sigma, confidence: track.confidence, timestamp: track.timestamp,
      observers: [...track.observers], outline: track.outline, trail: track.trail.map((point) => ({ ...point })),
      predicted: { ...track.predicted }, missedMs: track.missedMs, age: track.age, coasting: track.coasting,
    }));
  }

  reset() { this.tracks.clear(); }
}
