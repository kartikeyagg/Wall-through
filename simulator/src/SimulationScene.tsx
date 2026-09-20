"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { BONES, skeletonSegments } from "./skeleton.js";
import { createStereoRig } from "./stereo.js";
import type { Skeleton } from "./skeleton.js";
import type { OverlayLayer } from "./overlay.js";
import type { World } from "./simulation.js";
import type { VisionObservation } from "./vision.js";

export type VisionContact = VisionObservation & { kind: "direct" | "shared" };

export type SceneOptions = {
  selected: string;
  mode: "overview" | "glasses";
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
};

type Props = {
  world: React.MutableRefObject<World | null>;
  options: React.MutableRefObject<SceneOptions>;
  contacts: React.MutableRefObject<VisionContact[]>;
  /** Every live track the selected officer knows about, in any direction; drives the glasses HUD arrows. */
  awareness: React.MutableRefObject<VisionContact[]>;
  overlays: React.MutableRefObject<OverlayLayer[]>;
  onSelect: (id: string) => void;
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
// Overview orbit around the arena centre: Ctrl + drag rotates and tilts, Ctrl + wheel zooms, double-click resets.
const defaultOrbit = { azimuth: Math.atan2(8.5, 11.5), elevation: Math.asin(12.5 / Math.hypot(8.5, 12.5, 11.5)), distance: Math.hypot(8.5, 12.5, 11.5) };
const orbitLimits = { minElevation: THREE.MathUtils.degToRad(5), maxElevation: THREE.MathUtils.degToRad(89), minDistance: 5, maxDistance: 32 };
const orbitRadiansPerPixel = 0.006;
// Glasses HUD: one arrow per live contact on a ring around the view centre, pointing at the target's bearing — up is ahead, down is behind.
const hudDepth = 1, hudRingFraction = 0.62, hudArrowFraction = 0.1;
const point = (x: number, y: number, height = 0) => new THREE.Vector3((x - 500) * scale, height, (y - 340) * scale);

type StereoRigVisual = { group: THREE.Group; lenses: [THREE.Mesh, THREE.Mesh]; imu: THREE.Mesh; compass: THREE.Mesh };
type OfficerVisual = { body: THREE.Mesh; head: THREE.Group; rig: StereoRigVisual; gaze: THREE.Line; gazePosition: THREE.BufferAttribute; gazeMaterial: THREE.LineBasicMaterial; gazePoint: THREE.Mesh };
type FieldVisual = { group: THREE.Group; left: THREE.Mesh; right: THREE.Mesh; overlap: THREE.Line };
type ContactVisual = { arrow: THREE.LineSegments; arrowMaterial: THREE.LineBasicMaterial; trail: THREE.Line; trailPosition: THREE.BufferAttribute; trailColor: THREE.BufferAttribute; ring: THREE.LineLoop; ringMaterial: THREE.LineBasicMaterial; outline: THREE.LineSegments; outlineMaterial: THREE.LineBasicMaterial };
type LinkVisual = { line: THREE.Line; position: THREE.BufferAttribute; distance: THREE.BufferAttribute };
type DirectionArrowVisual = { arrow: THREE.Mesh; material: THREE.MeshBasicMaterial };
type SkeletonVisual = { bones: THREE.LineSegments; bonesMaterial: THREE.LineBasicMaterial; bonesPosition: THREE.BufferAttribute; bonesColor: THREE.BufferAttribute; joints: THREE.Points; jointsMaterial: THREE.PointsMaterial; jointsPosition: THREE.BufferAttribute; jointsColor: THREE.BufferAttribute; tint: number; color: THREE.Color };

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

function makePerson(color: string, { skin = "#b9795a", accent = "#1d2831", includeHead = true, role = "civilian" } = {}) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 5, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.55, transparent: true }));
  body.position.y = 0.38;
  group.add(body);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.12), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 })); vest.position.set(0, 0.5, 0.145); group.add(vest);
  const limb = (x: number, y: number, length: number) => { const pivot = new THREE.Group(); pivot.position.set(x, y, 0); const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, length - 0.09, 3, 7), new THREE.MeshStandardMaterial({ color: role === "officer" ? "#18252f" : color, roughness: 0.75 })); mesh.position.y = -length / 2; pivot.add(mesh); group.add(pivot); return pivot; };
  const leftArm = limb(-0.19, 0.62, 0.31), rightArm = limb(0.19, 0.62, 0.31), leftLeg = limb(-0.08, 0.23, 0.38), rightLeg = limb(0.08, 0.23, 0.38);
  if (includeHead) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.72 })); head.position.y = 0.86;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#241914", roughness: 0.9 })); hair.position.y = 0.9;
    group.add(head, hair);
  }
  group.userData.human = { body, leftArm, rightArm, leftLeg, rightLeg, phase: role === "officer" ? 0 : 1.7, last: null as null | { x: number; y: number; time: number } };
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
  const human = group.userData.human as { body: THREE.Mesh; leftArm: THREE.Group; rightArm: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group; phase: number; last: { x: number; y: number; time: number } | null } | undefined;
  if (!human) return;
  const previous = human.last, moved = previous ? Math.hypot(agent.x - previous.x, agent.y - previous.y) / Math.max(time - previous.time, 1 / 60) : 0;
  human.last = { x: agent.x, y: agent.y, time };
  const stride = THREE.MathUtils.clamp(moved / 44, 0.08, 0.75), swing = Math.sin(time * (5 + stride * 5) + human.phase) * stride;
  human.leftArm.rotation.x = swing; human.rightArm.rotation.x = -swing; human.leftLeg.rotation.x = -swing; human.rightLeg.rotation.x = swing;
  human.body.position.y = 0.38 + Math.abs(swing) * 0.018;
}

