"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MAX_SENSORS, awareOf, createWorld, recallSensor, stepWorld, throwSensor, visibleTo } from "../src/simulation.js";
import type { World } from "../src/simulation.js";
import SimulationScene, { type SceneOptions, type SensorReport, type VisionContact } from "../src/SimulationScene";
import { ThreatRegistry, scoreClearances } from "../src/classification.js";
import { StereoVisionPipeline, effectiveRange, trackObservations, unitsToMetres } from "../src/vision.js";
import { createStereoRig } from "../src/stereo.js";
import type { OverlayLayer } from "../src/overlay.js";
import { SelfLocalization } from "../src/sensors.js";
import type { LocalizationEstimate } from "../src/sensors.js";

type Settings = SceneOptions & { paused: boolean; sharing: boolean; patrol: boolean; autoRotate: boolean; rotationSpeed: number; speed: number; imu: boolean };
const initial: Settings = { paused: false, selected: "P2", sharing: true, cones: true, links: true, trails: true, vectors: true, directionArrows: true, skeletons: true, overlayOpacity: 0.35, patrol: false, autoRotate: false, rotationSpeed: 30, mode: "overview", range: 420, fov: 117, baseline: 0.08, speed: 1, imu: true, sensorRings: true, radarRange: 432, hideCleared: false };
const rigOptions = (settings: Settings) => ({ rig: { baseline: settings.baseline }, fov: settings.fov * Math.PI / 180, range: settings.range });

