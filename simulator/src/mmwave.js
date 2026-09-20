const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value) => Number.isFinite(value);
const finiteOr = (value, fallback) => finite(value) ? value : fallback;
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const defaults = {
  maxRangeMetres: 18,
  minRangeMetres: 0.25,
  fovRad: Math.PI * 4 / 3,
  rangeSigmaMetres: 0.06,
  azimuthSigmaRad: 0.055,
  dopplerSigma: 0.12,
  wallLossDb: 7.5,
  maxWalls: 2,
  snrAtOneMetreDb: 62,
  detectionSnrDb: 12,
  minSpeed: 0.08,
  unitsPerMetre: 24,
};

/** Create a 60 GHz radar puck specification. Configuration distances are metres. */
export function createMmWaveRadar(config = {}) {
  if (!config || typeof config !== "object") config = {};
  const values = {};
  for (const [key, fallback] of Object.entries(defaults)) values[key] = finiteOr(config[key], fallback);
  values.unitsPerMetre = clamp(values.unitsPerMetre, 1e-6, 1e6);
  values.minRangeMetres = clamp(values.minRangeMetres, 1e-4, 1e5);
  values.maxRangeMetres = clamp(values.maxRangeMetres, values.minRangeMetres, 1e6);
  values.fovRad = clamp(values.fovRad, 1e-6, Math.PI * 2);
  values.rangeSigmaMetres = clamp(values.rangeSigmaMetres, 1e-6, 1e4);
  values.azimuthSigmaRad = clamp(values.azimuthSigmaRad, 1e-6, Math.PI);
  values.dopplerSigma = clamp(values.dopplerSigma, 1e-6, 1e6);
  values.wallLossDb = clamp(values.wallLossDb, 0, 1e6);
  values.maxWalls = clamp(Math.floor(values.maxWalls), 0, 1000);
  values.minSpeed = clamp(values.minSpeed, 0, 1e6);
  return {
    ...values,
    maxRange: values.maxRangeMetres * values.unitsPerMetre,
    minRange: values.minRangeMetres * values.unitsPerMetre,
    rangeSigma: values.rangeSigmaMetres * values.unitsPerMetre,
  };
}

/** Tangential one-sigma error in world units at a given world-unit range. */
export function crossRangeSigma(range, radar) {
  return Math.max(0, finiteOr(range, 0)) * radar.azimuthSigmaRad;
}

/** Return SNR after two-way range loss and drywall attenuation. */
export function returnStrengthDb(range, wallsCrossed, radar) {
  const metres = Math.max(1, finiteOr(range, 0) / radar.unitsPerMetre);
  return radar.snrAtOneMetreDb - 40 * Math.log10(metres)
    - Math.max(0, finiteOr(wallsCrossed, 0)) * radar.wallLossDb;
}