function makeEnvironmentTexture(kind: "floor" | "wall") {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.fillStyle = kind === "floor" ? "#1a3036" : "#42535a"; context.fillRect(0, 0, 256, 256);
  if (kind === "floor") {
    context.strokeStyle = "#29454c"; context.lineWidth = 3;
    for (let offset = 0; offset <= 256; offset += 32) { context.beginPath(); context.moveTo(offset, 0); context.lineTo(offset, 256); context.moveTo(0, offset); context.lineTo(256, offset); context.stroke(); }
    context.fillStyle = "#33545a"; for (let index = 0; index < 90; index++) { const x = (index * 47) % 256, y = (index * 83) % 256; context.fillRect(x, y, 2, 2); }
  } else {
    context.fillStyle = "#67777b"; context.fillRect(0, 116, 256, 20); context.fillStyle = "#27363d"; context.fillRect(0, 136, 256, 5);
    context.strokeStyle = "#7d8d8e"; context.lineWidth = 2; for (let offset = 16; offset < 256; offset += 48) { context.beginPath(); context.moveTo(offset, 0); context.lineTo(offset, 116); context.stroke(); }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; return texture;
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
  const outlineMaterial = new THREE.LineBasicMaterial({ color: "#bcf574", transparent: true }), outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.62, 1.8, 0.62)), outlineMaterial);
  return { arrow, arrowMaterial, trail, trailPosition, trailColor, ring, ringMaterial, outline, outlineMaterial };
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

