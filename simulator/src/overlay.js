/*
 * Overlays are paint on the glass, never bodies. They must never re-enter
 * detector input, or rendered skeletons could become false detections.
 */

const DEFAULT_OPTIONS = {
  opacity: 0.35,
  holdMs: 400,
  fadeMs: 600,
  minOpacity: 0.05,
  includeSelf: false,
  sharing: true,
};

const isObject = (value) => value !== null && typeof value === "object";
const finite = (value) => Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function resolvedOptions(base, overrides) {
  const source = isObject(overrides) ? overrides : {};
  const options = { ...base };
  for (const key of ["opacity", "holdMs", "fadeMs", "minOpacity"]) {
    if (finite(source[key])) options[key] = source[key];
  }
  for (const key of ["includeSelf", "sharing"]) {
    if (typeof source[key] === "boolean") options[key] = source[key];
  }
  options.opacity = clamp(options.opacity, 0, 1);
  options.holdMs = Math.max(0, options.holdMs);
  options.fadeMs = Math.max(0, options.fadeMs);
  options.minOpacity = clamp(options.minOpacity, 0, options.opacity);
  return options;
}

export function publishSkeleton(publisherId, skeleton, timestamp = skeleton.timestamp, confidence = skeleton.confidence) {
  return {
    frameId: `${publisherId}:${skeleton.trackId}`,
    publisherId,
    trackId: skeleton.trackId,
    timestamp,
    skeleton,
    confidence,
    layer: "overlay",
    synthetic: true,
  };
}

export function isOverlay(item) {
  return isObject(item) && (item.layer === "overlay" || item.synthetic === true || item.bypassDetector === true);
}

export function composeFeed(officerId, subjects, overlays, timestamp) {
  return {
    officerId,
    timestamp,
    subjects: Array.isArray(subjects) ? [...subjects] : [],
    overlays: Array.isArray(overlays) ? [...overlays] : [],
  };
}

export function detectorInput(feed) {
  if (!isObject(feed) || !Array.isArray(feed.subjects)) return [];
  return feed.subjects.filter((subject) => !isOverlay(subject));
}

export function bypassedCount(feed) {
  if (!isObject(feed)) return 0;
  const overlays = Array.isArray(feed.overlays) ? feed.overlays.length : 0;
  const leaked = Array.isArray(feed.subjects) ? feed.subjects.filter(isOverlay).length : 0;
  return overlays + leaked;
}

export class OverlayBus {
  constructor(options = {}) {
    this.options = resolvedOptions(DEFAULT_OPTIONS, options);
    this.latest = new Map();
    this.bypassed = 0;
  }

  publish(frames, timestamp) {
    const accepted = [];
    for (const frame of Array.isArray(frames) ? frames : []) {
      if (!isObject(frame) || typeof frame.publisherId !== "string" || typeof frame.trackId !== "string" || !frame.skeleton) continue;
      const acceptedFrame = {
        ...frame,
        frameId: `${frame.publisherId}:${frame.trackId}`,
        timestamp: frame.timestamp ?? timestamp,
      };
      this.latest.set(acceptedFrame.frameId, acceptedFrame);
      accepted.push(acceptedFrame);
    }
    this.prune(timestamp);
    return accepted;
  }

  layersFor(officerId, timestamp, options = {}) {
    const resolved = resolvedOptions(this.options, options);
    if (!resolved.sharing) return [];

    const maxAge = resolved.holdMs + resolved.fadeMs;
    const layers = [];
    for (const frame of this.latest.values()) {
      if (!resolved.includeSelf && frame.publisherId === officerId) continue;
      const ageMs = Math.max(0, timestamp - frame.timestamp);
      const stale = ageMs > maxAge;
      if (stale) continue;
      const elapsedFade = Math.max(0, ageMs - resolved.holdMs);
      const fade = resolved.fadeMs > 0 ? elapsedFade / resolved.fadeMs : 1;
      const opacity = elapsedFade === 0 ? resolved.opacity : clamp(
        resolved.opacity + (resolved.minOpacity - resolved.opacity) * fade,
        resolved.minOpacity,
        resolved.opacity,
      );
      layers.push({
        frameId: frame.frameId,
        publisherId: frame.publisherId,
        trackId: frame.trackId,
        timestamp: frame.timestamp,
        skeleton: frame.skeleton,
        confidence: frame.confidence,
        opacity,
        ageMs,
        stale,
        bypassDetector: true,
      });
    }
    layers.sort((left, right) => right.timestamp - left.timestamp || left.frameId.localeCompare(right.frameId));
    this.bypassed += layers.length;
    return layers;
  }

  frames() {
    return [...this.latest.values()];
  }

  prune(timestamp) {
    const maxAge = this.options.holdMs + this.options.fadeMs;
    for (const [frameId, frame] of this.latest) {
      if (timestamp - frame.timestamp > maxAge) this.latest.delete(frameId);
    }
  }

  reset() {
    this.latest.clear();
    this.bypassed = 0;
  }
}