/** Inclusive segment/rectangle intersections, counted once per wall. */
export function wallsBetween(start, end, walls) {
  if (!start || !end || !Array.isArray(walls)) return 0;
  return walls.reduce((count, wall) => {
    if (!wall || !finite(wall.x) || !finite(wall.y) || !finite(wall.w) || !finite(wall.h)) return count;
    let entry = 0;
    let exit = 1;
    for (const [axis, minimum, maximum] of [["x", wall.x, wall.x + wall.w], ["y", wall.y, wall.y + wall.h]]) {
      const delta = end[axis] - start[axis];
      if (Math.abs(delta) < 1e-10) {
        if (start[axis] < minimum || start[axis] > maximum) return count;
      } else {
        const a = (minimum - start[axis]) / delta;
        const b = (maximum - start[axis]) / delta;
        entry = Math.max(entry, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
        if (entry > exit) return count;
      }
    }
    return count + 1;
  }, 0);
}

/** Convert a radar polar measurement into a world-ground-plane point. */
export function polarToWorld(measurement, sensorPose) {
  const angle = sensorPose.angle + measurement.azimuth;
  return {
    x: sensorPose.x + measurement.range * Math.cos(angle),
    y: sensorPose.y + measurement.range * Math.sin(angle),
  };
}

/** Convert a world-ground-plane point into radar polar coordinates. */
export function worldToPolar(point, sensorPose) {
  const dx = point.x - sensorPose.x;
  const dy = point.y - sensorPose.y;
  return { range: Math.hypot(dx, dy), azimuth: angleDifference(Math.atan2(dy, dx), sensorPose.angle) };
}

/**
 * Sample unlabelled moving-body radar returns. `truthId` is intentionally
 * non-enumerable for test-only association checks; consumers must never read it.
 */
export function sampleReturns(radar, sensor, subjects, walls, options = {}) {
  if (!radar || !sensor || !Array.isArray(subjects)) return [];
  const random = typeof options.random === "function" ? options.random : null;
  const timestamp = finite(options.timestamp) ? options.timestamp : 0;
  const returns = [];
  for (const subject of subjects) {
    if (!subject || !finite(subject.x) || !finite(subject.y)) continue;
    const truth = worldToPolar(subject, sensor);
    const crossed = wallsBetween(sensor, subject, walls);
    const vx = finiteOr(subject.vx, 0);
    const vy = finiteOr(subject.vy, 0);
    const bearing = sensor.angle + truth.azimuth;
    const radial = vx * Math.cos(bearing) + vy * Math.sin(bearing);
    const radialMetresPerSecond = radial / radar.unitsPerMetre;
    const snrDb = returnStrengthDb(truth.range, crossed, radar);
    if (truth.range < radar.minRange || truth.range > radar.maxRange
      || Math.abs(truth.azimuth) > radar.fovRad / 2 + 1e-10 || crossed > radar.maxWalls
      || snrDb < radar.detectionSnrDb || Math.abs(radialMetresPerSecond) < radar.minSpeed) continue;
    const range = truth.range + (random ? random() * radar.rangeSigma : 0);
    const azimuth = angleDifference(truth.azimuth + (random ? random() * radar.azimuthSigmaRad : 0), 0);
    const doppler = radialMetresPerSecond + (random ? random() * radar.dopplerSigma : 0);
    const margin = Math.max(0, snrDb - radar.detectionSnrDb);
    const confidence = clamp((1 - Math.exp(-margin / 10)) * 0.9 ** crossed, 0, 1);
    const report = {
      sensorId: sensor.id,
      timestamp,
      range,
      azimuth,
      doppler,
      snrDb,
      wallsCrossed: crossed,
      rangeSigma: radar.rangeSigma,
      crossSigma: crossRangeSigma(Math.max(0, range), radar),
      confidence,
    };
    Object.defineProperty(report, "truthId", { value: subject.id, enumerable: false });
    returns.push(report);
  }
  return returns.sort((a, b) => a.range - b.range);
}

const zeros = () => Array.from({ length: 4 }, () => Array(4).fill(0));
function multiply(left, right) {
  return left.map((row) => right[0].map((_, column) => row.reduce((sum, value, index) => sum + value * right[index][column], 0)));
}
function transpose(matrix) { return matrix[0].map((_, column) => matrix.map((row) => row[column])); }
function inverse3(matrix) {
  const [a, b, c] = matrix[0]; const [d, e, f] = matrix[1]; const [g, h, i] = matrix[2];
  const A = e * i - f * h; const B = c * h - b * i; const C = b * f - c * e;
  const D = f * g - d * i; const E = a * i - c * g; const F = c * d - a * f;
  const G = d * h - e * g; const H = b * g - a * h; const I = a * e - b * d;
  const determinant = a * A + b * D + c * G;
  if (!finite(determinant) || Math.abs(determinant) < 1e-16) return null;
  return [[A, B, C], [D, E, F], [G, H, I]].map((row) => row.map((value) => value / determinant));
}
const vectorMatrix = (matrix, vector) => matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));

/** One-sigma major-axis uncertainty of a 2D position covariance block. */
export function positionSigma(covariance) {
  const a = Math.max(0, covariance[0][0]);
  const b = (covariance[0][2] + covariance[2][0]) / 2;
  const d = Math.max(0, covariance[2][2]);
  return Math.sqrt(Math.max(0, (a + d + Math.hypot(a - d, 2 * b)) / 2));
}

function measurementModel(state, sensorPose, radar) {
  const dx = state[0] - sensorPose.x;
  const dy = state[2] - sensorPose.y;
  const range = Math.max(1e-6, Math.hypot(dx, dy));
  const rangeSquared = range ** 2;
  const dot = dx * state[1] + dy * state[3];
  const rate = dot / range / radar.unitsPerMetre;
  return {
    value: [range, angleDifference(Math.atan2(dy, dx), sensorPose.angle), rate],
    h: [
      [dx / range, 0, dy / range, 0],
      [-dy / rangeSquared, 0, dx / rangeSquared, 0],
      [(state[1] / range - dot * dx / range ** 3) / radar.unitsPerMetre, dx / range / radar.unitsPerMetre, (state[3] / range - dot * dy / range ** 3) / radar.unitsPerMetre, dy / range / radar.unitsPerMetre],
    ],
  };
}

