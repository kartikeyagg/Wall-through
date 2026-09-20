"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { BONES, skeletonSegments } from "./skeleton.js";
import { createStereoRig } from "./stereo.js";
import type { Skeleton } from "./skeleton.js";
import type { OverlayLayer } from "./overlay.js";
import type { Landmark, World } from "./simulation.js";
import type { VisionObservation } from "./vision.js";

export type VisionContact = VisionObservation & {
  kind: "direct" | "shared";
  /** Shared human correction; absent means the system's default, hostile. */
  threat?: "hostile" | "cleared";
  clearedBy?: string;
  /** Who put the flag back: an officer id, or "system" when a clearance lapsed. */
  restoredBy?: string;
  restoredReason?: string;
};

/** One deployed puck as the vision pipeline reports it each frame. */
export type SensorReport = {
  id: string;
  ownerId: string;
  state: "flight" | "settled";
  /** Settled and located well enough to be trusted as a radar origin. */
  active: boolean;
  located: boolean;
  /** Stereo-estimated ground position in world units, null before any fix. */
  position: { x: number; y: number } | null;
  sigma: number;
  fixes: number;
  observers: string[];
  lastFixAt: number | null;
  returns: number;
  tracks: number;
  confirmed: number;
};

export type SceneOptions = {
  selected: string;
  mode: "overview" | "glasses";
  /** Capture the mouse in the glasses view to steer the officer, FPS style. */
  mouseLook: boolean;
  cones: boolean;
  links: boolean;
  sharing: boolean;
  skeletons: boolean;
  overlayOpacity: number;
  trails: boolean;
  vectors: boolean;
  directionArrows: boolean;
  baseline: number;
  range: number;
  fov: number;
  imu: boolean;
  /** Draw the ground footprint of each located puck's radar coverage. */
  sensorRings: boolean;
  /** Radar detection radius in world units, for those footprints. */
  radarRange: number;
  /** Hide cleared tracks' markers entirely instead of greying them. */
  hideCleared: boolean;
};

type Props = {
  world: React.MutableRefObject<World | null>;
  options: React.MutableRefObject<SceneOptions>;
  contacts: React.MutableRefObject<VisionContact[]>;
  /** Live puck reports, keyed by id; positions here are estimates, not truth. */
  sensors: React.MutableRefObject<SensorReport[]>;
  /** Every live track the selected officer knows about, in any direction; drives the glasses HUD arrows. */
  awareness: React.MutableRefObject<VisionContact[]>;
  overlays: React.MutableRefObject<OverlayLayer[]>;
  onSelect: (id: string) => void;
  /** Called when the operator clicks a target body to flip its threat state. */
  onToggleThreat: (trackId: string) => void;
  onKeyDown: (key: string, repeated: boolean) => void;
  onKeyUp: (key: string) => void;
  onClearKeys: () => void;
};

const scale = 0.02;
const UNITS_PER_METRE = 24;
// The rig sits on the officer's eyes, so its optical centre and the eye line share one height.
const defaultRig = createStereoRig(), eyeHeight = defaultRig.mountHeight * UNITS_PER_METRE * scale, defaultBaseline = defaultRig.baseline;
const headRadius = 0.11;
const eyeSpacing = 0.1; // drawn wider than life so the gaze reads from the overview camera
const skeletonMinScore = 0.32;
const overlayTintColor = new THREE.Color("#bcf574");
const clearedTintColor = new THREE.Color("#94a3b8");
// Overview orbit around the arena centre: Ctrl + drag rotates and tilts, Ctrl + wheel zooms, double-click resets.
const defaultOrbit = { azimuth: Math.atan2(8.5, 11.5), elevation: Math.asin(12.5 / Math.hypot(8.5, 12.5, 11.5)), distance: Math.hypot(8.5, 12.5, 11.5) };
const orbitLimits = { minElevation: THREE.MathUtils.degToRad(5), maxElevation: THREE.MathUtils.degToRad(89), minDistance: 5, maxDistance: 32 };
const orbitRadiansPerPixel = 0.006;
// A conventional FPS turn rate at this rig FOV; pointer-lock deltas are pixels.
const mouseLookRadiansPerPixel = 0.0018;
const maxMouseLookDelta = 100;
// Glasses HUD: one arrow per live contact on a ring around the view centre, pointing at the target's bearing — up is ahead, down is behind.
const hudDepth = 1, hudRingFraction = 0.62, hudArrowFraction = 0.1;
const point = (x: number, y: number, height = 0) => new THREE.Vector3((x - 500) * scale, height, (y - 340) * scale);

type StereoRigVisual = { group: THREE.Group; lenses: [THREE.Mesh, THREE.Mesh]; imu: THREE.Mesh; compass: THREE.Mesh };
type OfficerVisual = { body: THREE.Mesh; head: THREE.Group; rig: StereoRigVisual; gaze: THREE.Line; gazePosition: THREE.BufferAttribute; gazeMaterial: THREE.LineBasicMaterial; gazePoint: THREE.Mesh };
type FieldVisual = { group: THREE.Group; left: THREE.Mesh; right: THREE.Mesh; overlap: THREE.Line };
type ContactVisual = { arrow: THREE.LineSegments; arrowMaterial: THREE.LineBasicMaterial; trail: THREE.Line; trailPosition: THREE.BufferAttribute; trailColor: THREE.BufferAttribute; ring: THREE.LineLoop; ringMaterial: THREE.LineBasicMaterial; innerRing: THREE.LineLoop; innerRingMaterial: THREE.LineBasicMaterial; outline: THREE.LineSegments; outlineMaterial: THREE.LineBasicMaterial };
type LinkVisual = { line: THREE.Line; position: THREE.BufferAttribute; distance: THREE.BufferAttribute };
type DirectionArrowVisual = { arrow: THREE.Mesh; material: THREE.MeshBasicMaterial };
type SkeletonVisual = { bones: THREE.LineSegments; bonesMaterial: THREE.LineBasicMaterial; bonesPosition: THREE.BufferAttribute; bonesColor: THREE.BufferAttribute; joints: THREE.Points; jointsMaterial: THREE.PointsMaterial; jointsPosition: THREE.BufferAttribute; jointsColor: THREE.BufferAttribute; tint: number; color: THREE.Color };
type SensorFixLine = { line: THREE.Line; position: THREE.BufferAttribute; distance: THREE.BufferAttribute };
type SensorVisual = { group: THREE.Group; rim: THREE.Mesh; drop: THREE.Line; marker: THREE.LineSegments; coverage: THREE.Mesh; fixLines: SensorFixLine[] };
const contactColor = (contact: VisionContact) => contact.radar && !contact.stereo ? "#e879f9" : contact.kind === "shared" ? "#bcf574" : "#ffd479";

/** Glass lenses sit directly over the eyes: the camera sees exactly what the officer sees. */
function makeStereoRig(): StereoRigVisual {
  const group = new THREE.Group();
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.022, 0.02), new THREE.MeshStandardMaterial({ color: "#101a20", roughness: 0.45, metalness: 0.35 }));
  band.position.set(0, eyeHeight + 0.058, headRadius * 0.8);
  const makeLens = () => { const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.008, 16), new THREE.MeshStandardMaterial({ color: "#9fd8ff", roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false })); lens.rotation.x = Math.PI / 2; lens.position.set(0, eyeHeight, headRadius + 0.03); return lens; };
  const lenses: [THREE.Mesh, THREE.Mesh] = [makeLens(), makeLens()];
  const imu = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.035), new THREE.MeshStandardMaterial({ color: "#a78bfa", roughness: 0.42, metalness: 0.5 })); imu.position.set(-0.1, eyeHeight + 0.078, 0.02);
  const compass = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.012, 16), new THREE.MeshStandardMaterial({ color: "#f7bf58", roughness: 0.35, metalness: 0.65 })); compass.position.set(0.1, eyeHeight + 0.075, 0.02);
  group.add(band, ...lenses, imu, compass);
  return { group, lenses, imu, compass };
}

