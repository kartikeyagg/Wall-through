"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createWorld, stepWorld, visibleTo } from "../src/simulation.js";
import type { Contact, World } from "../src/simulation.js";
import SimulationScene, { type SceneOptions } from "../src/SimulationScene";
import { createSimulatedDetectionProvider, SensorFusion, tracksToObservations } from "../src/sensors.js";

type Settings = SceneOptions & { paused: boolean; sharing: boolean; patrol: boolean; autoRotate: boolean; rotationSpeed: number; speed: number };
const initial: Settings = { paused: false, selected: "P2", sharing: true, cones: true, links: true, patrol: false, autoRotate: false, rotationSpeed: 30, mode: "overview", range: 420, fov: 117, speed: 1 };

export default function Home() {
  const world = useRef<World | null>(null);
  const keys = useRef(new Set<string>());
  const fusion = useRef(new SensorFusion());
  const [settings, setSettings] = useState<Settings>(initial);
  const live = useRef(settings);
  const sceneOptions = useRef<SceneOptions>(settings);
  const contactsRef = useRef<Contact[]>([]);
  const [count, setCount] = useState(7);
  const [stats, setStats] = useState({ time: 0, detections: 0, contacts: [] as Contact[], heading: 270, sensors: 0 });
  const change = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value })), []);

  useEffect(() => { live.current = settings; sceneOptions.current = settings; }, [settings]);
  useEffect(() => {
    world.current = createWorld(7);
    let frame = 0; let previous = 0; let lastStats = 0;
    const tick = (now: number) => {
      const current = world.current!; const config = live.current;
      const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0; previous = now;
      const pressed = (a: string, b: string) => Number(keys.current.has(a) || keys.current.has(b));
      if (!config.paused) stepWorld(current, dt * config.speed, { autoPatrol: config.patrol, autoRotate: config.autoRotate, rotationSpeed: config.rotationSpeed * Math.PI / 180, selectedId: config.selected, moveX: pressed("d", "arrowright") - pressed("a", "arrowleft"), moveY: pressed("s", "arrowdown") - pressed("w", "arrowup"), turn: pressed("e", "e") - pressed("q", "q") });
      const vision = { range: config.range, fov: config.fov * Math.PI / 180 };
      const detections = createSimulatedDetectionProvider(current, vision).read(current.time * 1000);
      const tracks = fusion.current.update(detections, current.time * 1000);
      const contacts = visibleTo(current, config.selected, tracksToObservations(tracks, vision), config.sharing);
      contactsRef.current = contacts;
      if (now - lastStats > 100) {
        const angle = current.officers.find((officer) => officer.id === config.selected)?.angle ?? 0;
        setStats({ time: current.time, detections: tracks.length, contacts, heading: ((angle * 180 / Math.PI) % 360 + 360) % 360, sensors: detections.length }); lastStats = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, []);
  const reset = useCallback((members = count) => { world.current = createWorld(members); fusion.current = new SensorFusion(); keys.current.clear(); setSettings((current) => ({ ...current, selected: "P2" })); }, [count]);
  const select = useCallback((id: string) => change("selected", id), [change]);
  const clearKeys = useCallback(() => keys.current.clear(), []);
  const keyDown = useCallback((key: string, repeated: boolean) => { if (key === " " && !repeated) setSettings((current) => ({ ...current, paused: !current.paused })); else keys.current.add(key); }, []);
  const keyUp = useCallback((key: string) => keys.current.delete(key), []);
  const turnSelected = useCallback((direction: number) => { const officer = world.current?.officers.find((item) => item.id === live.current.selected); if (officer) officer.angle = Math.atan2(Math.sin(officer.angle + direction * Math.PI / 12), Math.cos(officer.angle + direction * Math.PI / 12)); }, []);
  const shared = stats.contacts.filter((item) => item.kind === "shared");

  return <main>
    <header className="topbar"><Link className="brand" href="/" aria-label="Wall Through home"><span className="brand-symbol">W<span>/</span></span><strong>WALL THROUGH</strong><span className="version">3D SIMULATOR / 02</span></Link><span className="local"><i /> SENSOR PIPELINE · LOCAL</span></header>
    <section className="intro"><div><p className="eyebrow">COLLABORATIVE VISION LAB / 3D</p><h1>See beyond your line of sight<span>.</span></h1><p>Live sensor tracks rendered in a shared three-dimensional world.</p></div><div className="scenario"><span>SCENARIO 001</span><strong>Divided hall — 3D</strong><small>Kinematic bodies · Opaque barriers · Track fusion</small></div></section>
    <div className="workspace"><section className="simulation" aria-label="Simulation workspace">
      <div className="map-toolbar"><div className="tabs" aria-label="View mode"><button className={settings.mode === "overview" ? "active" : ""} aria-pressed={settings.mode === "overview"} onClick={() => change("mode", "overview")}>World overview</button><button className={settings.mode === "glasses" ? "active" : ""} aria-pressed={settings.mode === "glasses"} onClick={() => change("mode", "glasses")}>Officer glasses</button></div><span className="map-state"><i className={settings.paused ? "paused" : ""} />{settings.paused ? "PAUSED" : "LIVE"}<time>{stats.time.toFixed(1)}s</time></span></div>
      <div className="map-wrap"><SimulationScene world={world} options={sceneOptions} contacts={contactsRef} onSelect={select} onKeyDown={keyDown} onKeyUp={keyUp} onClearKeys={clearKeys} /><div className="map-caption">{settings.mode === "overview" ? "3D GROUND TRUTH · all bodies shown for inspection" : `${settings.selected} GLASSES · live direct and fused shared tracks`}</div></div>
      <div className="legend"><span><i className="dot police" />Police kinematic body</span><span><i className="diamond" />Detected terrorist</span><span><i className="outline" />Fused shared outline</span><span><i className="wall" />Static wall collider</span></div>
      <div className="transport"><button className="primary" onClick={() => change("paused", !settings.paused)}>{settings.paused ? "▶ Resume" : "Ⅱ Pause"}</button><button onClick={() => reset()}>↺ Reset scene</button><label className="speed">Speed<select aria-label="Simulation speed" value={settings.speed} onChange={(event) => change("speed", Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label></div>
    </section><aside>
      <section className="panel"><div className="section-heading"><h2>Officer perspective</h2><span className="chip">{settings.selected}</span></div><p className="muted">Click a 3D officer or select one to drive their body and glasses.</p><div className="officers">{Array.from({ length: count }, (_, index) => `P${index + 1}`).map((id) => <button key={id} aria-label={`Select officer ${id}`} aria-pressed={settings.selected === id} className={settings.selected === id ? "selected" : ""} onClick={() => select(id)}>{id}</button>)}</div>
      <div className="turn-controls"><div className="section-heading"><span>Head direction</span><output aria-label="Selected officer heading">{stats.heading.toFixed(0)}°</output></div><div className="turn-buttons"><button onClick={() => turnSelected(-1)} aria-label="Turn selected officer left 15 degrees">↶ Turn left</button><button onClick={() => turnSelected(1)} aria-label="Turn selected officer right 15 degrees">Turn right ↷</button></div><small>15° per click · Q / E for continuous turning</small></div>
      <div className="sharing-row"><div><strong>Shared vision</strong><small>Sensor-fused tracks have no receiver distance limit</small></div><input aria-label="Shared vision" type="checkbox" role="switch" checked={settings.sharing} onChange={(event) => change("sharing", event.target.checked)} /></div>
      <div className="metrics"><div><strong>{stats.contacts.filter((item) => item.kind === "direct").length}</strong><span>DIRECT</span></div><div><strong className="lime">{shared.length}</strong><span>SHARED</span></div><div><strong>{stats.detections}<small>/3</small></strong><span>LIVE TRACKS</span></div></div></section>
      <section className="panel"><div className="section-heading"><h2>Live sensor tracks</h2><span className="tiny">{stats.sensors} REPORTS</span></div><div className="contacts" aria-live="off">{stats.contacts.length ? stats.contacts.map((contact) => <div className="contact" key={contact.targetId}><span className={contact.kind === "shared" ? "contact-icon shared" : "contact-icon"}>◇</span><div><strong>{contact.targetId} <span>{contact.kind === "shared" ? "SHARED" : "DIRECT"}</span></strong><small>Live sensor reports: {contact.observers.join(", ")}</small></div><i /></div>) : <p className="empty">No confirmed live tracks in this officer’s view.<br />Rotate, move, or select another officer.</p>}</div></section>
      <section className="panel configuration"><h2>Simulation settings</h2><label>Police members <output>{count}</output><input aria-label="Police members" type="range" min="5" max="10" value={count} onChange={(event) => { const members = Number(event.target.value); setCount(members); reset(members); }} /></label><label>Camera field of view <output>{settings.fov}°</output><input aria-label="Camera field of view" type="range" min="40" max="160" value={settings.fov} onChange={(event) => change("fov", Number(event.target.value))} /></label><label>Camera range <output>{settings.range} units</output><input aria-label="Camera range" type="range" min="100" max="650" step="10" value={settings.range} onChange={(event) => change("range", Number(event.target.value))} /></label><p className="muted">Range limits source sensors, not received live tracks.</p><div className="rotation-controls"><button className={settings.autoRotate ? "rotation-toggle scanning" : "rotation-toggle"} aria-pressed={settings.autoRotate} onClick={() => change("autoRotate", !settings.autoRotate)}>{settings.autoRotate ? "Stop automatic rotation" : "Start automatic rotation"}</button><p className="muted">All officers scan in place. Stop preserves headings.</p><label>Rotation speed <output>{settings.rotationSpeed}°/s</output><input aria-label="Rotation speed" type="range" min="5" max="180" step="5" value={settings.rotationSpeed} onChange={(event) => change("rotationSpeed", Number(event.target.value))} /></label></div><div className="toggles">{([ ["cones", "Vision cones"], ["links", "Communication links"], ["patrol", "Automatic police patrol"] ] as const).map(([key, label]) => <label key={key}><span>{label}</span><input aria-label={label} type="checkbox" checked={settings[key]} onChange={(event) => change(key, event.target.checked)} /></label>)}</div></section>
    </aside></div>
    <section className="explanation"><div><span className="step">01</span><h3>Sense</h3><p>Camera, RealSense and LiDAR adapters share one timestamped detection contract.</p></div><div><span className="step">02</span><h3>Fuse</h3><p>Track fusion associates live reports into confident 3D target locations.</p></div><div><span className="step">03</span><h3>Share</h3><p>Officers see direct contacts and teammate-provided 3D outlines.</p></div></section>
    <footer>WALL THROUGH · 3D KINEMATIC SIMULATION · SENSOR ADAPTER READY</footer>
  </main>;
}