function measurementNoise(report, radar) {
  const rangeSigma = Math.max(1e-6, finiteOr(report.rangeSigma, radar.rangeSigma));
  const range = Math.max(1e-6, finiteOr(report.range, radar.minRange));
  const azimuthSigma = Math.max(1e-6, finiteOr(report.crossSigma, crossRangeSigma(range, radar)) / range);
  return [rangeSigma ** 2, azimuthSigma ** 2, radar.dopplerSigma ** 2];
}

/** Polar-measurement extended Kalman tracker. Association is greedy smallest-NIS. */
export class MmWaveTracker {
  constructor(options = {}) {
    if (!options || typeof options !== "object") options = {};
    this.processNoise = Math.max(1e-6, finiteOr(options.processNoise, 55));
    this.gateChiSq = Math.max(0, finiteOr(options.gateChiSq, 11.8));
    this.staleAfterMs = Math.max(0, finiteOr(options.staleAfterMs, 900));
    this.confirmAfterHits = Math.max(1, Math.floor(finiteOr(options.confirmAfterHits, 2)));
    this.radar = options.radar ?? createMmWaveRadar();
    this.tracks = new Map();
    this.nextId = 1;
  }

  predict(track, timestamp) {
    const dt = Math.max(0, timestamp - track.lastUpdate) / 1000;
    if (dt) {
      const f = [[1, dt, 0, 0], [0, 1, 0, 0], [0, 0, 1, dt], [0, 0, 0, 1]];
      const q = this.processNoise ** 2;
      const q00 = q * dt ** 4 / 4; const q01 = q * dt ** 3 / 2; const q11 = q * dt ** 2;
      const process = [[q00, q01, 0, 0], [q01, q11, 0, 0], [0, 0, q00, q01], [0, 0, q01, q11]];
      track.state = vectorMatrix(f, track.state);
      const predicted = multiply(multiply(f, track.covariance), transpose(f));
      track.covariance = predicted.map((row, i) => row.map((value, j) => value + process[i][j]));
    }
    track.lastUpdate = timestamp;
  }

  innovation(track, report, sensorPose) {
    const model = measurementModel(track.state, sensorPose, this.radar);
    const residual = [report.range - model.value[0], angleDifference(report.azimuth, model.value[1]), report.doppler - model.value[2]];
    const hp = multiply(model.h, track.covariance);
    const s = multiply(hp, transpose(model.h));
    const noise = measurementNoise(report, this.radar);
    for (let i = 0; i < 3; i++) s[i][i] += noise[i];
    const inverse = inverse3(s);
    if (!inverse) return null;
    const nis = residual.reduce((sum, value, i) => sum + value * vectorMatrix(inverse, residual)[i], 0);
    return { model, residual, inverse, nis };
  }

