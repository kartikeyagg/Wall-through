"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Contact, World } from "./simulation.js";

export type SceneOptions = {
  selected: string;
  mode: "overview" | "glasses";
  cones: boolean;
  links: boolean;
  sharing: boolean;
  range: number;
  fov: number;
};

type Props = {
  world: React.MutableRefObject<World | null>;
  options: React.MutableRefObject<SceneOptions>;
  contacts: React.MutableRefObject<Contact[]>;
  onSelect: (id: string) => void;
  onKeyDown: (key: string, repeated: boolean) => void;
  onKeyUp: (key: string) => void;
  onClearKeys: () => void;
};

const scale = 0.02;
const point = (x: number, y: number, height = 0) => new THREE.Vector3((x - 500) * scale, height, (y - 340) * scale);

function makePerson(color: string) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 5, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
  body.position.y = 0.38;
  group.add(body);
  const heading = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 10), new THREE.MeshBasicMaterial({ color }));
  heading.rotation.x = Math.PI / 2;
  heading.position.set(0, 0.38, 0.32);
  group.add(heading);
  return group;
}

function makeSector(range: number, fov: number, color: string) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  const radians = fov * Math.PI / 180;
  for (let step = 0; step <= 24; step++) {
    const angle = -radians / 2 + radians * step / 24;
    shape.lineTo(Math.sin(angle) * range * scale, Math.cos(angle) * range * scale);
  }
  shape.lineTo(0, 0);
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.015;
  return mesh;
}

export default function SimulationScene({ world, options, contacts, onSelect, onKeyDown, onKeyUp, onClearKeys }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#101a20");
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "Interactive 3D simulation. Click an officer to select. Use W A S D or arrows to move, Q and E to turn, and Space to pause.");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog("#101a20", 12, 28);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 50);
    scene.add(new THREE.HemisphereLight("#b9dbed", "#091016", 2.1));
    const light = new THREE.DirectionalLight("#d9f5ff", 2.5);
    light.position.set(5, 10, 3);
    scene.add(light);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 13.6), new THREE.MeshStandardMaterial({ color: "#14232b", roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const grid = new THREE.GridHelper(20, 25, "#293a43", "#1b2a32");
    grid.position.y = 0.005;
    scene.add(grid);
    const people = new Map<string, THREE.Group>();
    const cones = new Map<string, THREE.Mesh>();
    const outlines = new Map<string, THREE.LineSegments>();
    const linkGroup = new THREE.Group();
    const fovGroup = new THREE.Group();
    const wallGroup = new THREE.Group();
    scene.add(linkGroup, fovGroup, wallGroup);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastWorld: World | null = null;

    const rebuild = (w: World) => {
      for (const item of people.values()) scene.remove(item);
      for (const item of cones.values()) fovGroup.remove(item);
      wallGroup.clear();
      people.clear(); cones.clear(); outlines.clear();
      for (const wall of w.walls) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w * scale, 2.2, wall.h * scale), new THREE.MeshStandardMaterial({ color: "#35434d", roughness: 0.72 }));
        mesh.position.copy(point(wall.x + wall.w / 2, wall.y + wall.h / 2, 1.1));
        wallGroup.add(mesh);
      }
      for (const officer of w.officers) {
        const person = makePerson("#76baff");
        person.userData.officerId = officer.id;
        people.set(officer.id, person);
        scene.add(person);
        const cone = makeSector(options.current.range, options.current.fov, officer.id === options.current.selected ? "#bcf574" : "#76baff");
        cones.set(officer.id, cone);
        fovGroup.add(cone);
      }
      for (const target of w.targets) {
        const person = makePerson("#ff8b79");
        people.set(target.id, person);
        scene.add(person);
      }
      lastWorld = w;
    };

    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(Math.max(width, 1), Math.max(height, 1), false);
      camera.aspect = Math.max(width, 1) / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const select = (event: PointerEvent) => {
      renderer.domElement.focus();
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...people.values()], true).find((item) => item.object.parent?.userData.officerId || item.object.userData.officerId);
      const group = hit?.object.parent?.userData.officerId ? hit.object.parent : hit?.object;
      if (group?.userData.officerId) onSelect(group.userData.officerId);
    };
    const keyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
        event.preventDefault(); onKeyDown(key, event.repeat);
      }
    };
    const keyUp = (event: KeyboardEvent) => onKeyUp(event.key.toLowerCase());
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    renderer.domElement.addEventListener("pointerdown", select);
    renderer.domElement.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", onClearKeys);
    document.addEventListener("visibilitychange", onClearKeys);
    resize();
    let frame = 0;
    const render = () => {
      const w = world.current;
      const settings = options.current;
      if (w) {
        if (w !== lastWorld || people.size !== w.officers.length + w.targets.length) rebuild(w);
        const selected = w.officers.find((item) => item.id === settings.selected) ?? w.officers[0];
        for (const officer of w.officers) {
          const mesh = people.get(officer.id)!;
          mesh.position.copy(point(officer.x, officer.y)); mesh.rotation.y = Math.PI / 2 - officer.angle;
          if (mesh.children[0] instanceof THREE.Mesh)
            ((mesh.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(officer.id === selected.id ? "#bcf574" : "#76baff");
          const cone = cones.get(officer.id)!;
          cone.visible = settings.cones && (settings.mode === "overview" || officer.id === selected.id);
          cone.position.copy(point(officer.x, officer.y)); cone.rotation.y = -Math.PI / 2 - officer.angle;
        }
        const live = new Map(contacts.current.map((item) => [item.targetId, item]));
        for (const target of w.targets) {
          const mesh = people.get(target.id)!;
          const contact = live.get(target.id);
          mesh.visible = settings.mode === "overview" || Boolean(contact);
          mesh.position.copy(point(target.x, target.y)); mesh.rotation.y = Math.PI / 2 - target.angle;
          let outline = outlines.get(target.id);
          if (contact?.kind === "shared") {
            if (!outline) {
              outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.62, 1.8, 0.62)), new THREE.LineBasicMaterial({ color: "#bcf574" }));
              outlines.set(target.id, outline); scene.add(outline);
            }
            outline.position.copy(point(contact.x, contact.y, 0.9)); outline.visible = true;
          } else if (outline) outline.visible = false;
        }
        linkGroup.clear();
        if (settings.links && settings.sharing) for (const contact of contacts.current.filter((item) => item.kind === "shared")) {
          const source = w.officers.find((item) => item.id === contact.observers[0]);
          if (source) {
            const geometry = new THREE.BufferGeometry().setFromPoints([point(source.x, source.y, 0.08), point(selected.x, selected.y, 0.08)]);
            linkGroup.add(new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: "#bcf574", dashSize: 0.12, gapSize: 0.12, transparent: true, opacity: 0.65 })).computeLineDistances());
          }
        }
        if (settings.mode === "glasses") {
          const origin = point(selected.x, selected.y, 1.55);
          camera.position.copy(origin);
          camera.lookAt(point(selected.x + Math.cos(selected.angle) * 100, selected.y + Math.sin(selected.angle) * 100, 1.4));
          camera.fov = settings.fov; camera.updateProjectionMatrix();
        } else {
          camera.fov = 48; camera.position.set(8.5, 12.5, 11.5); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
        }
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener("pointerdown", select); renderer.domElement.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp); window.removeEventListener("blur", onClearKeys); document.removeEventListener("visibilitychange", onClearKeys);
      renderer.dispose(); element.replaceChildren();
    };
  }, [contacts, onClearKeys, onKeyDown, onKeyUp, onSelect, options, world]);
  return <div className="three-canvas" ref={host} />;
}
