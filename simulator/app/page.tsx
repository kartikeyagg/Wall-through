"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { awareOf, createWorld, stepWorld, visibleTo } from "../src/simulation.js";
import type { World } from "../src/simulation.js";
import SimulationScene, { type SceneOptions, type VisionContact } from "../src/SimulationScene";
import { StereoVisionPipeline, effectiveRange, trackObservations, unitsToMetres } from "../src/vision.js";
import { createStereoRig } from "../src/stereo.js";
import type { OverlayLayer } from "../src/overlay.js";

type Settings = SceneOptions & { paused: boolean; sharing: boolean; patrol: boolean; autoRotate: boolean; rotationSpeed: number; speed: number };
const initial: Settings = { paused: false, selected: "P2", sharing: true, cones: true, links: true, trails: true, vectors: true, directionArrows: true, skeletons: true, overlayOpacity: 0.35, patrol: false, autoRotate: false, rotationSpeed: 30, mode: "overview", range: 420, fov: 117, baseline: 0.08, speed: 1 };
const rigOptions = (settings: Settings) => ({ rig: { baseline: settings.baseline }, fov: settings.fov * Math.PI / 180, range: settings.range });

export default function Home() {
  const world = useRef<World | null>(null);
  const keys = useRef(new Set<string>());
  const pipeline = useRef(new StereoVisionPipeline(rigOptions(initial)));
  const [settings, setSettings] = useState<Settings>(initial);
  const live = useRef(settings);
  const sceneOptions = useRef<SceneOptions>(settings);
  const contactsRef = useRef<VisionContact[]>([]);
  const overlaysRef = useRef<OverlayLayer[]>([]);
  const awarenessRef = useRef<VisionContact[]>([]);
  const [count, setCount] = useState(7);
  const [stats, setStats] = useState({ time: 0, detections: 0, contacts: [] as VisionContact[], heading: 270, sensors: 0, rig: createStereoRig({ baseline: initial.baseline, hfov: initial.fov }), disparity: 0, sigma: 0, published: 0, layers: 0, bypassed: 0, pose: 0 });
  const change = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value })), []);

  useEffect(() => { live.current = settings; sceneOptions.current = settings; }, [settings]);
  // Rebuild the head rig only when its optics actually change; tracks survive a slider drag.
  useEffect(() => { pipeline.current.configure(rigOptions(live.current)); }, [settings.baseline, settings.fov, settings.range]);
  useEffect(() => {
    world.current = createWorld(7);
    let frame = 0; let previous = 0; let lastStats = 0;
    const tick = (now: number) => {
      const current = world.current!; const config = live.current;
      const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0; previous = now;
      const pressed = (a: string, b: string) => Number(keys.current.has(a) || keys.current.has(b));
      if (!config.paused) stepWorld(current, dt * config.speed, { autoPatrol: config.patrol, autoRotate: config.autoRotate, rotationSpeed: config.rotationSpeed * Math.PI / 180, selectedId: config.selected, moveForward: pressed("w", "arrowup") - pressed("s", "arrowdown"), moveRight: pressed("d", "arrowright") - pressed("a", "arrowleft"), turn: pressed("e", "e") - pressed("q", "q") });
      const vision = { range: config.range, fov: config.fov * Math.PI / 180 };
      const { detections, tracks, rig, skeletons, bypassed } = pipeline.current.update(current, current.time * 1000);
      const observations = trackObservations(tracks, vision, skeletons);
      const contacts = visibleTo(current, config.selected, observations, config.sharing);
      contactsRef.current = contacts;
      awarenessRef.current = awareOf(current, config.selected, observations, config.sharing);
      // Ask the bus for the age fade alone; the slider is the operator ceiling the scene applies.
      overlaysRef.current = config.skeletons
        ? pipeline.current.overlaysFor(config.selected, current.time * 1000, { opacity: 1, sharing: config.sharing })
        : [];
      if (now - lastStats > 100) {
        const angle = current.officers.find((officer) => officer.id === config.selected)?.angle ?? 0;
        const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        setStats({ time: current.time, detections: tracks.length, contacts, heading: ((angle * 180 / Math.PI) % 360 + 360) % 360, sensors: detections.length, rig, disparity: mean(detections.map((item) => item.disparity)), sigma: mean(tracks.map((item) => item.sigma)), published: skeletons.length, layers: overlaysRef.current.length, bypassed, pose: mean(skeletons.map((item) => item.confidence)) }); lastStats = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, []);
  const reset = useCallback((members = count) => { world.current = createWorld(members); pipeline.current.reset(); keys.current.clear(); setSettings((current) => ({ ...current, selected: "P2" })); }, [count]);
  const select = useCallback((id: string) => change("selected", id), [change]);
  const clearKeys = useCallback(() => keys.current.clear(), []);
  const keyDown = useCallback((key: string, repeated: boolean) => { if (key === " " && !repeated) setSettings((current) => ({ ...current, paused: !current.paused })); else keys.current.add(key); }, []);
  const keyUp = useCallback((key: string) => keys.current.delete(key), []);
  const turnSelected = useCallback((direction: number) => { const officer = world.current?.officers.find((item) => item.id === live.current.selected); if (officer) officer.angle = Math.atan2(Math.sin(officer.angle + direction * Math.PI / 12), Math.cos(officer.angle + direction * Math.PI / 12)); }, []);
  const shared = stats.contacts.filter((item) => item.kind === "shared");
  const optics = effectiveRange(stats.rig);
  const reach = effectiveRange(stats.rig, settings.range);

  return <main>
    <header className="topbar"><Link className="brand" href="/" aria-label="Wall Through home"><span className="brand-symbol">W<span>/</span></span><strong>WALL THROUGH</strong><span className="version">3D SIMULATOR / 03</span></Link><span className="local"><i /> STEREO VISION · LOCAL</span></header>
    <section className="intro"><div><p className="eyebrow">COLLABORATIVE VISION LAB / 3D</p><h1>See beyond your line of sight<span>.</span></h1><p>Head-mounted stereo cameras detect and track moving targets in a shared three-dimensional world.</p></div><div className="scenario"><span>SCENARIO 001</span><strong>Divided hall — 3D</strong><small>Stereo triangulation · Opaque barriers · Motion tracking</small></div></section>
    <div className="workspace"><section className="simulation" aria-label="Simulation workspace">
      <div className="map-toolbar"><div className="tabs" aria-label="View mode"><button className={settings.mode === "overview" ? "active" : ""} aria-pressed={settings.mode === "overview"} onClick={() => change("mode", "overview")}>World overview</button><button className={settings.mode === "glasses" ? "active" : ""} aria-pressed={settings.mode === "glasses"} onClick={() => change("mode", "glasses")}>Officer glasses</button></div><span className="map-state"><i className={settings.paused ? "paused" : ""} />{settings.paused ? "PAUSED" : "LIVE"}<time>{stats.time.toFixed(1)}s</time></span></div>
      <div className="map-wrap"><SimulationScene world={world} options={sceneOptions} contacts={contactsRef} awareness={awarenessRef} overlays={overlaysRef} onSelect={select} onKeyDown={keyDown} onKeyUp={keyUp} onClearKeys={clearKeys} /><div className="map-caption">{settings.mode === "overview" ? "3D GROUND TRUTH · all bodies shown for inspection" : `${settings.selected} STEREO RIG · triangulated tracks and teammate feeds`}</div></div>
      <div className="legend"><span><i className="dot police" />Police stereo rig</span><span><i className="diamond" />Triangulated terrorist</span><span><i className="outline" />Fused shared outline</span><span><i className="trail" />Movement trail</span><span><i className="vector" />Velocity vector</span><span><i className="skeleton" />Published pose</span><span><i className="overlay" />Teammate overlay</span><span><i className="wall" />Static wall collider</span></div>
      <div className="transport"><button className="primary" onClick={() => change("paused", !settings.paused)}>{settings.paused ? "▶ Resume" : "Ⅱ Pause"}</button><button onClick={() => reset()}>↺ Reset scene</button><label className="speed">Speed<select aria-label="Simulation speed" value={settings.speed} onChange={(event) => change("speed", Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label></div>
    </section><aside>
      <section className="panel"><div className="section-heading"><h2>Officer perspective</h2><span className="chip">{settings.selected}</span></div><p className="muted">Click a 3D officer or select one to drive their body and head rig.</p><div className="officers">{Array.from({ length: count }, (_, index) => `P${index + 1}`).map((id) => <button key={id} aria-label={`Select officer ${id}`} aria-pressed={settings.selected === id} className={settings.selected === id ? "selected" : ""} onClick={() => select(id)}>{id}</button>)}</div>
      <div className="turn-controls"><div className="section-heading"><span>Head direction</span><output aria-label="Selected officer heading">{stats.heading.toFixed(0)}°</output></div><div className="turn-buttons"><button onClick={() => turnSelected(-1)} aria-label="Turn selected officer left 15 degrees">↶ Turn left</button><button onClick={() => turnSelected(1)} aria-label="Turn selected officer right 15 degrees">Turn right ↷</button></div><small>15° per click · Q / E for continuous turning</small></div>
      <div className="sharing-row"><div><strong>Shared vision</strong><small>Triangulated tracks have no receiver distance limit</small></div><input aria-label="Shared vision" type="checkbox" role="switch" checked={settings.sharing} onChange={(event) => change("sharing", event.target.checked)} /></div>
      <div className="metrics"><div><strong>{stats.contacts.filter((item) => item.kind === "direct").length}</strong><span>DIRECT</span></div><div><strong className="lime">{shared.length}</strong><span>SHARED</span></div><div><strong>{stats.detections}<small>/3</small></strong><span>LIVE TRACKS</span></div></div></section>
      <section className="panel"><div className="section-heading"><h2>Stereo rig telemetry</h2><span className="tiny">{stats.sensors} FRAMES</span></div>
      <div className="vision-readout"><div><strong>{(stats.rig.baseline * 100).toFixed(1)}<small>cm</small></strong><span>BASELINE</span></div><div><strong>{stats.rig.focalPx.toFixed(0)}<small>px</small></strong><span>FOCAL</span></div><div><strong>{stats.disparity.toFixed(1)}<small>px</small></strong><span>DISPARITY</span></div><div><strong>{unitsToMetres(reach).toFixed(1)}<small>m</small></strong><span>REACH</span></div><div><strong>{unitsToMetres(stats.sigma).toFixed(2)}<small>m</small></strong><span>DEPTH σ</span></div><div><strong>{stats.rig.imageWidth}<small>×{stats.rig.imageHeight}</small></strong><span>SENSOR</span></div></div>
      <p className="rig-note">Depth comes from disparity, so range error grows with the square of distance. A wider baseline triangulates further; a narrower one loses distant targets first.</p></section>
      <section className="panel"><div className="section-heading"><h2>Pose overlays</h2><span className="tiny">{(settings.overlayOpacity * 100).toFixed(0)}% ALPHA</span></div>
      <div className="overlay-readout"><div><strong>{stats.published}</strong><span>PUBLISHED</span></div><div><strong className="lime">{stats.layers}</strong><span>RECEIVED</span></div><div><strong>{(stats.pose * 100).toFixed(0)}<small>%</small></strong><span>JOINT CONF</span></div><div><strong>{stats.bypassed}</strong><span>BYPASSED</span></div></div>
      <label>Overlay opacity <output>{(settings.overlayOpacity * 100).toFixed(0)}%</output><input aria-label="Overlay opacity" type="range" min="0" max="100" step="5" value={Math.round(settings.overlayOpacity * 100)} onChange={(event) => change("overlayOpacity", Number(event.target.value) / 100)} /></label>
      <p className="overlay-note">An officer who resolves a subject publishes an 18-joint pose; teammates paint it over their own feed. The overlay is a drawing, so the detector never sees it — BYPASSED counts the layers it refused this frame.</p></section>
      <section className="panel"><div className="section-heading"><h2>Live vision tracks</h2><span className="tiny">{stats.contacts.length} IN VIEW</span></div><div className="contacts" aria-live="off">{stats.contacts.length ? stats.contacts.map((contact) => <div className={contact.coasting ? "contact coasting" : "contact"} key={contact.targetId}><span className={contact.skeleton ? "contact-icon posed" : contact.moving ? "contact-icon moving" : contact.kind === "shared" ? "contact-icon shared" : "contact-icon"}>◇</span><div><strong>{contact.targetId} <span>{contact.kind === "shared" ? "SHARED" : "DIRECT"}</span> {contact.skeleton ? <span className="pose">POSE {(contact.skeleton.confidence * 100).toFixed(0)}%</span> : null} <span className="motion">{unitsToMetres(contact.speed).toFixed(1)} m/s · {(((contact.heading * 180 / Math.PI) % 360 + 360) % 360).toFixed(0)}°</span></strong><small>{contact.coasting ? "Predicted — no camera currently resolves this target" : `Live sensor reports: ${contact.observers.join(", ")}`}</small></div><i /></div>) : <p className="empty">No confirmed live tracks in this officer’s view.<br />Rotate, move, or select another officer.</p>}</div></section>
      <section className="panel configuration"><h2>Simulation settings</h2><label>Police members <output>{count}</output><input aria-label="Police members" type="range" min="5" max="10" value={count} onChange={(event) => { const members = Number(event.target.value); setCount(members); reset(members); }} /></label><label>Camera field of view <output>{settings.fov}°</output><input aria-label="Camera field of view" type="range" min="40" max="160" value={settings.fov} onChange={(event) => change("fov", Number(event.target.value))} /></label><label>Stereo baseline <output>{(settings.baseline * 100).toFixed(0)} cm</output><input aria-label="Stereo baseline" type="range" min="2" max="30" step="1" value={Math.round(settings.baseline * 100)} onChange={(event) => change("baseline", Number(event.target.value) / 100)} /></label><label>Camera range <output>{settings.range} units</output><input aria-label="Camera range" type="range" min="100" max="650" step="10" value={settings.range} onChange={(event) => change("range", Number(event.target.value))} /></label><p className="muted">Detection reaches {reach.toFixed(0)} units — the tighter of the {optics.toFixed(0)}-unit optical limit and this slider.</p><div className="rotation-controls"><button className={settings.autoRotate ? "rotation-toggle scanning" : "rotation-toggle"} aria-pressed={settings.autoRotate} onClick={() => change("autoRotate", !settings.autoRotate)}>{settings.autoRotate ? "Stop automatic rotation" : "Start automatic rotation"}</button><p className="muted">All officers scan in place. Stop preserves headings.</p><label>Rotation speed <output>{settings.rotationSpeed}°/s</output><input aria-label="Rotation speed" type="range" min="5" max="180" step="5" value={settings.rotationSpeed} onChange={(event) => change("rotationSpeed", Number(event.target.value))} /></label></div><div className="toggles">{([ ["cones", "Vision cones"], ["links", "Communication links"], ["trails", "Movement trails"], ["vectors", "Velocity vectors"], ["directionArrows", "Direction arrows"], ["skeletons", "Skeleton overlay"], ["patrol", "Automatic police patrol"] ] as const).map(([key, label]) => <label key={key}><span>{label}</span><input aria-label={label} type="checkbox" checked={settings[key]} onChange={(event) => change(key, event.target.checked)} /></label>)}</div></section>
    </aside></div>
    <section className="explanation"><div><span className="step">01</span><h3>See</h3><p>A head-mounted stereo pair projects each target into two image planes.</p></div><div><span className="step">02</span><h3>Triangulate</h3><p>Disparity between the two views gives depth, and with it a 3D position and its error.</p></div><div><span className="step">03</span><h3>Track</h3><p>A constant-velocity filter fuses observers into one live track with velocity and heading.</p></div><div><span className="step">04</span><h3>Share</h3><p>The seeing officer publishes an 18-joint pose; teammates paint it faintly over their own feed, and the detector bypasses it.</p></div></section>
    <footer>WALL THROUGH · 3D STEREO VISION · HEAD-MOUNTED RIG PIPELINE</footer>
  </main>;
}