  correct(track, report, sensorPose, innovation) {
    const data = innovation ?? this.innovation(track, report, sensorPose);
    if (!data) return;
    const gain = multiply(multiply(track.covariance, transpose(data.model.h)), data.inverse);
    const adjustment = vectorMatrix(gain, data.residual);
    track.state = track.state.map((value, index) => value + adjustment[index]);
    // Joseph form keeps the full covariance symmetric and positive under noisy updates.
    const identityMinusKH = zeros().map((row, i) => row.map((_, j) => (i === j ? 1 : 0) - gain[i][0] * data.model.h[0][j] - gain[i][1] * data.model.h[1][j] - gain[i][2] * data.model.h[2][j]));
    const first = multiply(multiply(identityMinusKH, track.covariance), transpose(identityMinusKH));
    const noise = measurementNoise(report, this.radar);
    const added = zeros();
    for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
      for (let measurement = 0; measurement < 3; measurement++) added[row][column] += gain[row][measurement] * noise[measurement] * gain[column][measurement];
    }
    track.covariance = first.map((row, i) => row.map((value, j) => value + added[i][j]));
    track.hits += 1; track.misses = 0; track.coasting = false;
    track.timestamp = report.timestamp; track.confidence = report.confidence; track.wallsCrossed = report.wallsCrossed;
  }

  spawn(report, timestamp, sensorPose) {
    const point = polarToWorld(report, sensorPose);
    const direction = sensorPose.angle + report.azimuth;
    const cosine = Math.cos(direction); const sine = Math.sin(direction);
    const radialVariance = Math.max(1e-6, finiteOr(report.rangeSigma, this.radar.rangeSigma) ** 2);
    const tangentVariance = Math.max(1e-6, finiteOr(report.crossSigma, crossRangeSigma(report.range, this.radar)) ** 2);
    const velocityVariance = (10 * this.processNoise + 1) ** 2;
    const covariance = zeros();
    covariance[0][0] = cosine ** 2 * radialVariance + sine ** 2 * tangentVariance;
    covariance[0][2] = covariance[2][0] = cosine * sine * (radialVariance - tangentVariance);
    covariance[2][2] = sine ** 2 * radialVariance + cosine ** 2 * tangentVariance;
    covariance[1][1] = covariance[3][3] = velocityVariance;
    const sensorId = typeof report.sensorId === "string" ? report.sensorId : "sensor";
    return {
      trackId: `${sensorId}-R${this.nextId++}`,
      sensorId,
      state: [point.x, report.doppler * cosine, point.y, report.doppler * sine], covariance,
      createdAt: timestamp, lastUpdate: timestamp, timestamp: report.timestamp,
      confidence: finiteOr(report.confidence, 0), hits: 1, misses: 0, coasting: false,
      wallsCrossed: finiteOr(report.wallsCrossed, 0),
    };
  }

  derive(track) {
    track.position = { x: track.state[0], y: track.state[2] };
    track.velocity = { x: track.state[1], y: track.state[3] };
    track.speed = Math.hypot(track.state[1], track.state[3]);
    track.heading = Math.atan2(track.state[3], track.state[1]);
    track.sigma = positionSigma(track.covariance);
    track.confirmed = track.hits >= this.confirmAfterHits;
  }

  update(returns, timestamp, sensorPose) {
    if (!finite(timestamp) || !sensorPose || !finite(sensorPose.x) || !finite(sensorPose.y) || !finite(sensorPose.angle)) return this.snapshot();
    const reports = (Array.isArray(returns) ? returns : []).filter((report) => report && finite(report.range) && finite(report.azimuth) && finite(report.doppler));
    for (const track of this.tracks.values()) this.predict(track, timestamp);
    const candidates = [];
    for (const [trackId, track] of this.tracks) for (let index = 0; index < reports.length; index++) {
      const data = this.innovation(track, reports[index], sensorPose);
      if (data && finite(data.nis) && data.nis <= this.gateChiSq) candidates.push({ trackId, index, data });
    }
    candidates.sort((a, b) => a.data.nis - b.data.nis);
    const claimedTracks = new Set(); const claimedReports = new Set();
    for (const candidate of candidates) {
      if (claimedTracks.has(candidate.trackId) || claimedReports.has(candidate.index)) continue;
      const track = this.tracks.get(candidate.trackId);
      this.correct(track, reports[candidate.index], sensorPose, candidate.data);
      claimedTracks.add(candidate.trackId); claimedReports.add(candidate.index);
    }
    for (const [trackId, track] of this.tracks) if (!claimedTracks.has(trackId)) {
      track.misses += 1; track.coasting = true;
      track.confidence *= Math.max(0, 1 - (timestamp - track.timestamp) / this.staleAfterMs);
    }
    for (let index = 0; index < reports.length; index++) if (!claimedReports.has(index)) {
      const track = this.spawn(reports[index], timestamp, sensorPose); this.tracks.set(track.trackId, track);
    }
    for (const [trackId, track] of this.tracks) if (timestamp - track.timestamp > this.staleAfterMs) this.tracks.delete(trackId);
    for (const track of this.tracks.values()) this.derive(track);
    return this.snapshot();
  }

  snapshot() {
    return [...this.tracks.values()].map((track) => ({
      trackId: track.trackId, sensorId: track.sensorId, position: { ...track.position }, velocity: { ...track.velocity },
      speed: track.speed, heading: track.heading, sigma: track.sigma, confidence: track.confidence,
      hits: track.hits, misses: track.misses, confirmed: track.confirmed, timestamp: track.timestamp,
      createdAt: track.createdAt, coasting: track.coasting, wallsCrossed: track.wallsCrossed,
    }));
  }

  reset() { this.tracks.clear(); this.nextId = 1; }
}

