import { HEIGHT, WIDTH } from "./simulation.js";

export const MIN_SCALE = 0.08;
export const MAX_SCALE = 4;

const sizeOf = (size) => ({ width: size.width ?? size.x ?? 0, height: size.height ?? size.y ?? 0 });
const rotate = (x, y, angle) => ({ x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) });

/** Keeps display geometry separate from truth: callers pass only published estimates/tracks. */
export function worldToMinimap(point, view) {
  const size = sizeOf(view.size), rotated = rotate(point.x - view.center.x, point.y - view.center.y, view.rotation ?? 0);
  return { x: size.width / 2 + rotated.x * view.scale, y: size.height / 2 + rotated.y * view.scale };
}

export function minimapToWorld(pixel, view) {
  const size = sizeOf(view.size), unrotated = rotate((pixel.x - size.width / 2) / view.scale, (pixel.y - size.height / 2) / view.scale, -(view.rotation ?? 0));
  return { x: view.center.x + unrotated.x, y: view.center.y + unrotated.y };
}

/** The operator may see deliberate localization drift; never substitute world.officers here. */
export function collectBlips({ localizations = [], contacts = [], sensors = [], selectedId }) {
  const officers = localizations.map((estimate) => ({
    id: estimate.officerId,
    kind: "officer",
    x: estimate.position.x,
    y: estimate.position.z,
    heading: estimate.orientation.yaw,
    state: "localized",
    selected: selectedId === estimate.officerId,
  }));
  // Contacts are the awareness list, not world.targets: an absent track must remain absent.
  const targets = contacts.map((contact) => ({
    id: contact.targetId,
    kind: "target",
    x: contact.x,
    y: contact.y,
    heading: contact.heading,
    state: contact.threat ?? "hostile",
    source: contact.kind,
    modality: contact.radar && !contact.stereo ? "radar-only" : "stereo-fused",
    coasting: contact.coasting,
    selected: false,
  }));
  // Unlocated pucks have no operator-known position, so omit them entirely.
  const puckBlips = sensors.flatMap((sensor) => sensor.located && sensor.position ? [{
    id: sensor.id,
    kind: "sensor",
    x: sensor.position.x,
    y: sensor.position.y,
    state: sensor.active ? "active" : sensor.state,
    selected: false,
  }] : []);
  return [...officers, ...targets, ...puckBlips].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

export function clampView(view, world = { width: WIDTH, height: HEIGHT }) {
  const size = sizeOf(view.size), width = world.width ?? world.WIDTH ?? WIDTH, height = world.height ?? world.HEIGHT ?? HEIGHT;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  const halfX = size.width / (2 * scale), halfY = size.height / (2 * scale);
  const center = {
    x: halfX * 2 >= width ? width / 2 : Math.min(width - halfX, Math.max(halfX, view.center.x)),
    y: halfY * 2 >= height ? height / 2 : Math.min(height - halfY, Math.max(halfY, view.center.y)),
  };
  return { ...view, center, scale };
}

export function fitView(world = { width: WIDTH, height: HEIGHT }, size = { width: 180, height: 180 }, rotation = 0) {
  const width = world.width ?? world.WIDTH ?? WIDTH, height = world.height ?? world.HEIGHT ?? HEIGHT, dimensions = sizeOf(size);
  return clampView({ center: { x: width / 2, y: height / 2 }, scale: Math.min(dimensions.width / width, dimensions.height / height) * 0.9, rotation, size: dimensions }, { width, height });
}

export function hitTest(pixel, blips, view, radius = 12) {
  let hit;
  let nearest = radius;
  for (const blip of blips) {
    const point = worldToMinimap(blip, view), distance = Math.hypot(pixel.x - point.x, pixel.y - point.y);
    if (distance <= nearest) { hit = blip; nearest = distance; }
  }
  return hit;
}