function makeHead(skin: string) {
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 16, 12), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
  skull.position.y = eyeHeight;
  head.add(skull);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    eye.position.set(side * eyeSpacing / 2, eyeHeight, headRadius * 0.82);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 8), new THREE.MeshBasicMaterial({ color: "#05090c" }));
    pupil.position.set(side * eyeSpacing / 2, eyeHeight, headRadius * 0.82 + 0.02);
    head.add(eye, pupil);
  }
  return head;
}

type HumanParts = { body: THREE.Mesh; shoulders: THREE.Group; leftUpperArm: THREE.Group; leftLowerArm: THREE.Group; rightUpperArm: THREE.Group; rightLowerArm: THREE.Group; leftUpperLeg: THREE.Group; leftLowerLeg: THREE.Group; rightUpperLeg: THREE.Group; rightLowerLeg: THREE.Group; phase: number; height: number; last: { x: number; y: number; time: number } | null };

/** A stable hash gives each identity a repeatable look without leaking lab-only threat state. */
function idHash(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function targetAppearance(id: string) {
  const hash = idHash(id), outfits = [["#b85c52", "#303f4d", "#b77b5f"], ["#c99a42", "#365568", "#d5a27d"], ["#8060a9", "#384653", "#8f5e47"]] as const;
  const outfit = outfits[hash % outfits.length];
  return { color: outfit[0], accent: outfit[1], skin: outfit[2], height: 0.9 + ((hash >>> 4) % 13) / 100, build: 0.9 + ((hash >>> 9) % 15) / 100 };
}

function makePerson(color: string, { skin = "#b9795a", accent = "#1d2831", includeHead = true, role = "civilian", height = 1, build = 1 }: { skin?: string; accent?: string; includeHead?: boolean; role?: "civilian" | "officer"; height?: number; build?: number } = {}) {
  const group = new THREE.Group();
  // A tapered chest over a distinct pelvis reads as a person from the tactical camera.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * build, 0.135 * build, 0.34 * height, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.62, transparent: true }));
  body.position.y = 0.55 * height;
  group.add(body);
  const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * build, 0.16 * build, 0.14 * height, 8), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.76 })); pelvis.position.y = 0.34 * height; group.add(pelvis);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.29 * build, 0.22 * height, 0.07), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.72 })); vest.position.set(0, 0.58 * height, 0.155 * build); group.add(vest);
  const segment = (radius: number, length: number, material: THREE.Material) => { const pivot = new THREE.Group(), mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 3, 7), material); mesh.position.y = -length / 2; pivot.add(mesh); return pivot; };
  const limbMaterial = new THREE.MeshStandardMaterial({ color: role === "officer" ? "#18252f" : color, roughness: 0.77 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.76 });
  const arm = (side: number) => { const upper = segment(0.043 * build, 0.24 * height, limbMaterial), lower = segment(0.037 * build, 0.22 * height, limbMaterial); upper.position.set(side * 0.2 * build, 0.7 * height, 0); lower.position.y = -0.23 * height; upper.add(lower); const hand = new THREE.Mesh(new THREE.SphereGeometry(0.047 * build, 10, 8), skinMaterial); hand.position.y = -0.12 * height; lower.add(hand); group.add(upper); return [upper, lower] as const; };
  const leg = (side: number) => { const upper = segment(0.058 * build, 0.29 * height, limbMaterial), lower = segment(0.05 * build, 0.29 * height, limbMaterial); upper.position.set(side * 0.09 * build, 0.29 * height, 0); lower.position.y = -0.285 * height; upper.add(lower); const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1 * build, 0.06 * height, 0.17 * build), limbMaterial); foot.position.set(0, -0.16 * height, 0.045 * build); lower.add(foot); group.add(upper); return [upper, lower] as const; };
  const [leftUpperArm, leftLowerArm] = arm(-1), [rightUpperArm, rightLowerArm] = arm(1), [leftUpperLeg, leftLowerLeg] = leg(-1), [rightUpperLeg, rightLowerLeg] = leg(1);
  const shoulders = new THREE.Group(); shoulders.position.y = 0.7 * height; group.add(shoulders);
  if (includeHead) {
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052 * build, 0.058 * build, 0.09 * height, 10), skinMaterial); neck.position.y = 0.78 * height;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11 * build, 16, 12), skinMaterial); head.position.y = 0.9 * height;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.115 * build, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#241914", roughness: 0.9 })); hair.position.y = 0.94 * height;
    group.add(neck, head, hair);
  }
  group.userData.human = { body, shoulders, leftUpperArm, leftLowerArm, rightUpperArm, rightLowerArm, leftUpperLeg, leftLowerLeg, rightUpperLeg, rightLowerLeg, phase: role === "officer" ? 0 : (idHash(color) % 31) / 10, height, last: null } satisfies HumanParts;
  return group;
}

function makeOfficer(color: string) {
  const group = makePerson(color, { skin: "#c99a78", accent: "#0d1b25", includeHead: false, role: "officer" }), head = makeHead("#c99a78"), rig = makeStereoRig();
  head.add(rig.group); group.add(head);
  // Gaze ray: the shared optical axis of eyes and rig, cut short at the first wall it meets.
  const gazeGeometry = new THREE.BufferGeometry(), gazePosition = new THREE.BufferAttribute(new Float32Array(6), 3); gazeGeometry.setAttribute("position", gazePosition);
  const gazeMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }), gaze = new THREE.Line(gazeGeometry, gazeMaterial);
  const gazePoint = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color }));
  const visual: OfficerVisual = { body: group.children[0] as THREE.Mesh, head, rig, gaze, gazePosition, gazeMaterial, gazePoint };
  group.userData.officer = visual;
  return { group, visual };
}

function animateHuman(group: THREE.Group, agent: { x: number; y: number }, time: number) {
  const human = group.userData.human as HumanParts | undefined;
  if (!human) return;
  const previous = human.last, moved = previous ? Math.hypot(agent.x - previous.x, agent.y - previous.y) / Math.max(time - previous.time, 1 / 60) : 0;
  human.last = { x: agent.x, y: agent.y, time };
  const speed = THREE.MathUtils.clamp(moved / 44, 0, 1), gait = time * (3.4 + speed * 6.5) + human.phase;
  if (speed < 0.035) {
    const sway = Math.sin(time * 1.25 + human.phase), breath = Math.sin(time * 2.1 + human.phase) * 0.006;
    human.body.position.y = 0.55 * human.height + breath; human.shoulders.rotation.z = sway * 0.028;
    human.leftUpperArm.rotation.x = sway * 0.05; human.rightUpperArm.rotation.x = -sway * 0.05;
    human.leftLowerArm.rotation.x = human.rightLowerArm.rotation.x = -0.12;
    human.leftUpperLeg.rotation.x = sway * 0.025; human.rightUpperLeg.rotation.x = -sway * 0.025;
    human.leftLowerLeg.rotation.x = human.rightLowerLeg.rotation.x = 0.08;
    return;
  }
  const left = Math.sin(gait), right = -left, knee = (swing: number) => Math.max(0, -swing) * (0.65 + speed * 0.35);
  human.leftUpperLeg.rotation.x = left * (0.48 + speed * 0.18); human.rightUpperLeg.rotation.x = right * (0.48 + speed * 0.18);
  human.leftLowerLeg.rotation.x = knee(left); human.rightLowerLeg.rotation.x = knee(right);
  human.leftUpperArm.rotation.x = right * 0.42; human.rightUpperArm.rotation.x = left * 0.42;
  human.leftLowerArm.rotation.x = -0.3 - Math.max(0, right) * 0.36; human.rightLowerArm.rotation.x = -0.3 - Math.max(0, left) * 0.36;
  human.body.position.y = 0.55 * human.height + Math.abs(Math.sin(gait * 2)) * 0.018 * speed; human.shoulders.rotation.y = -left * 0.08 * speed;
}