export default function SimulationScene({ world, options, contacts, awareness, overlays, onSelect, onKeyDown, onKeyUp, onClearKeys }: Props) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor("#101a20"); renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "Interactive 3D simulation. Click an officer to select. Use W A S D or arrows to move, Q and E to turn, and Space to pause. Hold Control and drag to rotate and tilt the view, Control and scroll to zoom, double-click to reset the view."); element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), fog = new THREE.Fog("#101a20", 12, 28); scene.fog = fog;
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 50); scene.add(new THREE.HemisphereLight("#b9dbed", "#091016", 2.1));
    const light = new THREE.DirectionalLight("#d9f5ff", 2.5); light.position.set(5, 10, 3); scene.add(light);
    const floorTexture = makeEnvironmentTexture("floor"), wallTexture = makeEnvironmentTexture("wall"); floorTexture.repeat.set(8, 5);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 13.6), new THREE.MeshStandardMaterial({ color: "#8ca5a7", map: floorTexture, roughness: 0.95 })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const grid = new THREE.GridHelper(20, 25, "#293a43", "#1b2a32"); grid.position.y = 0.005; scene.add(grid);
    const people = new Map<string, THREE.Group>(), officerVisuals = new Map<string, OfficerVisual>(), gazeGroup = new THREE.Group(), fields = new Map<string, FieldVisual>(), contactVisuals = new Map<string, ContactVisual>(), directSkeletonVisuals = new Map<string, SkeletonVisual>(), overlaySkeletonVisuals = new Map<string, SkeletonVisual>(), freeOverlaySkeletonVisuals: SkeletonVisual[] = [], linkVisuals = new Map<string, LinkVisual>(), directionArrows = new Map<string, DirectionArrowVisual>();
    const linkGroup = new THREE.Group(), fovGroup = new THREE.Group(), wallGroup = new THREE.Group(), contactGroup = new THREE.Group(), skeletonGroup = new THREE.Group(); scene.add(linkGroup, fovGroup, wallGroup, contactGroup, skeletonGroup, gazeGroup);
    // The HUD rides on the camera, so it must be in the scene graph for its children to render.
    const hudGroup = new THREE.Group(); hudGroup.position.z = -hudDepth; camera.add(hudGroup); scene.add(camera);
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let lastWorld: World | null = null;
    const clearGroup = (group: THREE.Group) => { for (const child of [...group.children]) { group.remove(child); disposeObject(child); } };
    const rebuild = (w: World) => {
      for (const person of people.values()) { scene.remove(person); disposeObject(person); }
      clearGroup(fovGroup); clearGroup(wallGroup); clearGroup(contactGroup); clearGroup(linkGroup); clearGroup(skeletonGroup); clearGroup(gazeGroup); clearGroup(hudGroup); people.clear(); officerVisuals.clear(); fields.clear(); contactVisuals.clear(); directSkeletonVisuals.clear(); overlaySkeletonVisuals.clear(); freeOverlaySkeletonVisuals.length = 0; linkVisuals.clear(); directionArrows.clear();
      for (const wall of w.walls) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w * scale, 2.2, wall.h * scale), new THREE.MeshStandardMaterial({ color: "#b4c3c3", map: wallTexture, roughness: 0.72 })); mesh.position.copy(point(wall.x + wall.w / 2, wall.y + wall.h / 2, 1.1)); const stripe = new THREE.Mesh(new THREE.BoxGeometry(wall.w * scale + 0.002, 0.09, wall.h * scale + 0.002), new THREE.MeshBasicMaterial({ color: "#f0ad4e" })); stripe.position.y = 0.62; mesh.add(stripe); wallGroup.add(mesh); }
      for (const officer of w.officers) { const { group: person, visual } = makeOfficer("#76baff"); person.userData.officerId = officer.id; people.set(officer.id, person); officerVisuals.set(officer.id, visual); scene.add(person); gazeGroup.add(visual.gaze, visual.gazePoint); const field = makeField(options.current.range, options.current.fov); fields.set(officer.id, field); fovGroup.add(field.group); }
      for (const [index, target] of w.targets.entries()) {
        const outfits = [["#d76c5f", "#493235", "#b77b5f"], ["#d5a64d", "#32485a", "#d5a27d"], ["#a56ab6", "#263c4b", "#8f5e47"]] as const, outfit = outfits[index % outfits.length];
        const person = makePerson(outfit[0], { accent: outfit[1], skin: outfit[2] }); people.set(target.id, person); scene.add(person);
        const visual = makeContactVisual(); contactVisuals.set(target.id, visual); contactGroup.add(visual.arrow, visual.trail, visual.ring, visual.outline);
        const direction = makeDirectionArrow(); directionArrows.set(target.id, direction); hudGroup.add(direction.arrow);
        const skeletonVisual = makeSkeletonVisual(); directSkeletonVisuals.set(target.id, skeletonVisual); skeletonGroup.add(skeletonVisual.bones, skeletonVisual.joints);
        const geometry = new THREE.BufferGeometry(), position = new THREE.BufferAttribute(new Float32Array(6), 3), distance = new THREE.BufferAttribute(new Float32Array(2), 1); geometry.setAttribute("position", position); geometry.setAttribute("lineDistance", distance);
        const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: "#bcf574", dashSize: 0.12, gapSize: 0.12, transparent: true, opacity: 0.65 })); line.visible = false; linkGroup.add(line); linkVisuals.set(target.id, { line, position, distance });
      }
      lastWorld = w;
    };
    const resize = () => { const { width, height } = element.getBoundingClientRect(); renderer.setSize(Math.max(width, 1), Math.max(height, 1), false); camera.aspect = Math.max(width, 1) / Math.max(height, 1); camera.updateProjectionMatrix(); };
    const orbit = { ...defaultOrbit }; let drag: { x: number; y: number } | null = null;
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
    const select = (event: PointerEvent) => { renderer.domElement.focus(); if (event.ctrlKey) { startDrag(event); return; } const bounds = renderer.domElement.getBoundingClientRect(); pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1); raycaster.setFromCamera(pointer, camera); const officerOf = (object: THREE.Object3D | null): string | undefined => object ? object.userData.officerId ?? officerOf(object.parent) : undefined; const id = raycaster.intersectObjects([...people.values()], true).map((item) => officerOf(item.object)).find(Boolean); if (id) onSelect(id); };
    const keyDown = (event: KeyboardEvent) => { const key = event.key.toLowerCase(); if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) { event.preventDefault(); onKeyDown(key, event.repeat); } };
    const keyUp = (event: KeyboardEvent) => onKeyUp(event.key.toLowerCase());
    const observer = new ResizeObserver(resize); observer.observe(element); renderer.domElement.addEventListener("pointerdown", select); renderer.domElement.addEventListener("pointermove", moveDrag); renderer.domElement.addEventListener("pointerup", endDrag); renderer.domElement.addEventListener("pointercancel", endDrag); renderer.domElement.addEventListener("wheel", zoom, { passive: false }); renderer.domElement.addEventListener("dblclick", resetView); renderer.domElement.addEventListener("keydown", keyDown); window.addEventListener("keyup", keyUp); window.addEventListener("blur", onClearKeys); document.addEventListener("visibilitychange", onClearKeys); resize();
    let frame = 0, pulse = 0;
    const render = () => {
      const w = world.current, settings = options.current;
      if (w) {
        if (w !== lastWorld || people.size !== w.officers.length + w.targets.length) rebuild(w);
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
        const live = new Map(contacts.current.map((item) => [item.targetId, item])), known = new Map(awareness.current.map((item) => [item.targetId, item]));
        for (const target of w.targets) {
          const mesh = people.get(target.id)!, contact = live.get(target.id), visual = contactVisuals.get(target.id)!; mesh.visible = settings.mode === "overview" || Boolean(contact); mesh.position.copy(point(target.x, target.y)); mesh.rotation.y = Math.PI / 2 - target.angle; animateHuman(mesh, target, w.time); ((mesh.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = contact?.coasting ? 0.42 : 1;
          const direction = directionArrows.get(target.id)!; direction.arrow.visible = false;
          const skeletonVisual = directSkeletonVisuals.get(target.id)!; skeletonVisual.bones.visible = false; skeletonVisual.joints.visible = false;
          visual.arrow.visible = Boolean(contact?.moving && settings.vectors); visual.trail.visible = Boolean(contact && settings.trails); visual.ring.visible = Boolean(contact); visual.outline.visible = contact?.kind === "shared"; const link = linkVisuals.get(target.id)!; link.line.visible = false;
          const tracked = known.get(target.id);
          if (tracked && settings.directionArrows && settings.mode === "glasses") {
            // Bearing in the officer's own frame: +forward is up the screen, +right (increasing map angle) is right, behind wraps to the bottom.
            const ox = tracked.x - selected.x, oy = tracked.y - selected.y, forward = ox * Math.cos(selected.angle) + oy * Math.sin(selected.angle), right = -ox * Math.sin(selected.angle) + oy * Math.cos(selected.angle), bearing = Math.atan2(right, forward);
            const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * hudDepth, radius = hudRingFraction * Math.min(halfHeight, halfHeight * camera.aspect), closeness = THREE.MathUtils.clamp(1 - Math.hypot(ox, oy) / Math.max(settings.range, 1), 0.35, 1);
            direction.arrow.position.set(Math.sin(bearing) * radius, Math.cos(bearing) * radius, 0); direction.arrow.rotation.z = -bearing; direction.arrow.scale.setScalar(halfHeight * hudArrowFraction * (0.7 + 0.6 * closeness));
            direction.material.color.set(tracked.kind === "shared" ? "#bcf574" : "#ffd479"); direction.material.opacity = tracked.coasting ? 0.3 + (Math.sin(pulse) + 1) * 0.15 : 0.92; direction.arrow.visible = true;
          }
          if (!contact) continue;
          const contactPoint = point(contact.x, contact.y), shared = contact.kind === "shared", uncertain = contact.coasting; visual.arrow.position.copy(contactPoint); visual.arrow.position.y = 0.055; visual.arrow.rotation.y = Math.PI / 2 - contact.heading; visual.arrow.scale.setScalar(THREE.MathUtils.clamp(contact.speed * scale * 1.4, 0.14, 0.85)); visual.arrowMaterial.color.set(shared ? "#bcf574" : "#ffd479"); visual.arrowMaterial.opacity = uncertain ? 0.42 : 0.9;
          const trail = contact.trail, count = Math.min(trail.length, 64), start = trail.length - count, base = shared ? [0.737, 0.961, 0.455] : [1, 0.831, 0.475];
          for (let index = 0; index < count; index++) { const sample = trail[start + index], fade = 0.16 + 0.84 * (index + 1) / count; visual.trailPosition.setXYZ(index, (sample.x - 500) * scale, 0, (sample.y - 340) * scale); visual.trailColor.setXYZ(index, base[0] * fade, base[1] * fade, base[2] * fade); }
          visual.trailPosition.needsUpdate = true; visual.trailColor.needsUpdate = true; visual.trail.geometry.setDrawRange(0, count); visual.ring.position.copy(contactPoint); visual.ring.position.y = 0.045; visual.ring.scale.setScalar(Math.max(contact.sigma * scale, 0.025)); visual.ringMaterial.color.set(shared ? "#bcf574" : "#ffd479"); visual.ringMaterial.opacity = uncertain ? 0.16 + (Math.sin(pulse) + 1) * 0.12 : 0.48; visual.outline.position.copy(point(contact.x, contact.y, 0.9)); visual.outlineMaterial.opacity = uncertain ? 0.35 : 1;
          if (settings.links && settings.sharing && shared) { const source = w.officers.find((item) => item.id === contact.observers[0]); if (source) { const from = point(source.x, source.y, 0.08), to = point(selected.x, selected.y, 0.08); link.position.setXYZ(0, from.x, from.y, from.z); link.position.setXYZ(1, to.x, to.y, to.z); link.position.needsUpdate = true; link.distance.setX(0, 0); link.distance.setX(1, from.distanceTo(to)); link.distance.needsUpdate = true; link.line.visible = true; } }
          if (settings.skeletons && contact.kind === "direct" && contact.skeleton) { writeSkeleton(contact.skeleton, skeletonVisual, 0.95); skeletonVisual.bones.visible = true; skeletonVisual.joints.visible = true; skeletonVisual.jointsMaterial.opacity = 0.9; }
        }
        const layers = overlays.current, frameIds = new Set(layers.map((layer) => layer.frameId));
        for (const [frameId, visual] of overlaySkeletonVisuals) { if (!frameIds.has(frameId)) { overlaySkeletonVisuals.delete(frameId); visual.bones.visible = false; visual.joints.visible = false; freeOverlaySkeletonVisuals.push(visual); } else { visual.bones.visible = false; visual.joints.visible = false; } }
        if (settings.skeletons && settings.sharing) for (const layer of layers) { let visual = overlaySkeletonVisuals.get(layer.frameId); if (!visual) { visual = freeOverlaySkeletonVisuals.pop(); if (!visual && overlaySkeletonVisuals.size < 48) { visual = makeSkeletonVisual(0.28); skeletonGroup.add(visual.bones, visual.joints); } if (!visual) continue; overlaySkeletonVisuals.set(layer.frameId, visual); } writeSkeleton(layer.skeleton, visual, layer.opacity * settings.overlayOpacity); visual.bones.visible = true; visual.joints.visible = true; }
        if (settings.mode === "glasses") {
          // The view is the rig's view: same eye-level optical centre, level axis, and the rig's horizontal FOV.
          const dx = Math.cos(selected.angle), dy = Math.sin(selected.angle), eyeX = selected.x + dx * headRadius / scale, eyeY = selected.y + dy * headRadius / scale;
          camera.position.copy(point(eyeX, eyeY, eyeHeight)); camera.lookAt(point(eyeX + dx * 100, eyeY + dy * 100, eyeHeight));
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
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener("pointerdown", select); renderer.domElement.removeEventListener("pointermove", moveDrag); renderer.domElement.removeEventListener("pointerup", endDrag); renderer.domElement.removeEventListener("pointercancel", endDrag); renderer.domElement.removeEventListener("wheel", zoom); renderer.domElement.removeEventListener("dblclick", resetView); window.removeEventListener("keyup", keyUp); window.removeEventListener("blur", onClearKeys); document.removeEventListener("visibilitychange", onClearKeys); floorTexture.dispose(); wallTexture.dispose(); disposeObject(scene); renderer.dispose(); element.replaceChildren(); };
  }, [awareness, contacts, onClearKeys, onKeyDown, onKeyUp, onSelect, options, overlays, world]);
  return <div className="three-canvas" ref={host} />;
}
