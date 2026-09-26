import { UNITS_PER_METRE } from "./vision.js";

const distanceSquared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** GOSPA with p=2, alpha=2. Inputs are ground-plane positions in world units. */
export function gospa(estimated, truth, cutoff = 10 * UNITS_PER_METRE) {
  const penalty = cutoff ** 2 / 2;
  const memo = new Map();
  const solve = (index, used) => {
    if (index === estimated.length) return (truth.length - used.toString(2).replaceAll("0", "").length) * penalty;
    const key = `${index}:${used}`;
    if (memo.has(key)) return memo.get(key);
    let best = penalty + solve(index + 1, used);
    for (let target = 0; target < truth.length; target += 1) {
      if (used & (1 << target)) continue;
      const cost = Math.min(distanceSquared(estimated[index], truth[target]), cutoff ** 2);
      best = Math.min(best, cost + solve(index + 1, used | (1 << target)));
    }
    memo.set(key, best);
    return best;
  };
  return Math.sqrt(solve(0, 0)) / UNITS_PER_METRE;
}

export class TrialMetrics {
  constructor() {
    this.frames = 0;
    this.gospaSum = 0;
    this.localSquared = 0;
    this.localCount = 0;
    this.overlaySquared = 0;
    this.overlayCount = 0;
    this.ageSum = 0;
    this.ageCount = 0;
    this.wrongClearances = 0;
    this.unclearedBystanders = 0;
    this.bystanders = 0;
    this.truthByTrack = new Map();
  }

  observe(world, localizations, frame, clearanceStates = new Map()) {
    for (const detection of frame.detections ?? []) if (detection.truthId)
      this.truthByTrack.set(detection.trackId, detection.truthId);
    const truth = world.targets.map((target) => ({ x: target.x, y: target.y }));
    const tracks = frame.tracks.map((track) => ({ x: track.position.x, y: track.position.z }));
    this.gospaSum += gospa(tracks, truth);
    this.frames += 1;
    for (const pose of localizations) {
      const officer = world.officers.find((item) => item.id === pose.officerId);
      if (!officer) continue;
      this.localSquared += distanceSquared({ x: pose.position.x, y: pose.position.z }, officer);
      this.localCount += 1;
    }
    for (const skeleton of frame.skeletons) {
      const target = world.targets.find((item) => item.id === this.truthByTrack.get(skeleton.trackId));
      const joints = skeleton.skeleton.joints.filter((item) => item.visible && ["rAnkle", "lAnkle"].includes(item.name));
      if (!target || !joints.length) continue;
      const centre = { x: joints.reduce((sum, item) => sum + item.x, 0) / joints.length,
        y: joints.reduce((sum, item) => sum + item.z, 0) / joints.length };
      this.overlaySquared += distanceSquared(centre, target);
      this.overlayCount += 1;
    }
    for (const track of frame.tracks) {
      this.ageSum += Math.max(0, world.time * 1000 - track.timestamp);
      this.ageCount += 1;
    }
    const bystanders = world.targets.filter((target) => !target.hostile).length;
    this.bystanders = bystanders;
    for (const target of world.targets) {
      const cleared = [...this.truthByTrack].some(([trackId, truthId]) =>
        truthId === target.id && clearanceStates.get(trackId) === "cleared");
      if (cleared && target.hostile) this.wrongClearances += 1;
      if (!cleared && !target.hostile) this.unclearedBystanders += 1;
    }
  }

  summary() {
    return {
      gospaMeanM: this.frames ? this.gospaSum / this.frames : null,
      localizationRmseM: this.localCount ? Math.sqrt(this.localSquared / this.localCount) / UNITS_PER_METRE : null,
      overlayRegistrationRmseM: this.overlayCount ? Math.sqrt(this.overlaySquared / this.overlayCount) / UNITS_PER_METRE : null,
      dataAgeMeanMs: this.ageCount ? this.ageSum / this.ageCount : null,
      wrongClearanceRate: this.frames ? this.wrongClearances / this.frames : null,
      unclearedBystanderRate: this.frames && this.bystanders ? this.unclearedBystanders / (this.frames * this.bystanders) : null,
      frames: this.frames,
    };
  }
}
