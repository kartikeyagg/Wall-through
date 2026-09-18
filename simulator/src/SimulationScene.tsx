"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { BONES, skeletonSegments } from "./skeleton.js";
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
  baseline: number;
  range: number;
  fov: number;
};

type Props = {
  world: React.MutableRefObject<World | null>;
  options: React.MutableRefObject<SceneOptions>;
  contacts: React.MutableRefObject<VisionContact[]>;
  overlays: React.MutableRefObject<OverlayLayer[]>;
  onSelect: (id: string) => void;
  onKeyDown: (key: string, repeated: boolean) => void;
  onKeyUp: (key: string) => void;
  onClearKeys: () => void;
};

const scale = 0.02;
const UNITS_PER_METRE = 24;
const rigMountHeight = 1.55;
const skeletonMinScore = 0.32;
const overlayTintColor = new THREE.Color("#bcf574");
const point = (x: number, y: number, height = 0) => new THREE.Vector3((x - 500) * scale, height, (y - 340) * scale);

type StereoRigVisual = { group: THREE.Group; lenses: [THREE.Mesh, THREE.Mesh]; mountHeight: number };
type FieldVisual = { group: THREE.Group; coverage: THREE.Mesh; left: THREE.Mesh; right: THREE.Mesh; overlap: THREE.Line };
type ContactVisual = { arrow: THREE.LineSegments; arrowMaterial: THREE.LineBasicMaterial; trail: THREE.Line; trailPosition: THREE.BufferAttribute; trailColor: THREE.BufferAttribute; ring: THREE.LineLoop; ringMaterial: THREE.LineBasicMaterial; outline: THREE.LineSegments; outlineMaterial: THREE.LineBasicMaterial };
type LinkVisual = { line: THREE.Line; position: THREE.BufferAttribute; distance: THREE.BufferAttribute };
type SkeletonVisual = { bones: THREE.LineSegments; bonesMaterial: THREE.LineBasicMaterial; bonesPosition: THREE.BufferAttribute; bonesColor: THREE.BufferAttribute; joints: THREE.Points; jointsMaterial: THREE.PointsMaterial; jointsPosition: THREE.BufferAttribute; jointsColor: THREE.BufferAttribute; tint: number; color: THREE.Color };

function makeStereoRig(): StereoRigVisual {
  const group = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.12), new THREE.MeshStandardMaterial({ color: "#101a20", roughness: 0.45, metalness: 0.35 }));
  housing.position.set(0, 0.84, 0.08);
  const makeLens = () => { const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.045, 12), new THREE.MeshStandardMaterial({ color: "#35434d", roughness: 0.22, metalness: 0.7 })); lens.rotation.x = Math.PI / 2; lens.position.set(0, 0.84, 0.16); return lens; };
  const lenses: [THREE.Mesh, THREE.Mesh] = [makeLens(), makeLens()];
  group.add(housing, ...lenses);
  return { group, lenses, mountHeight: rigMountHeight };
}

function makePerson(color: string, stereo = false) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 5, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.55, transparent: true }));
  body.position.y = 0.38;
  group.add(body);
  const heading = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 10), new THREE.MeshBasicMaterial({ color, transparent: true }));
  heading.rotation.x = Math.PI / 2;
  heading.position.set(0, 0.38, 0.32);
  group.add(heading);
  if (stereo) { const rig = makeStereoRig(); rig.group.userData.rig = rig; group.add(rig.group); }
  return group;
}

function makeSector(range: number, fov: number, color: string) {
  const shape = new THREE.Shape(); shape.moveTo(0, 0);
  const radians = fov * Math.PI / 180;
  for (let step = 0; step <= 24; step++) { const angle = -radians / 2 + radians * step / 24; shape.lineTo(Math.sin(angle) * range * scale, Math.cos(angle) * range * scale); }
  shape.lineTo(0, 0);
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.015;
  return mesh;
}

function makeSectorOutline(range: number, fov: number) {
  const vertices = new Float32Array(26 * 3), radians = fov * Math.PI / 180;
  for (let step = 0; step <= 24; step++) { const angle = -radians / 2 + radians * step / 24; vertices[step * 3] = Math.sin(angle) * range * scale; vertices[step * 3 + 2] = Math.cos(angle) * range * scale; }
  vertices[75] = 0; vertices[77] = 0;
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#bcf574", transparent: true, opacity: 0.82 }));
}

