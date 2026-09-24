/** Assign anonymous track keys by spatial gating, without reading simulator identities. */
export class TrackAssociator {
  constructor({ gateChiSq = 16, maxGapMs = 1250 } = {}) {
    this.gateChiSq = gateChiSq;
    this.maxGapMs = maxGapMs;
    this.nextId = 1;
    this.tracks = new Map();
  }

  assign(detections, timestamp) {
    for (const [id, track] of this.tracks) if (timestamp - track.timestamp > this.maxGapMs) this.tracks.delete(id);
    const groups = new Map();
    const assigned = new Set();
    const candidates = [];
    for (let index = 0; index < detections.length; index += 1) {
      const detection = detections[index];
      for (const [id, track] of this.tracks) {
        const dt = Math.max(0, timestamp - track.timestamp) / 1000;
        const dx = detection.position.x - (track.position.x + track.velocity.x * dt);
        const dz = detection.position.z - (track.position.z + track.velocity.z * dt);
        const sigma = Math.max(4, Math.hypot(detection.sigma, track.sigma), 30 * dt);
        const score = (dx * dx + dz * dz) / (sigma * sigma);
        if (score <= this.gateChiSq) candidates.push({ index, id, score });
      }
    }
    candidates.sort((a, b) => a.score - b.score || a.index - b.index || a.id.localeCompare(b.id));
    const compatible = (detection, group) => group.every((item) => {
      if (item.officerId === detection.officerId) return false;
      const dx = detection.position.x - item.position.x;
      const dz = detection.position.z - item.position.z;
      const sigma = Math.max(4, Math.hypot(detection.sigma, item.sigma));
      return (dx * dx + dz * dz) / (sigma * sigma) <= this.gateChiSq;
    });
    const claim = (index, id) => {
      const detection = detections[index];
      const group = groups.get(id) ?? [];
      group.push(detection);
      groups.set(id, group);
      assigned.add(index);
      detection.trackId = id;
    };
    for (const candidate of candidates) {
      if (assigned.has(candidate.index)) continue;
      if (!compatible(detections[candidate.index], groups.get(candidate.id) ?? [])) continue;
      claim(candidate.index, candidate.id);
    }
    // A first sighting can come from several cameras. Group only spatially
    // compatible reports from different officers into one new track.
    for (let index = 0; index < detections.length; index += 1) {
      if (assigned.has(index)) continue;
      const detection = detections[index];
      let best = null, bestScore = Infinity;
      for (const [id, group] of groups) {
        if (this.tracks.has(id) || !compatible(detection, group)) continue;
        const anchor = group[0];
        const dx = detection.position.x - anchor.position.x;
        const dz = detection.position.z - anchor.position.z;
        const sigma = Math.max(4, Math.hypot(detection.sigma, anchor.sigma));
        const score = (dx * dx + dz * dz) / (sigma * sigma);
        if (score <= this.gateChiSq && score < bestScore) { best = id; bestScore = score; }
      }
      claim(index, best ?? `A${this.nextId++}`);
    }
    for (const [id, group] of groups) {
      const position = {
        x: group.reduce((sum, item) => sum + item.position.x, 0) / group.length,
        z: group.reduce((sum, item) => sum + item.position.z, 0) / group.length,
      };
      const previous = this.tracks.get(id);
      const dt = previous ? (timestamp - previous.timestamp) / 1000 : 0;
      const rawVelocity = dt > 0 ? { x: (position.x - previous.position.x) / dt,
        z: (position.z - previous.position.z) / dt } : previous?.velocity ?? { x: 0, z: 0 };
      const rawSpeed = Math.hypot(rawVelocity.x, rawVelocity.z);
      const speedScale = rawSpeed > 150 ? 150 / rawSpeed : 1;
      const velocity = previous && dt > 0 ? {
        x: previous.velocity.x * 0.6 + rawVelocity.x * speedScale * 0.4,
        z: previous.velocity.z * 0.6 + rawVelocity.z * speedScale * 0.4,
      } : rawVelocity;
      this.tracks.set(id, { position,
      velocity,
      sigma: group.reduce((sum, item) => sum + item.sigma, 0) / group.length, timestamp });
    }
    return detections;
  }

  reset() {
    this.tracks.clear();
    this.nextId = 1;
  }
}