export default function Home() {
  const world = useRef<World | null>(null);
  const keys = useRef(new Set<string>());
  const pipeline = useRef(new StereoVisionPipeline(rigOptions(initial)));
  const localizer = useRef(new SelfLocalization());
  const [localization, setLocalization] = useState({ estimate: null as LocalizationEstimate | null, error: 0 });
  const [settings, setSettings] = useState<Settings>(initial);
  const live = useRef(settings);
  const sceneOptions = useRef<SceneOptions>(settings);
  const contactsRef = useRef<VisionContact[]>([]);
  const overlaysRef = useRef<OverlayLayer[]>([]);
  const awarenessRef = useRef<VisionContact[]>([]);
  const sensorsRef = useRef<SensorReport[]>([]);
  // One registry for the whole team: a clearance made by any officer is the
  // team's shared judgement, which is the entire point of detagging.
  const threats = useRef(new ThreatRegistry());
  const [count, setCount] = useState(7);
  const [stats, setStats] = useState({ time: 0, detections: 0, contacts: [] as VisionContact[], heading: 270, sensors: 0, rig: createStereoRig({ baseline: initial.baseline, hfov: initial.fov }), disparity: 0, sigma: 0, published: 0, layers: 0, bypassed: 0, pose: 0, pucks: [] as SensorReport[], radarTracks: 0, returns: 0, cleared: 0, hostile: 0, score: { correctlyCleared: 0, wronglyCleared: 0, missedHostiles: 0, correctlyFlagged: 0 } });
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
      const localizations = localizer.current.update(current, current.time * 1000, { imuEnabled: config.imu });
      const vision = { range: config.range, fov: config.fov * Math.PI / 180 };
      const { detections, tracks, rig, skeletons, bypassed, sensors, radarTracks, radarReturns } = pipeline.current.update(current, current.time * 1000);
      sensorsRef.current = sensors;
      // Annotate before projection so every officer's view carries the same
      // shared correction, and let a clearance outlive a brief loss of track.
      threats.current.prune(tracks.map((track) => track.trackId), current.time * 1000);
      const observations = threats.current.annotate(trackObservations(tracks, vision, skeletons, sensors));
      const contacts = visibleTo(current, config.selected, observations, config.sharing);
      contactsRef.current = contacts;
      awarenessRef.current = awareOf(current, config.selected, observations, config.sharing);
      // Ask the bus for the age fade alone; the slider is the operator ceiling the scene applies.
      overlaysRef.current = config.skeletons
        ? pipeline.current.overlaysFor(config.selected, current.time * 1000, { opacity: 1, sharing: config.sharing })
        : [];
      if (now - lastStats > 100) {
        const angle = current.officers.find((officer) => officer.id === config.selected)?.angle ?? 0;
        const estimate = localizations.find((item) => item.officerId === config.selected) ?? null;
        const actual = current.officers.find((officer) => officer.id === config.selected);
        setLocalization({ estimate, error: estimate && actual ? Math.hypot(estimate.position.x - actual.x, estimate.position.z - actual.y) : 0 });
        const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        const counts = threats.current.stats(observations);
        // Lab-only scoring: the officer never sees which body is truly hostile,
        // but the simulator can mark their calls afterwards.
        const truth = Object.fromEntries(current.targets.map((target) => [target.id, Boolean(target.hostile)]));
        setStats({ time: current.time, detections: tracks.length, contacts, heading: ((angle * 180 / Math.PI) % 360 + 360) % 360, sensors: detections.length, rig, disparity: mean(detections.map((item) => item.disparity)), sigma: mean(tracks.map((item) => item.sigma)), published: skeletons.length, layers: overlaysRef.current.length, bypassed, pose: mean(skeletons.map((item) => item.confidence)), pucks: sensors, radarTracks: radarTracks.length, returns: radarReturns, cleared: counts.cleared, hostile: counts.hostile, score: scoreClearances(observations, truth) }); lastStats = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, []);
  const reset = useCallback((members = count) => { world.current = createWorld(members); pipeline.current.reset(); localizer.current.reset(); threats.current.reset(); sensorsRef.current = []; setLocalization({ estimate: null, error: 0 }); keys.current.clear(); setSettings((current) => ({ ...current, selected: "P2" })); }, [count]);
  const throwPuck = useCallback(() => { const current = world.current; if (current) throwSensor(current, live.current.selected, { timestamp: current.time * 1000 }); }, []);
  const recallPuck = useCallback((sensorId: string) => { const current = world.current; if (current) recallSensor(current, sensorId); }, []);
  // Clearing and re-flagging are the same gesture: the operator is correcting
  // the system either way, and both calls are attributed to the acting officer.
  const toggleThreat = useCallback((trackId: string) => { const current = world.current; if (current) threats.current.toggle(trackId, live.current.selected, current.time * 1000); }, []);
  const select = useCallback((id: string) => change("selected", id), [change]);
  const clearKeys = useCallback(() => keys.current.clear(), []);
  const keyDown = useCallback((key: string, repeated: boolean) => { if (key === " " && !repeated) setSettings((current) => ({ ...current, paused: !current.paused })); else if (key === "f" && !repeated) throwPuck(); else keys.current.add(key); }, [throwPuck]);
  const keyUp = useCallback((key: string) => keys.current.delete(key), []);
  const turnSelected = useCallback((direction: number) => { const officer = world.current?.officers.find((item) => item.id === live.current.selected); if (officer) officer.angle = Math.atan2(Math.sin(officer.angle + direction * Math.PI / 12), Math.cos(officer.angle + direction * Math.PI / 12)); }, []);
  const shared = stats.contacts.filter((item) => item.kind === "shared");
  const optics = effectiveRange(stats.rig);
  const reach = effectiveRange(stats.rig, settings.range);
  const localized = localization.estimate;
  const localizationError = localization.error;

  return <main>
    <header className="topbar"><Link className="brand" href="/" aria-label="Wall Through home"><span className="brand-symbol">W<span>/</span></span><strong>WALL THROUGH</strong><span className="version">3D SIMULATOR / 03</span></Link><span className="local"><i /> STEREO VISION · LOCAL</span></header>
    <section className="intro"><div><p className="eyebrow">COLLABORATIVE VISION LAB / 3D</p><h1>See beyond your line of sight<span>.</span></h1><p>Head-mounted stereo cameras and thrown mmWave pucks detect and track moving bodies in a shared three-dimensional world — and the officer decides which of them is a threat.</p></div><div className="scenario"><span>SCENARIO 001</span><strong>Divided hall — 3D</strong><small>Stereo triangulation · Opaque barriers · Motion tracking</small></div></section>
    <div className="workspace"><section className="simulation" aria-label="Simulation workspace">
      <div className="map-toolbar"><div className="tabs" aria-label="View mode"><button className={settings.mode === "overview" ? "active" : ""} aria-pressed={settings.mode === "overview"} onClick={() => change("mode", "overview")}>World overview</button><button className={settings.mode === "glasses" ? "active" : ""} aria-pressed={settings.mode === "glasses"} onClick={() => change("mode", "glasses")}>Officer glasses</button></div><span className="map-state"><i className={settings.paused ? "paused" : ""} />{settings.paused ? "PAUSED" : "LIVE"}<time>{stats.time.toFixed(1)}s</time></span></div>
      <div className="map-wrap"><SimulationScene world={world} options={sceneOptions} contacts={contactsRef} awareness={awarenessRef} overlays={overlaysRef} sensors={sensorsRef} onSelect={select} onToggleThreat={toggleThreat} onKeyDown={keyDown} onKeyUp={keyUp} onClearKeys={clearKeys} /><div className="map-caption">{settings.mode === "overview" ? "3D GROUND TRUTH · all bodies shown for inspection" : `${settings.selected} STEREO RIG · triangulated tracks and teammate feeds`}</div></div>
      <div className="legend"><span><i className="dot police" />Police stereo rig</span><span><i className="diamond" />Triangulated terrorist</span><span><i className="outline" />Fused shared outline</span><span><i className="trail" />Movement trail</span><span><i className="vector" />Velocity vector</span><span><i className="skeleton" />Published pose</span><span><i className="overlay" />Teammate overlay</span><span><i className="radar" />mmWave puck · through-wall track</span><span><i className="cleared" />Cleared by officer</span><span><i className="wall" />Static wall collider</span></div>
      <div className="transport"><button className="primary" onClick={() => change("paused", !settings.paused)}>{settings.paused ? "▶ Resume" : "Ⅱ Pause"}</button><button onClick={() => reset()}>↺ Reset scene</button><button className="throw" onClick={throwPuck} disabled={stats.pucks.length >= MAX_SENSORS} aria-label="Throw mmWave sensor">◎ Throw sensor<small>{stats.pucks.length}/{MAX_SENSORS}</small></button><label className="speed">Speed<select aria-label="Simulation speed" value={settings.speed} onChange={(event) => change("speed", Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label></div>
    </section><aside>
      <section className="panel"><div className="section-heading"><h2>Officer perspective</h2><span className="chip">{settings.selected}</span></div><p className="muted">Click a 3D officer or select one to drive their body and head rig.</p><div className="officers">{Array.from({ length: count }, (_, index) => `P${index + 1}`).map((id) => <button key={id} aria-label={`Select officer ${id}`} aria-pressed={settings.selected === id} className={settings.selected === id ? "selected" : ""} onClick={() => select(id)}>{id}</button>)}</div>
      <div className="turn-controls"><div className="section-heading"><span>Head direction</span><output aria-label="Selected officer heading">{stats.heading.toFixed(0)}°</output></div><div className="turn-buttons"><button onClick={() => turnSelected(-1)} aria-label="Turn selected officer left 15 degrees">↶ Turn left</button><button onClick={() => turnSelected(1)} aria-label="Turn selected officer right 15 degrees">Turn right ↷</button></div><small>15° per click · Q / E for continuous turning</small></div>
      <div className="sharing-row"><div><strong>Shared vision</strong><small>Triangulated tracks have no receiver distance limit</small></div><input aria-label="Shared vision" type="checkbox" role="switch" checked={settings.sharing} onChange={(event) => change("sharing", event.target.checked)} /></div>
      <div className="metrics"><div><strong>{stats.contacts.filter((item) => item.kind === "direct").length}</strong><span>DIRECT</span></div><div><strong className="lime">{shared.length}</strong><span>SHARED</span></div><div><strong className="violet">{stats.radarTracks}</strong><span>RADAR</span></div><div><strong>{stats.detections}<small>/3</small></strong><span>LIVE TRACKS</span></div></div></section>
      <section className="panel"><div className="section-heading"><h2>Self localization</h2><span className="tiny">{settings.imu ? "STEREO + COMPASS + IMU" : "STEREO + COMPASS"}</span></div><div className="vision-readout"><div><strong>{localized ? unitsToMetres(localized.position.x).toFixed(1) : "—"}<small>m</small></strong><span>LOCAL X</span></div><div><strong>{localized ? unitsToMetres(localized.position.z).toFixed(1) : "—"}<small>m</small></strong><span>LOCAL Z</span></div><div><strong>{localized ? ((localized.orientation.yaw * 180 / Math.PI % 360 + 360) % 360).toFixed(0) : "—"}<small>°</small></strong><span>COMPASS</span></div><div><strong>{(unitsToMetres(localizationError) * 100).toFixed(0)}<small>cm</small></strong><span>SIM ERROR</span></div></div><p className="rig-note">Stereo map features and compass create the primary pose. The optional IMU is then integrated with a deliberately noisy, low-weight correction.</p></section>
      <section className="panel"><div className="section-heading"><h2>mmWave sensor net</h2><span className="tiny">{stats.pucks.filter((puck) => puck.active).length}/{stats.pucks.length} ACTIVE</span></div>
      <p className="muted">Throw a puck with <kbd>F</kbd> or the toolbar button. It cannot report where it landed — officers geolocate it with their stereo cameras, and only then do its returns become tracks.</p>
      <div className="pucks">{stats.pucks.length ? stats.pucks.map((puck) => {
        const state = puck.state === "flight" ? "IN FLIGHT" : puck.located ? "LOCATED" : puck.fixes ? "TAGGING" : "UNLOCATED";
        return <div className={puck.active ? "puck active" : "puck"} key={puck.id}><span className="puck-icon">◎</span><div><strong>{puck.id} <span className="puck-state">{state}</span></strong><small>{puck.located && puck.position ? `${unitsToMetres(puck.position.x).toFixed(1)} m, ${unitsToMetres(puck.position.y).toFixed(1)} m · ±${(unitsToMetres(puck.sigma) * 100).toFixed(0)} cm · ${puck.fixes} fix${puck.fixes === 1 ? "" : "es"}` : puck.state === "flight" ? "Airborne — nothing to fix yet" : puck.fixes ? `Fixing from ${puck.observers.join(", ")}` : "No camera can see this puck"}</small></div><span className="puck-returns">{puck.active ? `${puck.confirmed}◇` : "—"}</span><button onClick={() => recallPuck(puck.id)} aria-label={`Recall sensor ${puck.id}`}>Recall</button></div>;
      }) : <p className="empty">No pucks deployed.<br />Throw one to see through a wall.</p>}</div>
      <div className="vision-readout"><div><strong>{stats.returns}</strong><span>RETURNS/FR</span></div><div><strong className="violet">{stats.radarTracks}</strong><span>RADAR TRACKS</span></div><div><strong>{unitsToMetres(settings.radarRange).toFixed(0)}<small>m</small></strong><span>RADAR REACH</span></div></div>
      <p className="rig-note">Radar sees moving bodies through drywall, so a puck reports people no camera can. Each wall crossing costs signal: clear air reaches {unitsToMetres(settings.radarRange).toFixed(0)} m, one wall about {(unitsToMetres(settings.radarRange) * 0.64).toFixed(0)} m, and nothing survives three. Range is precise and bearing is not, so a radar track is an ellipse stretched across the puck’s line of sight until stereo fuses with it.</p></section>
      <section className="panel"><div className="section-heading"><h2>Stereo rig telemetry</h2><span className="tiny">{stats.sensors} FRAMES</span></div>
      <div className="vision-readout"><div><strong>{(stats.rig.baseline * 100).toFixed(1)}<small>cm</small></strong><span>BASELINE</span></div><div><strong>{stats.rig.focalPx.toFixed(0)}<small>px</small></strong><span>FOCAL</span></div><div><strong>{stats.disparity.toFixed(1)}<small>px</small></strong><span>DISPARITY</span></div><div><strong>{unitsToMetres(reach).toFixed(1)}<small>m</small></strong><span>REACH</span></div><div><strong>{unitsToMetres(stats.sigma).toFixed(2)}<small>m</small></strong><span>DEPTH σ</span></div><div><strong>{stats.rig.imageWidth}<small>×{stats.rig.imageHeight}</small></strong><span>SENSOR</span></div></div>
      <p className="rig-note">Depth comes from disparity, so range error grows with the square of distance. A wider baseline triangulates further; a narrower one loses distant targets first.</p></section>
      <section className="panel"><div className="section-heading"><h2>Pose overlays</h2><span className="tiny">{(settings.overlayOpacity * 100).toFixed(0)}% ALPHA</span></div>
      <div className="overlay-readout"><div><strong>{stats.published}</strong><span>PUBLISHED</span></div><div><strong className="lime">{stats.layers}</strong><span>RECEIVED</span></div><div><strong>{(stats.pose * 100).toFixed(0)}<small>%</small></strong><span>JOINT CONF</span></div><div><strong>{stats.bypassed}</strong><span>BYPASSED</span></div></div>
      <label>Overlay opacity <output>{(settings.overlayOpacity * 100).toFixed(0)}%</output><input aria-label="Overlay opacity" type="range" min="0" max="100" step="5" value={Math.round(settings.overlayOpacity * 100)} onChange={(event) => change("overlayOpacity", Number(event.target.value) / 100)} /></label>
      <p className="overlay-note">An officer who resolves a subject publishes an 18-joint pose; teammates paint it over their own feed. The overlay is a drawing, so the detector never sees it — BYPASSED counts the layers it refused this frame.</p></section>
      <section className="panel"><div className="section-heading"><h2>Live vision tracks</h2><span className="tiny">{stats.hostile} FLAGGED · {stats.cleared} CLEARED</span></div>
      <p className="muted">The system flags every body it detects. It cannot tell a terrorist from a bystander — that call is yours. Clear a false positive here or by clicking the person in the 3D view; the whole team sees it.</p>
      <div className="contacts" aria-live="off">{stats.contacts.length ? stats.contacts.map((contact) => { const cleared = contact.threat === "cleared"; return <div className={`contact${contact.coasting ? " coasting" : ""}${cleared ? " cleared" : ""}`} key={contact.targetId}><span className={cleared ? "contact-icon cleared" : contact.radar && !contact.stereo ? "contact-icon radar" : contact.skeleton ? "contact-icon posed" : contact.moving ? "contact-icon moving" : contact.kind === "shared" ? "contact-icon shared" : "contact-icon"}>{cleared ? "○" : "◇"}</span><div><strong>{contact.targetId} <span>{cleared ? "CLEARED" : contact.kind === "shared" ? "SHARED" : "DIRECT"}</span> {contact.radar ? <span className="radar-tag">{contact.stereo ? "FUSED" : "RADAR"}</span> : null} {contact.skeleton && !cleared ? <span className="pose">POSE {(contact.skeleton.confidence * 100).toFixed(0)}%</span> : null} <span className="motion">{unitsToMetres(contact.speed).toFixed(1)} m/s · {(((contact.heading * 180 / Math.PI) % 360 + 360) % 360).toFixed(0)}°</span></strong><small>{cleared ? `Not a terrorist — cleared by ${contact.clearedBy ?? "an officer"}` : contact.coasting ? "Predicted — no sensor currently resolves this target" : `Live sensor reports: ${contact.observers.join(", ")}`}</small></div><button className={cleared ? "detag restore" : "detag"} onClick={() => toggleThreat(contact.targetId)} aria-label={cleared ? `Re-flag ${contact.targetId} as a threat` : `Clear ${contact.targetId} as a false positive`}>{cleared ? "Re-flag" : "Not a terrorist"}</button></div>; }) : <p className="empty">No confirmed live tracks in this officer’s view.<br />Rotate, move, or select another officer.</p>}</div>
      <div className="overlay-readout"><div><strong className="lime">{stats.score.correctlyCleared}</strong><span>RIGHT CLEARS</span></div><div><strong className="warn">{stats.score.wronglyCleared}</strong><span>WRONG CLEARS</span></div><div><strong>{stats.score.correctlyFlagged}</strong><span>HOSTILE HELD</span></div><div><strong>{stats.score.missedHostiles}</strong><span>STILL FLAGGED</span></div></div>
      <p className="overlay-note">Lab scoring only, against ground truth no officer or sensor can read: one of the three people in this hall is hostile. Clearing that one is the dangerous mistake; leaving a bystander flagged is only a nuisance.</p></section>
      <section className="panel configuration"><h2>Simulation settings</h2><label>Police members <output>{count}</output><input aria-label="Police members" type="range" min="5" max="10" value={count} onChange={(event) => { const members = Number(event.target.value); setCount(members); reset(members); }} /></label><label>Camera field of view <output>{settings.fov}°</output><input aria-label="Camera field of view" type="range" min="40" max="160" value={settings.fov} onChange={(event) => change("fov", Number(event.target.value))} /></label><label>Stereo baseline <output>{(settings.baseline * 100).toFixed(0)} cm</output><input aria-label="Stereo baseline" type="range" min="2" max="30" step="1" value={Math.round(settings.baseline * 100)} onChange={(event) => change("baseline", Number(event.target.value) / 100)} /></label><label>Camera range <output>{settings.range} units</output><input aria-label="Camera range" type="range" min="100" max="650" step="10" value={settings.range} onChange={(event) => change("range", Number(event.target.value))} /></label><p className="muted">Detection reaches {reach.toFixed(0)} units — the tighter of the {optics.toFixed(0)}-unit optical limit and this slider.</p><div className="rotation-controls"><button className={settings.autoRotate ? "rotation-toggle scanning" : "rotation-toggle"} aria-pressed={settings.autoRotate} onClick={() => change("autoRotate", !settings.autoRotate)}>{settings.autoRotate ? "Stop automatic rotation" : "Start automatic rotation"}</button><p className="muted">All officers scan in place. Stop preserves headings.</p><label>Rotation speed <output>{settings.rotationSpeed}°/s</output><input aria-label="Rotation speed" type="range" min="5" max="180" step="5" value={settings.rotationSpeed} onChange={(event) => change("rotationSpeed", Number(event.target.value))} /></label></div><div className="toggles">{([ ["cones", "Vision cones"], ["links", "Communication links"], ["trails", "Movement trails"], ["vectors", "Velocity vectors"], ["directionArrows", "Direction arrows"], ["skeletons", "Skeleton overlay"], ["sensorRings", "Radar coverage rings"], ["hideCleared", "Hide cleared people"], ["imu", "IMU integration"], ["patrol", "Automatic police patrol"] ] as const).map(([key, label]) => <label key={key}><span>{label}</span><input aria-label={label} type="checkbox" checked={settings[key]} onChange={(event) => change(key, event.target.checked)} /></label>)}</div></section>
    </aside></div>
    <section className="explanation"><div><span className="step">01</span><h3>See</h3><p>A head-mounted stereo pair projects each target into two image planes.</p></div><div><span className="step">02</span><h3>Triangulate</h3><p>Disparity between the two views gives depth, and with it a 3D position and its error.</p></div><div><span className="step">03</span><h3>Track</h3><p>A constant-velocity filter fuses observers into one live track with velocity and heading.</p></div><div><span className="step">04</span><h3>Share</h3><p>The seeing officer publishes an 18-joint pose; teammates paint it faintly over their own feed, and the detector bypasses it.</p></div><div><span className="step">05</span><h3>Probe</h3><p>A thrown mmWave puck, geolocated by the cameras that can see it, tracks moving bodies through the wall with its own Kalman filter.</p></div><div><span className="step">06</span><h3>Judge</h3><p>Sensors flag people, not intent. An officer clears the false positives, and that correction reaches the whole team.</p></div></section>
    <footer>WALL THROUGH · 3D STEREO VISION · HEAD-MOUNTED RIG PIPELINE</footer>
  </main>;
}