function makeEnvironmentTexture(kind: "floor" | "wall") {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d")!;
  let seed = kind === "floor" ? 0x51f15e : 0x7a11c0;
  const random = () => { seed = Math.imul(seed ^ (seed >>> 15), 2246822519); return ((seed >>> 0) % 10000) / 10000; };
  context.fillStyle = kind === "floor" ? "#1b2d31" : "#4c5b5c"; context.fillRect(0, 0, 512, 512);
  const relief = document.createElement("canvas"); relief.width = relief.height = 512; const bump = relief.getContext("2d")!; bump.fillStyle = "#777777"; bump.fillRect(0, 0, 512, 512);
  if (kind === "floor") {
    for (let y = 0; y < 512; y += 64) for (let x = 0; x < 512; x += 64) { const shade = 34 + Math.floor(random() * 14); context.fillStyle = `rgb(${shade - 8}, ${shade + 8}, ${shade + 11})`; context.fillRect(x + 2, y + 2, 60, 60); bump.fillStyle = "#929292"; bump.fillRect(x + 2, y + 2, 60, 60); }
    context.strokeStyle = "#122126"; context.lineWidth = 3; bump.strokeStyle = "#303030"; bump.lineWidth = 3;
    for (let offset = 0; offset <= 512; offset += 64) { context.beginPath(); context.moveTo(offset, 0); context.lineTo(offset, 512); context.moveTo(0, offset); context.lineTo(512, offset); context.stroke(); bump.beginPath(); bump.moveTo(offset, 0); bump.lineTo(offset, 512); bump.moveTo(0, offset); bump.lineTo(512, offset); bump.stroke(); }
    for (let index = 0; index < 150; index++) { const x = random() * 512, y = random() * 512, length = 3 + random() * 15; context.strokeStyle = `rgba(8, 17, 20, ${0.08 + random() * 0.12})`; context.beginPath(); context.moveTo(x, y); context.lineTo(x + length, y + random() * 2); context.stroke(); }
  } else {
    const grime = context.createLinearGradient(0, 0, 0, 512); grime.addColorStop(0, "#697778"); grime.addColorStop(0.68, "#556467"); grime.addColorStop(1, "#39494d"); context.fillStyle = grime; context.fillRect(0, 0, 512, 512);
    context.strokeStyle = "#829091"; context.lineWidth = 2; bump.strokeStyle = "#575757"; bump.lineWidth = 2;
    for (let offset = 0; offset <= 512; offset += 96) { context.beginPath(); context.moveTo(offset, 0); context.lineTo(offset, 350); context.stroke(); bump.beginPath(); bump.moveTo(offset, 0); bump.lineTo(offset, 350); bump.stroke(); }
    context.fillStyle = "#34454a"; context.fillRect(0, 350, 512, 26); context.fillStyle = "#26383d"; context.fillRect(0, 376, 512, 10); bump.fillStyle = "#3d3d3d"; bump.fillRect(0, 350, 512, 36);
    for (let index = 0; index < 35; index++) { const x = random() * 512, y = random() * 340, radius = 18 + random() * 45; context.fillStyle = `rgba(44, 54, 53, ${0.025 + random() * 0.04})`; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); }
  }
  const texture = new THREE.CanvasTexture(canvas), bumpTexture = new THREE.CanvasTexture(relief); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = bumpTexture.wrapS = bumpTexture.wrapT = THREE.RepeatWrapping; return { texture, bumpTexture };
}

/** Procedural landmark faces make visual distinctiveness match localization strength. */
function makeLandmarkTexture(landmark: Landmark) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  let seed = idHash(landmark.id);
  const random = () => { seed = Math.imul(seed ^ (seed >>> 15), 2246822519); return (seed >>> 0) / 0x100000000; };
  const strength = THREE.MathUtils.clamp(landmark.strength, 0, 1), color = new THREE.Color(landmark.color).lerp(new THREE.Color("#687476"), 1 - strength), dark = color.clone().multiplyScalar(0.28 + strength * 0.16), light = color.clone().lerp(new THREE.Color("#d5e2e0"), 0.18 + strength * 0.22);
  context.clearRect(0, 0, 256, 256);
  if (landmark.kind === "floor-marking") {
    context.globalAlpha = 0.26 + strength * 0.46; context.fillStyle = `#${dark.getHexString()}`; context.fillRect(16, 16, 224, 224);
    context.strokeStyle = `#${light.getHexString()}`; context.lineWidth = 5 + strength * 4;
    for (let index = -2; index < 5; index++) { context.beginPath(); context.moveTo(index * 64, 256); context.lineTo(index * 64 + 128, 0); context.stroke(); }
    context.globalAlpha = 1;
  } else {
    context.fillStyle = `#${dark.getHexString()}`; context.fillRect(0, 0, 256, 256);
    context.strokeStyle = "#172226"; context.lineWidth = 12; context.strokeRect(6, 6, 244, 244);
    if (landmark.kind === "wall-art") {
      const inset = 30 + Math.floor(random() * 20); context.fillStyle = `#${light.getHexString()}`; context.fillRect(inset, inset, 256 - inset * 2, 256 - inset * 2);
      context.globalAlpha = 0.3 + strength * 0.6;
      for (let index = 0; index < 7; index++) { context.fillStyle = index % 2 ? `#${dark.getHexString()}` : "#172226"; context.beginPath(); context.arc(30 + random() * 196, 30 + random() * 196, 12 + random() * 38, 0, Math.PI * 2); context.fill(); }
      context.globalAlpha = 1;
    } else {
      context.strokeStyle = `#${light.getHexString()}`; context.lineWidth = 3 + strength * 3;
      for (let offset = 32; offset < 256; offset += 48) { context.beginPath(); context.moveTo(offset, 20); context.lineTo(offset, 236); context.moveTo(20, offset); context.lineTo(236, offset); context.stroke(); }
      const first = 36 + Math.floor(random() * 38), second = 150 + Math.floor(random() * 38); context.fillStyle = `#${light.getHexString()}`; context.fillRect(first, first, 42, 42); context.fillRect(second, second, 42, 42);
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLandmarkVisual(landmark: Landmark) {
  const width = Math.max(landmark.width * scale, 0.08), strength = THREE.MathUtils.clamp(landmark.strength, 0, 1), tone = new THREE.Color(landmark.color).lerp(new THREE.Color("#566365"), 1 - strength);
  if (landmark.kind === "fixture") {
    const group = new THREE.Group(), height = Math.max(landmark.height * scale * 2, width * 0.8, 0.16), material = new THREE.MeshStandardMaterial({ color: tone, roughness: 0.72, metalness: 0.16 + strength * 0.24 }), normal = new THREE.Vector3(landmark.normal.x, 0, landmark.normal.y);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.23, width * 0.28, height * 0.14, 10), material), body = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, height * 0.7, width * 0.4), material), beacon = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.11, width * 0.11, height * 0.18, 10), new THREE.MeshStandardMaterial({ color: tone.clone().lerp(new THREE.Color("#aab9b7"), 0.25 + strength * 0.35), roughness: 0.45, metalness: 0.36 }));
    if (normal.lengthSq() > 1e-6) normal.normalize();
    base.position.y = -height * 0.43; beacon.position.y = height * 0.43; group.add(base, body, beacon); group.position.copy(point(landmark.x, landmark.y, height / 2)).addScaledVector(normal, width * 0.32); group.rotation.y = idHash(landmark.id) * 0.0001;
    return { object: group, texture: null as THREE.Texture | null };
  }
  const texture = makeLandmarkTexture(landmark), material = new THREE.MeshBasicMaterial({ map: texture, transparent: landmark.kind === "floor-marking", opacity: landmark.kind === "floor-marking" ? 0.42 + strength * 0.38 : 1, side: THREE.DoubleSide, depthWrite: landmark.kind !== "floor-marking" });
  if (landmark.kind === "floor-marking") {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width), material); mesh.rotation.x = -Math.PI / 2; mesh.position.copy(point(landmark.x, landmark.y, 0.012));
    return { object: mesh, texture };
  }
  const aspect = landmark.kind === "wall-art" ? 0.64 : 0.5, mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * aspect), material), normal = new THREE.Vector3(landmark.normal.x, 0, landmark.normal.y);
  if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1); else normal.normalize();
  mesh.position.copy(point(landmark.x, landmark.y, landmark.height * scale)).addScaledVector(normal, 0.013); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  return { object: mesh, texture };
}