function makeField(range: number, fov: number, color: string): FieldVisual {
  const group = new THREE.Group(), coverage = makeSector(range, fov, color), left = makeSector(range, fov, "#76baff"), right = makeSector(range, fov, "#76baff"), overlap = makeSectorOutline(range, fov);
  group.add(coverage, left, right, overlap);
  return { group, coverage, left, right, overlap };
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

export default function SimulationScene({ world, options, contacts, overlays, onSelect, onKeyDown, onKeyUp, onClearKeys }: Props) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor("#101a20"); renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "Interactive 3D simulation. Click an officer to select. Use W A S D or arrows to move, Q and E to turn, and Space to pause."); element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog("#101a20", 12, 28);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 50); scene.add(new THREE.HemisphereLight("#b9dbed", "#091016", 2.1));
    const light = new THREE.DirectionalLight("#d9f5ff", 2.5); light.position.set(5, 10, 3); scene.add(light);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 13.6), new THREE.MeshStandardMaterial({ color: "#14232b", roughness: 0.95 })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const grid = new THREE.GridHelper(20, 25, "#293a43", "#1b2a32"); grid.position.y = 0.005; scene.add(grid);
    const people = new Map<string, THREE.Group>(), fields = new Map<string, FieldVisual>(), contactVisuals = new Map<string, ContactVisual>(), directSkeletonVisuals = new Map<string, SkeletonVisual>(), overlaySkeletonVisuals = new Map<string, SkeletonVisual>(), freeOverlaySkeletonVisuals: SkeletonVisual[] = [], linkVisuals = new Map<string, LinkVisual>();
    const linkGroup = new THREE.Group(), fovGroup = new THREE.Group(), wallGroup = new THREE.Group(), contactGroup = new THREE.Group(), skeletonGroup = new THREE.Group(); scene.add(linkGroup, fovGroup, wallGroup, contactGroup, skeletonGroup);
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let lastWorld: World | null = null;
    const clearGroup = (group: THREE.Group) => { for (const child of [...group.children]) { group.remove(child); disposeObject(child); } };
    const rebuild = (w: World) => {
      for (const person of people.values()) { scene.remove(person); disposeObject(person); }
      clearGroup(fovGroup); clearGroup(wallGroup); clearGroup(contactGroup); clearGroup(linkGroup); clearGroup(skeletonGroup); people.clear(); fields.clear(); contactVisuals.clear(); directSkeletonVisuals.clear(); overlaySkeletonVisuals.clear(); freeOverlaySkeletonVisuals.length = 0; linkVisuals.clear();
      for (const wall of w.walls) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w * scale, 2.2, wall.h * scale), new THREE.MeshStandardMaterial({ color: "#35434d", roughness: 0.72 })); mesh.position.copy(point(wall.x + wall.w / 2, wall.y + wall.h / 2, 1.1)); wallGroup.add(mesh); }
      for (const officer of w.officers) { const person = makePerson("#76baff", true); person.userData.officerId = officer.id; people.set(officer.id, person); scene.add(person); const field = makeField(options.current.range, options.current.fov, officer.id === options.current.selected ? "#bcf574" : "#76baff"); fields.set(officer.id, field); fovGroup.add(field.group); }
      for (const target of w.targets) {
        const person = makePerson("#ff8b79"); people.set(target.id, person); scene.add(person);
        const visual = makeContactVisual(); contactVisuals.set(target.id, visual); contactGroup.add(visual.arrow, visual.trail, visual.ring, visual.outline);
        const skeletonVisual = makeSkeletonVisual(); directSkeletonVisuals.set(target.id, skeletonVisual); skeletonGroup.add(skeletonVisual.bones, skeletonVisual.joints);
        const geometry = new THREE.BufferGeometry(), position = new THREE.BufferAttribute(new Float32Array(6), 3), distance = new THREE.BufferAttribute(new Float32Array(2), 1); geometry.setAttribute("position", position); geometry.setAttribute("lineDistance", distance);
        const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: "#bcf574", dashSize: 0.12, gapSize: 0.12, transparent: true, opacity: 0.65 })); line.visible = false; linkGroup.add(line); linkVisuals.set(target.id, { line, position, distance });
      }
      lastWorld = w;
    };
    const resize = () => { const { width, height } = element.getBoundingClientRect(); renderer.setSize(Math.max(width, 1), Math.max(height, 1), false); camera.aspect = Math.max(width, 1) / Math.max(height, 1); camera.updateProjectionMatrix(); };
    const select = (event: PointerEvent) => { renderer.domElement.focus(); const bounds = renderer.domElement.getBoundingClientRect(); pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects([...people.values()], true).find((item) => item.object.parent?.userData.officerId || item.object.userData.officerId); const group = hit?.object.parent?.userData.officerId ? hit.object.parent : hit?.object; if (group?.userData.officerId) onSelect(group.userData.officerId); };
    const keyDown = (event: KeyboardEvent) => { const key = event.key.toLowerCase(); if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) { event.preventDefault(); onKeyDown(key, event.repeat); } };
    const keyUp = (event: KeyboardEvent) => onKeyUp(event.key.toLowerCase());
    const observer = new ResizeObserver(resize); observer.observe(element); renderer.domElement.addEventListener("pointerdown", select); renderer.domElement.addEventListener("keydown", keyDown); window.addEventListener("keyup", keyUp); window.addEventListener("blur", onClearKeys); document.addEventListener("visibilitychange", onClearKeys); resize();
    let frame = 0, pulse = 0;
    const render = () => {
      const w = world.current, settings = options.current;
      if (w) {
        if (w !== lastWorld || people.size !== w.officers.length + w.targets.length) rebuild(w);
        const selected = w.officers.find((item) => item.id === settings.selected) ?? w.officers[0]; pulse += 0.045;
        for (const officer of w.officers) {
          const mesh = people.get(officer.id)!; mesh.position.copy(point(officer.x, officer.y)); mesh.rotation.y = Math.PI / 2 - officer.angle; ((mesh.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(officer.id === selected.id ? "#bcf574" : "#76baff");
          const rig = (mesh.children[2] as THREE.Group).userData.rig as StereoRigVisual, separation = THREE.MathUtils.clamp(settings.baseline * scale * UNITS_PER_METRE, 0.045, 0.22); rig.lenses[0].position.x = -separation / 2; rig.lenses[1].position.x = separation / 2;
          const field = fields.get(officer.id)!; field.group.position.copy(point(officer.x, officer.y)); field.group.rotation.y = Math.PI / 2 - officer.angle; field.coverage.visible = settings.cones && (settings.mode === "overview" || officer.id === selected.id) && officer.id !== selected.id; field.left.visible = settings.cones && officer.id === selected.id; field.right.visible = field.left.visible; field.overlap.visible = field.left.visible; field.left.position.x = -separation / 2; field.right.position.x = separation / 2; field.overlap.position.z = Math.max(0.045, separation);
        }
        const live = new Map(contacts.current.map((item) => [item.targetId, item]));
        for (const target of w.targets) {
          const mesh = people.get(target.id)!, contact = live.get(target.id), visual = contactVisuals.get(target.id)!; mesh.visible = settings.mode === "overview" || Boolean(contact); mesh.position.copy(point(target.x, target.y)); mesh.rotation.y = Math.PI / 2 - target.angle; ((mesh.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = contact?.coasting ? 0.42 : 1;
          const skeletonVisual = directSkeletonVisuals.get(target.id)!; skeletonVisual.bones.visible = false; skeletonVisual.joints.visible = false;
          visual.arrow.visible = Boolean(contact?.moving && settings.vectors); visual.trail.visible = Boolean(contact && settings.trails); visual.ring.visible = Boolean(contact); visual.outline.visible = contact?.kind === "shared"; const link = linkVisuals.get(target.id)!; link.line.visible = false;
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
        if (settings.mode === "glasses") { const rig = (people.get(selected.id)!.children[2] as THREE.Group).userData.rig as StereoRigVisual; camera.position.copy(point(selected.x, selected.y, rig.mountHeight)); camera.lookAt(point(selected.x + Math.cos(selected.angle) * 100, selected.y + Math.sin(selected.angle) * 100, 1.4)); camera.fov = settings.fov; camera.updateProjectionMatrix(); } else { camera.fov = 48; camera.position.set(8.5, 12.5, 11.5); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); }
      }
      renderer.render(scene, camera); frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener("pointerdown", select); renderer.domElement.removeEventListener("keydown", keyDown); window.removeEventListener("keyup", keyUp); window.removeEventListener("blur", onClearKeys); document.removeEventListener("visibilitychange", onClearKeys); disposeObject(scene); renderer.dispose(); element.replaceChildren(); };
  }, [contacts, onClearKeys, onKeyDown, onKeyUp, onSelect, options, overlays, world]);
  return <div className="three-canvas" ref={host} />;
}