/** Greedily associate radar contacts to stable stereo IDs by ground-plane distance. */
export function associateRadarTracks(radarTracks, visionTracks, options = {}) {
  const candidates = [];
  for (const radar of Array.isArray(radarTracks) ? radarTracks : []) for (const vision of Array.isArray(visionTracks) ? visionTracks : []) {
    if (!radar?.position || !vision?.position || typeof radar.trackId !== "string" || typeof vision.trackId !== "string") continue;
    const distance = Math.hypot(radar.position.x - vision.position.x, radar.position.y - vision.position.z);
    const gate = finite(options.gate) ? options.gate : Math.max(18, 3 * finiteOr(radar.sigma, 0));
    if (distance <= gate) candidates.push({ radar, vision, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const association = new Map(); const claimedVision = new Set();
  for (const candidate of candidates) if (!association.has(candidate.radar.trackId) && !claimedVision.has(candidate.vision.trackId)) {
    association.set(candidate.radar.trackId, candidate.vision.trackId); claimedVision.add(candidate.vision.trackId);
  }
  return association;
}

/** Convert radar tracks to MotionTracker reports; radar ground y maps to vision z. */
export function radarMeasurements(radarTracks, association, options = {}) {
  const links = association instanceof Map ? association : new Map();
  return (Array.isArray(radarTracks) ? radarTracks : []).flatMap((track) => {
    if (!track || (!options.includeTentative && !track.confirmed)) return [];
    return [{ trackId: links.get(track.trackId) ?? track.trackId, position: { x: track.position.x, y: 0, z: track.position.y }, sigma: track.sigma, timestamp: track.timestamp, officerId: track.sensorId, confidence: track.confidence, source: "mmwave" }];
  });
}

/** Inverse-variance geolocation of thrown radar pucks, with random-walk aging. */
export class SensorLocalizer {
  constructor(options = {}) {
    if (!options || typeof options !== "object") options = {};
    this.locatedSigma = Math.max(1e-6, finiteOr(options.locatedSigma, 14));
    this.driftSigma = Math.max(0, finiteOr(options.driftSigma, 0.6));
    this.maxFixes = Math.max(1, Math.floor(finiteOr(options.maxFixes, 200)));
    this.sensors = new Map();
  }

  update(sensorId, fixes, timestamp) {
    if (typeof sensorId !== "string" || !finite(timestamp)) return undefined;
    let estimate = this.sensors.get(sensorId);
    if (!estimate) estimate = { sensorId, position: { x: 0, y: 0 }, variance: Infinity, fixes: 0, observers: new Set(), timestamp, lastFixAt: undefined };
    const elapsed = Math.max(0, timestamp - estimate.timestamp) / 1000;
    if (finite(estimate.variance)) estimate.variance += (this.driftSigma * elapsed) ** 2;
    const usable = (Array.isArray(fixes) ? fixes : []).filter((fix) => fix?.position && finite(fix.position.x) && finite(fix.position.y) && finite(fix.sigma) && fix.sigma > 0);
    for (const fix of usable) {
      const variance = fix.sigma ** 2;
      if (!finite(estimate.variance)) {
        estimate.position = { x: fix.position.x, y: fix.position.y }; estimate.variance = variance;
      } else {
        const oldWeight = 1 / estimate.variance; const newWeight = 1 / variance;
        estimate.position = { x: (estimate.position.x * oldWeight + fix.position.x * newWeight) / (oldWeight + newWeight), y: (estimate.position.y * oldWeight + fix.position.y * newWeight) / (oldWeight + newWeight) };
        estimate.variance = 1 / (oldWeight + newWeight);
      }
      estimate.fixes = Math.min(this.maxFixes, estimate.fixes + 1);
      if (fix.officerId != null) estimate.observers.add(fix.officerId);
      estimate.lastFixAt = finite(fix.timestamp) ? fix.timestamp : timestamp;
    }
    estimate.timestamp = timestamp; this.sensors.set(sensorId, estimate);
    return this.estimateFor(sensorId);
  }

  estimateFor(sensorId) {
    const estimate = this.sensors.get(sensorId);
    if (!estimate) return undefined;
    const sigma = Math.sqrt(estimate.variance);
    return { sensorId: estimate.sensorId, position: { ...estimate.position }, sigma, fixes: estimate.fixes, observers: [...estimate.observers].sort(), located: sigma <= this.locatedSigma && estimate.fixes > 0, timestamp: estimate.timestamp, lastFixAt: estimate.lastFixAt };
  }

  forget(sensorId) { return this.sensors.delete(sensorId); }
  reset() { this.sensors.clear(); }
}