/** Distance along a map-space ray to the first wall face, or `limit` if nothing is hit. */
function rayToWalls(x: number, y: number, dx: number, dy: number, walls: World["walls"], limit: number) {
  let nearest = limit;
  for (const wall of walls) {
    let low = 0, high = nearest, blocked = true;
    for (const [origin, direction, min, max] of [[x, dx, wall.x, wall.x + wall.w], [y, dy, wall.y, wall.y + wall.h]]) {
      if (Math.abs(direction) < 1e-9) { if (origin < min || origin > max) { blocked = false; break; } continue; }
      const a = (min - origin) / direction, b = (max - origin) / direction; low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b));
      if (low > high) { blocked = false; break; }
    }
    if (blocked) nearest = low;
  }
  return nearest;
}

function makeSector(range: number, fov: number, color: string) {
  const shape = new THREE.Shape(); shape.moveTo(0, 0);
  const radians = fov * Math.PI / 180;
  for (let step = 0; step <= 24; step++) { const angle = -radians / 2 + radians * step / 24; shape.lineTo(Math.sin(angle) * range * scale, Math.cos(angle) * range * scale); }
  shape.lineTo(0, 0);
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }));
  mesh.rotation.x = Math.PI / 2; mesh.position.y = 0.015; // +PI/2 maps the shape's +y onto the officer's forward +z
  return mesh;
}

function makeSectorOutline(range: number, fov: number) {
  const vertices = new Float32Array(26 * 3), radians = fov * Math.PI / 180;
  for (let step = 0; step <= 24; step++) { const angle = -radians / 2 + radians * step / 24; vertices[step * 3] = Math.sin(angle) * range * scale; vertices[step * 3 + 2] = Math.cos(angle) * range * scale; }
  vertices[75] = 0; vertices[77] = 0;
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#bcf574", transparent: true, opacity: 0.82 }));
}

function makeField(range: number, fov: number): FieldVisual {
  const group = new THREE.Group(), left = makeSector(range, fov, "#76baff"), right = makeSector(range, fov, "#76baff"), overlap = makeSectorOutline(range, fov);
  group.add(left, right, overlap);
  return { group, left, right, overlap };
}

function makeContactVisual(): ContactVisual {
  const arrowGeometry = new THREE.BufferGeometry(); arrowGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 1, -0.22, 0, 0.72, 0, 0, 1, 0.22, 0, 0.72]), 3));
  const arrowMaterial = new THREE.LineBasicMaterial({ color: "#ffd479", transparent: true, opacity: 0.9 }), arrow = new THREE.LineSegments(arrowGeometry, arrowMaterial); arrow.position.y = 0.055;
  const trailGeometry = new THREE.BufferGeometry(), trailPosition = new THREE.BufferAttribute(new Float32Array(64 * 3), 3), trailColor = new THREE.BufferAttribute(new Float32Array(64 * 3), 3);
  trailGeometry.setAttribute("position", trailPosition); trailGeometry.setAttribute("color", trailColor);
  const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.82 })); trail.position.y = 0.035;
  const ringGeometry = new THREE.BufferGeometry(), ringVertices = new Float32Array(33 * 3);
  for (let index = 0; index <= 32; index++) { const angle = index / 32 * Math.PI * 2; ringVertices[index * 3] = Math.cos(angle); ringVertices[index * 3 + 2] = Math.sin(angle); }
  ringGeometry.setAttribute("position", new THREE.BufferAttribute(ringVertices, 3));
  const ringMaterial = new THREE.LineBasicMaterial({ color: "#ffd479", transparent: true, opacity: 0.48 }), ring = new THREE.LineLoop(ringGeometry, ringMaterial); ring.position.y = 0.045;
  const innerRingGeometry = ringGeometry.clone(), innerRingMaterial = new THREE.LineBasicMaterial({ color: "#e879f9", transparent: true, opacity: 0.3 }), innerRing = new THREE.LineLoop(innerRingGeometry, innerRingMaterial); innerRing.position.y = 0.047;
  const outlineMaterial = new THREE.LineBasicMaterial({ color: "#bcf574", transparent: true }), outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.62, 1.8, 0.62)), outlineMaterial);
  return { arrow, arrowMaterial, trail, trailPosition, trailColor, ring, ringMaterial, innerRing, innerRingMaterial, outline, outlineMaterial };
}

function makeSensorVisual(radarGeometry: THREE.CircleGeometry, radarMaterial: THREE.MeshBasicMaterial): SensorVisual {
  const group = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 18), new THREE.MeshStandardMaterial({ color: "#16222b", roughness: 0.42, metalness: 0.6 }));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.064, 0.006, 6, 18), new THREE.MeshStandardMaterial({ color: "#e879f9", emissive: "#e879f9", emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.4 })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.018;
  const dropGeometry = new THREE.BufferGeometry(); dropGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, -1, 0]), 3));
  const drop = new THREE.Line(dropGeometry, new THREE.LineBasicMaterial({ color: "#e879f9", transparent: true, opacity: 0.32 })); group.add(housing, rim, drop);
  const markerGeometry = new THREE.BufferGeometry(); markerGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 1]), 3));
  const marker = new THREE.LineSegments(markerGeometry, new THREE.LineBasicMaterial({ color: "#e879f9", transparent: true, opacity: 0.86 })); marker.position.y = 0.035;
  const coverage = new THREE.Mesh(radarGeometry, radarMaterial); coverage.rotation.x = -Math.PI / 2; coverage.position.y = 0.018; coverage.visible = false;
  const fixLines: SensorFixLine[] = [];
  for (let index = 0; index < 3; index++) { const geometry = new THREE.BufferGeometry(), position = new THREE.BufferAttribute(new Float32Array(6), 3), distance = new THREE.BufferAttribute(new Float32Array(2), 1); geometry.setAttribute("position", position); geometry.setAttribute("lineDistance", distance); const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: "#e879f9", dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.62 })); line.visible = false; group.add(line); fixLines.push({ line, position, distance }); }
  return { group, rim, drop, marker, coverage, fixLines };
}

/** A filled chevron pointing along +y, unit length; drawn on the skeleton layer so walls never hide it. */
function makeDirectionArrow(): DirectionArrowVisual {
  const shape = new THREE.Shape(); shape.moveTo(0, 0.5); shape.lineTo(0.42, -0.5); shape.lineTo(0, -0.22); shape.lineTo(-0.42, -0.5); shape.lineTo(0, 0.5);
  const material = new THREE.MeshBasicMaterial({ color: "#ffd479", transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide }), arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  arrow.renderOrder = 1000; arrow.visible = false; arrow.frustumCulled = false;
  return { arrow, material };
}

function makeSkeletonVisual(tint = 0): SkeletonVisual {
  const bonesGeometry = new THREE.BufferGeometry(), bonesPosition = new THREE.BufferAttribute(new Float32Array(BONES.length * 2 * 3), 3), bonesColor = new THREE.BufferAttribute(new Float32Array(BONES.length * 2 * 3), 3);
  bonesGeometry.setAttribute("position", bonesPosition); bonesGeometry.setAttribute("color", bonesColor);
  const bonesMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false }), bones = new THREE.LineSegments(bonesGeometry, bonesMaterial); bones.renderOrder = 1000;
  const jointsGeometry = new THREE.BufferGeometry(), jointsPosition = new THREE.BufferAttribute(new Float32Array(18 * 3), 3), jointsColor = new THREE.BufferAttribute(new Float32Array(18 * 3), 3);
  jointsGeometry.setAttribute("position", jointsPosition); jointsGeometry.setAttribute("color", jointsColor);
  const jointsMaterial = new THREE.PointsMaterial({ size: 0.013, sizeAttenuation: true, vertexColors: true, transparent: true, depthTest: false }), joints = new THREE.Points(jointsGeometry, jointsMaterial); joints.renderOrder = 1000;
  return { bones, bonesMaterial, bonesPosition, bonesColor, joints, jointsMaterial, jointsPosition, jointsColor, tint, color: new THREE.Color() };
}

function writeSkeleton(skeleton: Skeleton, visual: SkeletonVisual, opacity: number) {
  const segments = skeletonSegments(skeleton, skeletonMinScore), boneCount = Math.min(segments.length, BONES.length); let jointCount = 0;
  for (let index = 0; index < boneCount; index++) { const segment = segments[index], from = point(segment.from.x, segment.from.z, segment.from.y * scale), to = point(segment.to.x, segment.to.z, segment.to.y * scale); visual.bonesPosition.setXYZ(index * 2, from.x, from.y, from.z); visual.bonesPosition.setXYZ(index * 2 + 1, to.x, to.y, to.z); visual.color.set(segment.color); if (visual.tint) visual.color.lerp(overlayTintColor, visual.tint); visual.color.multiplyScalar(0.4 + 0.6 * segment.score); visual.bonesColor.setXYZ(index * 2, visual.color.r, visual.color.g, visual.color.b); visual.bonesColor.setXYZ(index * 2 + 1, visual.color.r, visual.color.g, visual.color.b); }
  for (const joint of skeleton.joints) { if (joint.score < skeletonMinScore) continue; const position = point(joint.x, joint.z, joint.y * scale); visual.jointsPosition.setXYZ(jointCount, position.x, position.y, position.z); const shade = 0.4 + 0.6 * joint.score; visual.jointsColor.setXYZ(jointCount, 0.9 * shade, 0.96 * shade, 0.94 * shade); jointCount++; }
  visual.bonesPosition.needsUpdate = true; visual.bonesColor.needsUpdate = true; visual.bones.geometry.setDrawRange(0, boneCount * 2); visual.jointsPosition.needsUpdate = true; visual.jointsColor.needsUpdate = true; visual.joints.geometry.setDrawRange(0, jointCount); visual.bonesMaterial.opacity = opacity; visual.jointsMaterial.opacity = opacity;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => { const mesh = child as THREE.Mesh; mesh.geometry?.dispose(); const material = mesh.material; if (Array.isArray(material)) material.forEach((item) => item.dispose()); else material?.dispose(); });
}

export default function SimulationScene({ world, options, contacts, sensors, awareness, overlays, onSelect, onToggleThreat, onKeyDown, onKeyUp, onClearKeys }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const lookHint = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor("#101a20"); renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "Interactive 3D simulation. Click an officer to select or a detected person to clear or re-flag them. Use W A S D or arrows to move, Q and E to turn, F to throw a sensor puck, and Space to pause. Hold Control and drag to rotate and tilt the view, Control and scroll to zoom, double-click to reset the view."); element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), fog = new THREE.Fog("#101a20", 12, 28); scene.fog = fog;
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 50); scene.add(new THREE.HemisphereLight("#b9dbed", "#091016", 2.1));
    const light = new THREE.DirectionalLight("#d9f5ff", 2.5); light.position.set(5, 10, 3); scene.add(light);
    const floorSurface = makeEnvironmentTexture("floor"), wallSurface = makeEnvironmentTexture("wall"); floorSurface.texture.repeat.set(3, 2); floorSurface.bumpTexture.repeat.copy(floorSurface.texture.repeat);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 13.6), new THREE.MeshStandardMaterial({ color: "#91a5a4", map: floorSurface.texture, bumpMap: floorSurface.bumpTexture, bumpScale: 0.045, roughness: 0.9, metalness: 0.03 })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const grid = new THREE.GridHelper(20, 25, "#293a43", "#1b2a32"); grid.position.y = 0.005; scene.add(grid);
    const people = new Map<string, THREE.Group>(), officerVisuals = new Map<string, OfficerVisual>(), gazeGroup = new THREE.Group(), fields = new Map<string, FieldVisual>(), contactVisuals = new Map<string, ContactVisual>(), directSkeletonVisuals = new Map<string, SkeletonVisual>(), overlaySkeletonVisuals = new Map<string, SkeletonVisual>(), freeOverlaySkeletonVisuals: SkeletonVisual[] = [], linkVisuals = new Map<string, LinkVisual>(), directionArrows = new Map<string, DirectionArrowVisual>(), sensorVisuals = new Map<string, SensorVisual>();
    const linkGroup = new THREE.Group(), fovGroup = new THREE.Group(), wallGroup = new THREE.Group(), landmarkGroup = new THREE.Group(), contactGroup = new THREE.Group(), skeletonGroup = new THREE.Group(), sensorGroup = new THREE.Group(); scene.add(linkGroup, fovGroup, wallGroup, landmarkGroup, contactGroup, skeletonGroup, gazeGroup, sensorGroup);
    const landmarkTextures: THREE.Texture[] = []; let landmarksBuilt = false;
    const radarGeometry = new THREE.CircleGeometry(1, 48), radarMaterial = new THREE.MeshBasicMaterial({ color: "#e879f9", transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
    const emptyDeployedSensors: World["sensors"] = [], emptySensorReports: SensorReport[] = [];
    // The HUD rides on the camera, so it must be in the scene graph for its children to render.
    const hudGroup = new THREE.Group(); hudGroup.position.z = -hudDepth; camera.add(hudGroup); scene.add(camera);
    const crosshairGeometry = new THREE.BufferGeometry(); crosshairGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.025, 0, 0, -0.008, 0, 0, 0.008, 0, 0, 0.025, 0, 0, 0, -0.025, 0, 0, -0.008, 0, 0, 0.008, 0, 0, 0.025, 0]), 3));
    const crosshair = new THREE.LineSegments(crosshairGeometry, new THREE.LineBasicMaterial({ color: "#bcf574", transparent: true, opacity: 0.54, depthTest: false, depthWrite: false, fog: false })); crosshair.position.z = -hudDepth; crosshair.renderOrder = 1001; crosshair.visible = false; camera.add(crosshair);
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let lastWorld: World | null = null;
    const clearGroup = (group: THREE.Group) => { for (const child of [...group.children]) { group.remove(child); disposeObject(child); } };
    const disposeSensorVisual = (visual: SensorVisual) => { sensorGroup.remove(visual.group, visual.marker, visual.coverage); disposeObject(visual.group); disposeObject(visual.marker); };
    const buildLandmarks = (landmarks: readonly Landmark[]) => {
      for (const landmark of landmarks) { const visual = makeLandmarkVisual(landmark); landmarkGroup.add(visual.object); if (visual.texture) landmarkTextures.push(visual.texture); }
      landmarksBuilt = true;
    };
    const rebuild = (w: World) => {
      for (const person of people.values()) { scene.remove(person); disposeObject(person); }
      clearGroup(fovGroup); clearGroup(wallGroup); clearGroup(contactGroup); clearGroup(linkGroup); clearGroup(skeletonGroup); clearGroup(gazeGroup); clearGroup(hudGroup); people.clear(); officerVisuals.clear(); fields.clear(); contactVisuals.clear(); directSkeletonVisuals.clear(); overlaySkeletonVisuals.clear(); freeOverlaySkeletonVisuals.length = 0; linkVisuals.clear(); directionArrows.clear();
      for (const wall of w.walls) {
        const width = wall.w * scale, depth = wall.h * scale, material = new THREE.MeshStandardMaterial({ color: "#b4c3c3", map: wallSurface.texture, bumpMap: wallSurface.bumpTexture, bumpScale: 0.035, roughness: 0.78, metalness: 0.04 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 2.2, depth), material); mesh.position.copy(point(wall.x + wall.w / 2, wall.y + wall.h / 2, 1.1));
        // Caps and skirting turn the simple collision boxes into architectural walls without affecting navigation.
        const cap = new THREE.Mesh(new THREE.BoxGeometry(width + 0.05, 0.07, depth + 0.05), new THREE.MeshStandardMaterial({ color: "#6b7c7c", roughness: 0.58, metalness: 0.12 })); cap.position.y = 1.125;
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(width + 0.025, 0.14, depth + 0.025), new THREE.MeshStandardMaterial({ color: "#273a3e", roughness: 0.66, metalness: 0.08 })); skirt.position.y = -1.03;
        mesh.add(cap, skirt); wallGroup.add(mesh);
      }
      for (const officer of w.officers) { const { group: person, visual } = makeOfficer("#76baff"); person.userData.officerId = officer.id; people.set(officer.id, person); officerVisuals.set(officer.id, visual); scene.add(person); gazeGroup.add(visual.gaze, visual.gazePoint); const field = makeField(options.current.range, options.current.fov); fields.set(officer.id, field); fovGroup.add(field.group); }
      for (const target of w.targets) {
        const appearance = targetAppearance(target.id), person = makePerson(appearance.color, appearance); person.userData.targetId = target.id; person.userData.originalBodyColor = ((person.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.clone(); people.set(target.id, person); scene.add(person);
        const visual = makeContactVisual(); contactVisuals.set(target.id, visual); contactGroup.add(visual.arrow, visual.trail, visual.ring, visual.innerRing, visual.outline);
        const direction = makeDirectionArrow(); directionArrows.set(target.id, direction); hudGroup.add(direction.arrow);
        const skeletonVisual = makeSkeletonVisual(); directSkeletonVisuals.set(target.id, skeletonVisual); skeletonGroup.add(skeletonVisual.bones, skeletonVisual.joints);
        const geometry = new THREE.BufferGeometry(), position = new THREE.BufferAttribute(new Float32Array(6), 3), distance = new THREE.BufferAttribute(new Float32Array(2), 1); geometry.setAttribute("position", position); geometry.setAttribute("lineDistance", distance);
        const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: "#bcf574", dashSize: 0.12, gapSize: 0.12, transparent: true, opacity: 0.65 })); line.visible = false; linkGroup.add(line); linkVisuals.set(target.id, { line, position, distance });
      }
      lastWorld = w;
    };
    const resize = () => { const { width, height } = element.getBoundingClientRect(); renderer.setSize(Math.max(width, 1), Math.max(height, 1), false); camera.aspect = Math.max(width, 1) / Math.max(height, 1); camera.updateProjectionMatrix(); };
    const orbit = { ...defaultOrbit }; let drag: { x: number; y: number } | null = null, pointerLocked = false, lookPitch = 0, shownMode: SceneOptions["mode"] | null = null, shownMouseLook: boolean | null = null;
    const updateLookHint = () => { const hint = lookHint.current; if (!hint) return; const enabled = options.current.mode === "glasses" && options.current.mouseLook; hint.hidden = !enabled; hint.classList.toggle("locked", pointerLocked); hint.textContent = pointerLocked ? "AIM + CLICK TO TAG · ESC TO RELEASE" : "CLICK EMPTY SPACE TO LOOK"; };
    const pointerLockChange = () => { pointerLocked = document.pointerLockElement === renderer.domElement; updateLookHint(); };
    const mouseLook = (event: MouseEvent) => {
      if (!pointerLocked || options.current.mode !== "glasses" || !options.current.mouseLook) return;
      const dx = THREE.MathUtils.clamp(event.movementX, -maxMouseLookDelta, maxMouseLookDelta), dy = THREE.MathUtils.clamp(event.movementY, -maxMouseLookDelta, maxMouseLookDelta);
      const officer = world.current?.officers.find((item) => item.id === options.current.selected);
      if (officer) officer.angle = Math.atan2(Math.sin(officer.angle + dx * mouseLookRadiansPerPixel), Math.cos(officer.angle + dx * mouseLookRadiansPerPixel));
      // Pitch belongs only to the rendered camera: the yaw-only simulation geometry remains authoritative.
      lookPitch = THREE.MathUtils.clamp(lookPitch - dy * mouseLookRadiansPerPixel, THREE.MathUtils.degToRad(-35), THREE.MathUtils.degToRad(35));
    };
    const startDrag = (event: PointerEvent) => { drag = { x: event.clientX, y: event.clientY }; renderer.domElement.setPointerCapture(event.pointerId); renderer.domElement.style.cursor = "grabbing"; };
    const moveDrag = (event: PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y; drag = { x: event.clientX, y: event.clientY };
      if (options.current.mode === "glasses") {
        // First person has no free camera: the view is the rig, so dragging turns the officer (and their sensor) instead.
        const officer = world.current?.officers.find((item) => item.id === options.current.selected); if (officer) officer.angle = Math.atan2(Math.sin(officer.angle + dx * orbitRadiansPerPixel), Math.cos(officer.angle + dx * orbitRadiansPerPixel));
        return;
      }
      orbit.azimuth -= dx * orbitRadiansPerPixel; orbit.elevation = THREE.MathUtils.clamp(orbit.elevation + dy * orbitRadiansPerPixel, orbitLimits.minElevation, orbitLimits.maxElevation);
    };
    const endDrag = (event: PointerEvent) => { if (!drag) return; drag = null; if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId); renderer.domElement.style.cursor = ""; };
    const zoom = (event: WheelEvent) => { if (!event.ctrlKey || options.current.mode !== "overview") return; event.preventDefault(); orbit.distance = THREE.MathUtils.clamp(orbit.distance * Math.exp(event.deltaY * 0.0015), orbitLimits.minDistance, orbitLimits.maxDistance); };
    const resetView = () => Object.assign(orbit, defaultOrbit);
    const pick = (event: PointerEvent, fromCrosshair = false) => {
      const bounds = renderer.domElement.getBoundingClientRect(); pointer.set(fromCrosshair ? 0 : ((event.clientX - bounds.left) / bounds.width) * 2 - 1, fromCrosshair ? 0 : -((event.clientY - bounds.top) / bounds.height) * 2 + 1); raycaster.setFromCamera(pointer, camera);
      const officerOf = (object: THREE.Object3D | null): string | undefined => object ? object.userData.officerId ?? officerOf(object.parent) : undefined, targetOf = (object: THREE.Object3D | null): string | undefined => object ? object.userData.targetId ?? targetOf(object.parent) : undefined, hit = raycaster.intersectObjects([...people.values()], true)[0];
      if (!hit) return false;
      const officerId = officerOf(hit.object), targetId = targetOf(hit.object); if (officerId) onSelect(officerId); else if (targetId) onToggleThreat(targetId);
      return Boolean(officerId || targetId);
    };
    const select = (event: PointerEvent) => {
      renderer.domElement.focus();
      if (event.ctrlKey) { startDrag(event); return; }
      const glasses = options.current.mode === "glasses", mouseLookEnabled = options.current.mouseLook;
      if (pointerLocked) { pick(event, true); return; }
      const hit = pick(event);
      if (glasses && mouseLookEnabled && !hit) renderer.domElement.requestPointerLock?.();
    };
    const keyDown = (event: KeyboardEvent) => { const key = event.key.toLowerCase(); if (["w", "a", "s", "d", "q", "e", "f", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) { event.preventDefault(); onKeyDown(key, event.repeat); } };
    const keyUp = (event: KeyboardEvent) => onKeyUp(event.key.toLowerCase());
    const observer = new ResizeObserver(resize); observer.observe(element); renderer.domElement.addEventListener("pointerdown", select); renderer.domElement.addEventListener("pointermove", moveDrag); renderer.domElement.addEventListener("pointerup", endDrag); renderer.domElement.addEventListener("pointercancel", endDrag); renderer.domElement.addEventListener("wheel", zoom, { passive: false }); renderer.domElement.addEventListener("dblclick", resetView); renderer.domElement.addEventListener("keydown", keyDown); document.addEventListener("pointerlockchange", pointerLockChange); document.addEventListener("mousemove", mouseLook); window.addEventListener("keyup", keyUp); window.addEventListener("blur", onClearKeys); document.addEventListener("visibilitychange", onClearKeys); updateLookHint(); resize();
    let frame = 0, pulse = 0;
    const render = () => {
      const w = world.current, settings = options.current;
      if (settings.mode !== shownMode || settings.mouseLook !== shownMouseLook) { shownMode = settings.mode; shownMouseLook = settings.mouseLook; updateLookHint(); }
      if (!settings.mouseLook && document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      crosshair.visible = pointerLocked && settings.mode === "glasses" && settings.mouseLook;
      if (w) {
        if (w !== lastWorld || people.size !== w.officers.length + w.targets.length) rebuild(w);
        const landmarks = (w as World & { landmarks?: Landmark[] }).landmarks;
        if (!landmarksBuilt && landmarks?.length) buildLandmarks(landmarks);
        const selected = w.officers.find((item) => item.id === settings.selected) ?? w.officers[0]; pulse += 0.045;
        for (const officer of w.officers) {
          const mesh = people.get(officer.id)!, visual = officerVisuals.get(officer.id)!, isSelected = officer.id === selected.id, tone = isSelected ? "#bcf574" : "#76baff"; mesh.position.copy(point(officer.x, officer.y)); mesh.rotation.y = Math.PI / 2 - officer.angle; (visual.body.material as THREE.MeshStandardMaterial).color.set(tone);
          animateHuman(mesh, officer, w.time);
          // In glasses mode the camera sits inside this officer's eyes, so their own body would only occlude the view.
          const firstPerson = settings.mode === "glasses" && isSelected; mesh.visible = !firstPerson;
          const separation = THREE.MathUtils.clamp(settings.baseline * scale * UNITS_PER_METRE, 0.045, 0.22); const lensSpacing = THREE.MathUtils.clamp(eyeSpacing * settings.baseline / defaultBaseline, 0.05, 0.28); visual.rig.lenses[0].position.x = -lensSpacing / 2; visual.rig.lenses[1].position.x = lensSpacing / 2;
          (visual.rig.imu.material as THREE.MeshStandardMaterial).color.set(settings.imu ? "#a78bfa" : "#4b5563"); (visual.rig.compass.material as THREE.MeshStandardMaterial).emissive.set("#39230b");
          const dx = Math.cos(officer.angle), dy = Math.sin(officer.angle), eyeX = officer.x + dx * headRadius / scale, eyeY = officer.y + dy * headRadius / scale, reach = rayToWalls(eyeX, eyeY, dx, dy, w.walls, settings.range), from = point(eyeX, eyeY, eyeHeight), to = point(eyeX + dx * reach, eyeY + dy * reach, eyeHeight);
          visual.gazePosition.setXYZ(0, from.x, from.y, from.z); visual.gazePosition.setXYZ(1, to.x, to.y, to.z); visual.gazePosition.needsUpdate = true; visual.gazeMaterial.color.set(tone); visual.gazeMaterial.opacity = isSelected ? 0.9 : 0.55; (visual.gazePoint.material as THREE.MeshBasicMaterial).color.set(tone); visual.gazePoint.position.copy(to); visual.gaze.visible = !firstPerson; visual.gazePoint.visible = true;
          const field = fields.get(officer.id)!, showField = settings.cones && (settings.mode === "overview" || isSelected); field.group.position.copy(point(eyeX, eyeY)); field.group.rotation.y = Math.PI / 2 - officer.angle; field.left.visible = showField; field.right.visible = showField; field.overlap.visible = showField; ((field.overlap.material as THREE.LineBasicMaterial)).color.set(tone); field.left.position.x = -separation / 2; field.right.position.x = separation / 2; field.overlap.position.z = Math.max(0.045, separation);
        }
        const deployedSensors = w.sensors ?? emptyDeployedSensors, reports = sensors.current ?? emptySensorReports;
        for (const [id, visual] of sensorVisuals) if (!deployedSensors.some((sensor) => sensor.id === id)) { sensorVisuals.delete(id); disposeSensorVisual(visual); }
        for (const sensor of deployedSensors) {
          let visual = sensorVisuals.get(sensor.id);
          if (!visual) { visual = makeSensorVisual(radarGeometry, radarMaterial); sensorVisuals.set(sensor.id, visual); sensorGroup.add(visual.group, visual.marker, visual.coverage); }
          const report = reports.find((item) => item.id === sensor.id), airborne = sensor.state === "flight"; visual.group.position.copy(point(sensor.x, sensor.y, sensor.height * scale)); visual.group.rotation.set(airborne ? sensor.angle + pulse * 0.8 : 0, 0, airborne ? sensor.angle * 0.7 + pulse * 1.15 : 0); visual.drop.visible = airborne; visual.drop.scale.y = sensor.height * scale; visual.rim.scale.setScalar(!airborne && report && report.fixes > 0 && !report.located ? 1 + (Math.sin(pulse * 2.4) + 1) * 0.12 : 1); visual.marker.visible = Boolean(!airborne && report?.located && report.position);
          if (!airborne && report?.located && report.position) { visual.marker.position.copy(point(report.position.x, report.position.y, 0.035)); visual.marker.scale.setScalar(Math.max(report.sigma * scale, 0.035)); }
          visual.coverage.visible = Boolean(settings.sensorRings && settings.mode === "overview" && !airborne && report?.active && report.position);
          if (!airborne && report?.active && report.position) { visual.coverage.position.copy(point(report.position.x, report.position.y, 0.018)); visual.coverage.scale.setScalar(settings.radarRange * scale); }
          const tagging = !airborne && report && report.fixes > 0 && !report.located;
          for (let index = 0; index < visual.fixLines.length; index++) { const line = visual.fixLines[index], observer = tagging ? w.officers.find((officer) => officer.id === report.observers[index]) : undefined; line.line.visible = Boolean(observer); if (observer) { const from = point(observer.x, observer.y, eyeHeight), to = point(sensor.x, sensor.y, sensor.height * scale); line.position.setXYZ(0, from.x, from.y, from.z); line.position.setXYZ(1, to.x, to.y, to.z); line.position.needsUpdate = true; line.distance.setX(0, 0); line.distance.setX(1, from.distanceTo(to)); line.distance.needsUpdate = true; } }
        }
        const live = new Map(contacts.current.map((item) => [item.targetId, item])), known = new Map(awareness.current.map((item) => [item.targetId, item]));
        for (const target of w.targets) {
          const mesh = people.get(target.id)!, contact = live.get(target.id), visual = contactVisuals.get(target.id)!, tracked = known.get(target.id), cleared = contact?.threat === "cleared" || tracked?.threat === "cleared", bodyMaterial = (mesh.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial; mesh.visible = settings.mode === "overview" || Boolean(contact); mesh.position.copy(point(target.x, target.y)); mesh.rotation.y = Math.PI / 2 - target.angle; animateHuman(mesh, target, w.time); bodyMaterial.color.copy(cleared ? clearedTintColor : mesh.userData.originalBodyColor as THREE.Color); bodyMaterial.opacity = contact?.coasting ? 0.42 : 1;
          const direction = directionArrows.get(target.id)!; direction.arrow.visible = false;
          const skeletonVisual = directSkeletonVisuals.get(target.id)!; skeletonVisual.bones.visible = false; skeletonVisual.joints.visible = false;
          visual.arrow.visible = Boolean(contact?.moving && settings.vectors && !cleared); visual.trail.visible = Boolean(contact && settings.trails && !cleared); visual.ring.visible = Boolean(contact && (!cleared || !settings.hideCleared)); visual.innerRing.visible = Boolean(contact && !cleared && contact.radar && contact.stereo); visual.outline.visible = Boolean(contact?.kind === "shared" && (!cleared || !settings.hideCleared)); const link = linkVisuals.get(target.id)!; link.line.visible = false;
          const trackedCleared = tracked?.threat === "cleared";
          if (tracked && settings.directionArrows && settings.mode === "glasses" && (!trackedCleared || !settings.hideCleared)) {
            // Bearing in the officer's own frame: +forward is up the screen, +right (increasing map angle) is right, behind wraps to the bottom.
            const ox = tracked.x - selected.x, oy = tracked.y - selected.y, forward = ox * Math.cos(selected.angle) + oy * Math.sin(selected.angle), right = -ox * Math.sin(selected.angle) + oy * Math.cos(selected.angle), bearing = Math.atan2(right, forward);
            const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * hudDepth, radius = hudRingFraction * Math.min(halfHeight, halfHeight * camera.aspect), closeness = THREE.MathUtils.clamp(1 - Math.hypot(ox, oy) / Math.max(settings.range, 1), 0.35, 1);
            direction.arrow.position.set(Math.sin(bearing) * radius, Math.cos(bearing) * radius, 0); direction.arrow.rotation.z = -bearing; direction.arrow.scale.setScalar(halfHeight * hudArrowFraction * (0.7 + 0.6 * closeness) * (trackedCleared ? 0.7 : 1));
            direction.material.color.set(trackedCleared ? "#94a3b8" : contactColor(tracked)); direction.material.opacity = trackedCleared ? 0.35 : tracked.coasting ? 0.3 + (Math.sin(pulse) + 1) * 0.15 : 0.92; direction.arrow.visible = true;
          }
          if (!contact) continue;
          const contactPoint = point(contact.x, contact.y), shared = contact.kind === "shared", uncertain = contact.coasting, color = cleared ? "#94a3b8" : contactColor(contact); visual.arrow.position.copy(contactPoint); visual.arrow.position.y = 0.055; visual.arrow.rotation.y = Math.PI / 2 - contact.heading; visual.arrow.scale.setScalar(THREE.MathUtils.clamp(contact.speed * scale * 1.4, 0.14, 0.85)); visual.arrowMaterial.color.set(color); visual.arrowMaterial.opacity = uncertain ? 0.42 : 0.9;
          const trail = contact.trail, count = Math.min(trail.length, 64), start = trail.length - count, base = shared ? [0.737, 0.961, 0.455] : [1, 0.831, 0.475];
          for (let index = 0; index < count; index++) { const sample = trail[start + index], fade = 0.16 + 0.84 * (index + 1) / count; visual.trailPosition.setXYZ(index, (sample.x - 500) * scale, 0, (sample.y - 340) * scale); visual.trailColor.setXYZ(index, base[0] * fade, base[1] * fade, base[2] * fade); }
          visual.trailPosition.needsUpdate = true; visual.trailColor.needsUpdate = true; visual.trail.geometry.setDrawRange(0, count); visual.ring.position.copy(contactPoint); visual.ring.position.y = 0.045; visual.ring.scale.setScalar(Math.max(contact.sigma * scale, 0.025)); visual.ringMaterial.color.set(color); visual.ringMaterial.opacity = cleared ? 0.24 : uncertain ? 0.16 + (Math.sin(pulse) + 1) * 0.12 : 0.48; visual.innerRing.position.copy(contactPoint); visual.innerRing.position.y = 0.047; visual.innerRing.scale.setScalar(Math.max(contact.sigma * scale * 0.57, 0.016)); visual.outline.position.copy(point(contact.x, contact.y, 0.9)); visual.outlineMaterial.color.set(color); visual.outlineMaterial.opacity = cleared ? 0.5 : uncertain ? 0.35 : 1;
          if (settings.links && settings.sharing && shared) { const source = w.officers.find((item) => item.id === contact.observers[0]); if (source) { const from = point(source.x, source.y, 0.08), to = point(selected.x, selected.y, 0.08); link.position.setXYZ(0, from.x, from.y, from.z); link.position.setXYZ(1, to.x, to.y, to.z); link.position.needsUpdate = true; link.distance.setX(0, 0); link.distance.setX(1, from.distanceTo(to)); link.distance.needsUpdate = true; link.line.visible = true; } }
          if (settings.skeletons && !cleared && contact.kind === "direct" && contact.skeleton) { writeSkeleton(contact.skeleton, skeletonVisual, 0.95); skeletonVisual.bones.visible = true; skeletonVisual.joints.visible = true; skeletonVisual.jointsMaterial.opacity = 0.9; }
        }
        const layers = overlays.current, frameIds = new Set(layers.map((layer) => layer.frameId));
        for (const [frameId, visual] of overlaySkeletonVisuals) { if (!frameIds.has(frameId)) { overlaySkeletonVisuals.delete(frameId); visual.bones.visible = false; visual.joints.visible = false; freeOverlaySkeletonVisuals.push(visual); } else { visual.bones.visible = false; visual.joints.visible = false; } }
        if (settings.skeletons && settings.sharing) for (const layer of layers) { let visual = overlaySkeletonVisuals.get(layer.frameId); if (!visual) { visual = freeOverlaySkeletonVisuals.pop(); if (!visual && overlaySkeletonVisuals.size < 48) { visual = makeSkeletonVisual(0.28); skeletonGroup.add(visual.bones, visual.joints); } if (!visual) continue; overlaySkeletonVisuals.set(layer.frameId, visual); } writeSkeleton(layer.skeleton, visual, layer.opacity * settings.overlayOpacity); visual.bones.visible = true; visual.joints.visible = true; }
        if (settings.mode === "glasses") {
          // The view is the rig's view: same eye-level optical centre, level axis, and the rig's horizontal FOV.
          const dx = Math.cos(selected.angle), dy = Math.sin(selected.angle), eyeX = selected.x + dx * headRadius / scale, eyeY = selected.y + dy * headRadius / scale;
          camera.position.copy(point(eyeX, eyeY, eyeHeight)); camera.lookAt(point(eyeX + dx * 100, eyeY + dy * 100, eyeHeight + Math.tan(lookPitch) * 100));
          camera.fov = Math.min(170, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(settings.fov) / 2) / camera.aspect))); camera.updateProjectionMatrix();
          fog.near = 12; fog.far = 28;
        } else {
          const ground = orbit.distance * Math.cos(orbit.elevation); camera.fov = 48; camera.position.set(ground * Math.sin(orbit.azimuth), orbit.distance * Math.sin(orbit.elevation), ground * Math.cos(orbit.azimuth)); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
          // Fog tracks the orbit distance so zooming out does not bury the arena.
          fog.near = orbit.distance - 7; fog.far = orbit.distance + 17;
        }
      }
      renderer.render(scene, camera); frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); if (document.pointerLockElement === renderer.domElement) document.exitPointerLock(); renderer.domElement.removeEventListener("pointerdown", select); renderer.domElement.removeEventListener("pointermove", moveDrag); renderer.domElement.removeEventListener("pointerup", endDrag); renderer.domElement.removeEventListener("pointercancel", endDrag); renderer.domElement.removeEventListener("wheel", zoom); renderer.domElement.removeEventListener("dblclick", resetView); document.removeEventListener("pointerlockchange", pointerLockChange); document.removeEventListener("mousemove", mouseLook); window.removeEventListener("keyup", keyUp); window.removeEventListener("blur", onClearKeys); document.removeEventListener("visibilitychange", onClearKeys); for (const visual of sensorVisuals.values()) disposeSensorVisual(visual); sensorVisuals.clear(); radarGeometry.dispose(); radarMaterial.dispose(); floorSurface.texture.dispose(); floorSurface.bumpTexture.dispose(); wallSurface.texture.dispose(); wallSurface.bumpTexture.dispose(); for (const texture of landmarkTextures) texture.dispose(); disposeObject(scene); renderer.dispose(); renderer.domElement.remove(); };
  }, [awareness, contacts, onClearKeys, onKeyDown, onKeyUp, onSelect, onToggleThreat, options, overlays, sensors, world]);
  return <div className="three-canvas" ref={host}><div className="look-hint" ref={lookHint} hidden>CLICK TO LOOK · ESC TO RELEASE</div></div>;
}
