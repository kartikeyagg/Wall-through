"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  createWorld,
  stepWorld,
  observe,
  visibleTo,
  segmentBlocked,
  WIDTH,
  HEIGHT,
} from "../src/simulation.js";
import type { World, Contact } from "../src/simulation.js";

type Settings = {
  paused: boolean;
  selected: string;
  sharing: boolean;
  cones: boolean;
  links: boolean;
  patrol: boolean;
  autoRotate: boolean;
  rotationSpeed: number;
  mode: "overview" | "glasses";
  range: number;
  fov: number;
  speed: number;
};
const initial: Settings = {
  paused: false,
  selected: "P2",
  sharing: true,
  cones: true,
  links: true,
  patrol: false,
  autoRotate: false,
  rotationSpeed: 30,
  mode: "overview",
  range: 420,
  fov: 117,
  speed: 1,
};
const colors = {
  blue: "#76baff",
  green: "#bcf574",
  red: "#ff8b79",
  wall: "#39454e",
};

function draw(
  ctx: CanvasRenderingContext2D,
  world: World,
  options: Settings,
  contacts: Contact[],
) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#101a20";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = "#1c2931";
  ctx.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }
  const selected = world.officers.find((o) => o.id === options.selected)!;
  ctx.font = "11px monospace";
  ctx.fillStyle = "#617780";
  ctx.fillText("NORTH HALL / A", 28, 30);
  ctx.fillText("SOUTH HALL / B", 28, HEIGHT - 26);
  if (options.cones)
    for (const officer of world.officers) {
      if (options.mode === "glasses" && officer.id !== selected.id) continue;
      const fov = (options.fov * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(officer.x, officer.y);
      for (let i = 0; i <= 64; i++) {
        const angle = officer.angle - fov / 2 + (fov * i) / 64;
        let lo = 0,
          hi = options.range;
        for (let j = 0; j < 11; j++) {
          const mid = (lo + hi) / 2;
          if (
            segmentBlocked(
              officer,
              {
                x: officer.x + Math.cos(angle) * mid,
                y: officer.y + Math.sin(angle) * mid,
              },
              world.walls,
            )
          )
            hi = mid;
          else lo = mid;
        }
        ctx.lineTo(
          officer.x + Math.cos(angle) * lo,
          officer.y + Math.sin(angle) * lo,
        );
      }
      ctx.closePath();
      ctx.fillStyle = officer.id === selected.id ? "#bcf57418" : "#76baff0d";
      ctx.fill();
    }
  for (const wall of world.walls) {
    ctx.fillStyle = colors.wall;
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    ctx.strokeStyle = "#62717a";
    ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);
  }
  if (options.links && options.sharing)
    for (const contact of contacts.filter((c) => c.kind === "shared")) {
      const source = world.officers.find((o) => o.id === contact.observers[0]);
      if (!source) continue;
      ctx.setLineDash([4, 7]);
      ctx.strokeStyle = "#bcf57466";
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(selected.x, selected.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  for (const target of world.targets) {
    const contact = contacts.find((c) => c.targetId === target.id);
    if (options.mode === "glasses" && !contact) continue;
    const shared = contact?.kind === "shared";
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.strokeStyle = shared ? colors.green : colors.red;
    ctx.lineWidth = 2;
    ctx.fillStyle = shared ? "#bcf5740a" : "#ff8b7940";
    if (shared) {
      ctx.shadowColor = colors.green;
      ctx.shadowBlur = 12;
    }
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(10, 0);
    ctx.lineTo(0, 12);
    ctx.lineTo(-10, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (shared) ctx.strokeRect(-18, -20, 36, 40);
    ctx.shadowBlur = 0;
    ctx.fillStyle = shared ? colors.green : colors.red;
    ctx.font = "11px monospace";
    ctx.fillText(target.id, -8, -27);
    if (shared) {
      ctx.font = "10px monospace";
      ctx.fillText(`VIA ${contact.observers.join(" + ")}`, -22, 35);
    }
    ctx.restore();
  }
  for (const officer of world.officers) {
    const active = officer.id === selected.id;
    ctx.save();
    ctx.translate(officer.x, officer.y);
    if (active) {
      ctx.strokeStyle = colors.green;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 21, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = active ? colors.green : colors.blue;
    ctx.beginPath();
    ctx.arc(0, 0, officer.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(officer.angle);
    ctx.beginPath();
    ctx.moveTo(15, -4);
    ctx.lineTo(23, 0);
    ctx.lineTo(15, 4);
    ctx.fill();
    ctx.rotate(-officer.angle);
    ctx.fillStyle = active ? colors.green : "#a0b4c4";
    ctx.font = "11px monospace";
    ctx.fillText(officer.id, -7, 34);
    ctx.restore();
  }
  if (options.mode === "glasses") {
    ctx.strokeStyle = "#bcf57466";
    ctx.strokeRect(8, 8, WIDTH - 16, HEIGHT - 16);
    ctx.fillStyle = colors.green;
    ctx.font = "12px monospace";
    ctx.fillText(`${selected.id} / GLASSES · TOP-DOWN PROJECTION`, 26, 57);
  }
}

export default function Home() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<World | null>(null);
  const keys = useRef(new Set<string>());
  const [settings, setSettings] = useState<Settings>(initial);
  const live = useRef(settings);
  const [count, setCount] = useState(7);
  const [stats, setStats] = useState<{
    time: number;
    detections: number;
    contacts: Contact[];
    heading: number;
  }>({ time: 0, detections: 0, contacts: [], heading: 270 });
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }
  useEffect(() => {
    live.current = settings;
  }, [settings]);
  useEffect(() => {
    world.current = createWorld(7);
    let frame = 0,
      previous = 0,
      lastStats = 0;
    const tick = (now: number) => {
      const w = world.current!;
      const s = live.current;
      const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      const pressed = (a: string, b: string) =>
        Number(keys.current.has(a) || keys.current.has(b));
      if (!s.paused)
        stepWorld(w, dt * s.speed, {
          autoPatrol: s.patrol,
          autoRotate: s.autoRotate,
          rotationSpeed: (s.rotationSpeed * Math.PI) / 180,
          selectedId: s.selected,
          moveX: pressed("d", "arrowright") - pressed("a", "arrowleft"),
          moveY: pressed("s", "arrowdown") - pressed("w", "arrowup"),
          turn: pressed("e", "e") - pressed("q", "q"),
        });
      const observations = observe(w, {
        range: s.range,
        fov: (s.fov * Math.PI) / 180,
      });
      const contacts = visibleTo(w, s.selected, observations, s.sharing);
      const ctx = canvas.current?.getContext("2d");
      if (ctx) draw(ctx, w, s, contacts);
      if (now - lastStats >= 100) {
        const angle = w.officers.find((officer) => officer.id === s.selected)?.angle ?? 0;
        setStats({ time: w.time, detections: observations.length, contacts, heading: ((angle * 180 / Math.PI) % 360 + 360) % 360 });
        lastStats = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const clear = () => keys.current.clear();
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("blur", clear);
    window.addEventListener("keyup", up);
    document.addEventListener("visibilitychange", clear);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("blur", clear);
      window.removeEventListener("keyup", up);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);
  function reset(n = count) {
    world.current = createWorld(n);
    keys.current.clear();
    live.current = { ...live.current, selected: "P2" };
    setSettings((s) => ({ ...s, selected: "P2" }));
  }
  function turnSelected(direction: number) {
    const officer = world.current?.officers.find((o) => o.id === settings.selected);
    if (!officer) return;
    const angle = officer.angle + direction * Math.PI / 12;
    officer.angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  }
  const shared = stats.contacts.filter((c) => c.kind === "shared");
  return (
    <main>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Wall Through home">
          <span className="brand-symbol">
            W<span>/</span>
          </span>
          <strong>WALL THROUGH</strong>
          <span className="version">SIMULATOR / 01</span>
        </Link>
        <span className="local">
          <i /> LOCAL SIMULATION
        </span>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">COLLABORATIVE VISION LAB</p>
          <h1>
            See beyond your line of sight<span>.</span>
          </h1>
          <p>One officer’s eyes. The whole team’s awareness.</p>
        </div>
        <div className="scenario">
          <span>SCENARIO 001</span>
          <strong>Divided hall</strong>
          <small>Opaque barriers · Shared observations</small>
        </div>
      </section>
      <div className="workspace">
        <section className="simulation" aria-label="Simulation workspace">
          <div className="map-toolbar">
            <div className="tabs" aria-label="View mode">
              <button
                className={settings.mode === "overview" ? "active" : ""}
                aria-pressed={settings.mode === "overview"}
                onClick={() => change("mode", "overview")}
              >
                World overview
              </button>
              <button
                className={settings.mode === "glasses" ? "active" : ""}
                aria-pressed={settings.mode === "glasses"}
                onClick={() => change("mode", "glasses")}
              >
                Officer glasses
              </button>
            </div>
            <span className="map-state">
              <i className={settings.paused ? "paused" : ""} />
              {settings.paused ? "PAUSED" : "LIVE"}
              <time>{stats.time.toFixed(1)}s</time>
            </span>
          </div>
          <div className="map-wrap">
            <canvas
              ref={canvas}
              width={WIDTH}
              height={HEIGHT}
              tabIndex={0}
              aria-label="Interactive simulation map. Click an officer to select. Use W A S D or arrow keys to move, Q and E to rotate, Space to pause."
              onBlur={() => keys.current.clear()}
              onKeyDown={(e) => {
                const key = e.key.toLowerCase();
                if (
                  [
                    "w",
                    "a",
                    "s",
                    "d",
                    "q",
                    "e",
                    "arrowup",
                    "arrowdown",
                    "arrowleft",
                    "arrowright",
                    " ",
                  ].includes(key)
                ) {
                  e.preventDefault();
                  if (key === " " && !e.repeat)
                    setSettings((s) => ({ ...s, paused: !s.paused }));
                  else keys.current.add(key);
                }
              }}
              onPointerDown={(e) => {
                e.currentTarget.focus();
                const r = e.currentTarget.getBoundingClientRect();
                const x = ((e.clientX - r.left) * WIDTH) / r.width,
                  y = ((e.clientY - r.top) * HEIGHT) / r.height;
                const officer = world.current?.officers.find(
                  (o) => Math.hypot(o.x - x, o.y - y) < 30,
                );
                if (officer) change("selected", officer.id);
              }}
            />
            <div className="map-caption">
              {settings.mode === "overview"
                ? "GROUND TRUTH · All agents shown for inspection"
                : `${settings.selected} VISION · Only direct and live shared targets shown`}
            </div>
          </div>
          <div className="legend">
            <span>
              <i className="dot police" />
              Police
            </span>
            <span>
              <i className="diamond" />
              Terrorist
            </span>
            <span>
              <i className="outline" />
              Shared outline
            </span>
            <span>
              <i className="wall" />
              Opaque wall
            </span>
          </div>
          <div className="transport">
            <button
              className="primary"
              onClick={() => change("paused", !settings.paused)}
            >
              {settings.paused ? "▶ Resume" : "Ⅱ Pause"}
            </button>
            <button onClick={() => reset()}>↺ Reset scene</button>
            <label className="speed">
              Speed
              <select
                aria-label="Simulation speed"
                value={settings.speed}
                onChange={(e) => change("speed", Number(e.target.value))}
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </label>
          </div>
        </section>
        <aside>
          <section className="panel">
            <div className="section-heading">
              <h2>Officer perspective</h2>
              <span className="chip">{settings.selected}</span>
            </div>
            <p className="muted">Select an officer to inspect their glasses.</p>
            <div className="officers">
              {Array.from({ length: count }, (_, i) => `P${i + 1}`).map(
                (id) => (
                  <button
                    key={id}
                    aria-label={`Select officer ${id}`}
                    aria-pressed={settings.selected === id}
                    className={settings.selected === id ? "selected" : ""}
                    onClick={() => change("selected", id)}
                  >
                    {id}
                  </button>
                ),
              )}
            </div>
            <div className="turn-controls">
              <div className="section-heading">
                <span>Head direction</span>
                <output aria-label="Selected officer heading">{stats.heading.toFixed(0)}°</output>
              </div>
              <div className="turn-buttons">
                <button onClick={() => turnSelected(-1)} aria-label="Turn selected officer left 15 degrees">↶ Turn left</button>
                <button onClick={() => turnSelected(1)} aria-label="Turn selected officer right 15 degrees">Turn right ↷</button>
              </div>
              <small>15° per click · Q / E for continuous turning</small>
            </div>
            <div className="sharing-row">
              <div>
                <strong>Shared vision</strong>
                <small>No distance limit for received outlines</small>
              </div>
              <input
                aria-label="Shared vision"
                type="checkbox"
                role="switch"
                checked={settings.sharing}
                onChange={(e) => change("sharing", e.target.checked)}
              />
            </div>
            <div className="metrics">
              <div>
                <strong>
                  {stats.contacts.filter((c) => c.kind === "direct").length}
                </strong>
                <span>DIRECT</span>
              </div>
              <div>
                <strong className="lime">{shared.length}</strong>
                <span>SHARED</span>
              </div>
              <div>
                <strong>
                  {stats.detections}
                  <small>/3</small>
                </strong>
                <span>TEAM SEES</span>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Live observations</h2>
              <span className="tiny">{stats.contacts.length} CONTACTS</span>
            </div>
            <div className="contacts" aria-live="off">
              {stats.contacts.length ? (
                stats.contacts.map((c) => (
                  <div className="contact" key={c.targetId}>
                    <span
                      className={
                        c.kind === "shared"
                          ? "contact-icon shared"
                          : "contact-icon"
                      }
                    >
                      ◇
                    </span>
                    <div>
                      <strong>
                        {c.targetId}{" "}
                        <span>{c.kind === "shared" ? "SHARED" : "DIRECT"}</span>
                      </strong>
                      <small>Observed by {c.observers.join(", ")}</small>
                    </div>
                    <i />
                  </div>
                ))
              ) : (
                <p className="empty">
                  No live contacts in this officer’s view.
                  <br />
                  Rotate, move, or select another officer.
                </p>
              )}
            </div>
          </section>
          <section className="panel configuration">
            <h2>Simulation settings</h2>
            <label>
              Police members <output>{count}</output>
              <input
                aria-label="Police members"
                type="range"
                min="5"
                max="10"
                value={count}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setCount(n);
                  reset(n);
                }}
              />
            </label>
            <label>
              Camera field of view <output>{settings.fov}°</output>
              <input
                aria-label="Camera field of view"
                type="range"
                min="40"
                max="160"
                value={settings.fov}
                onChange={(e) => change("fov", Number(e.target.value))}
              />
            </label>
            <label>
              Camera range <output>{settings.range} units</output>
              <input
                aria-label="Camera range"
                type="range"
                min="100"
                max="650"
                step="10"
                value={settings.range}
                onChange={(e) => change("range", Number(e.target.value))}
              />
            </label>
            <p className="muted">Camera range limits detection, not received outlines.</p>
            <div className="rotation-controls">
              <button
                className={settings.autoRotate ? "rotation-toggle scanning" : "rotation-toggle"}
                aria-pressed={settings.autoRotate}
                onClick={() => change("autoRotate", !settings.autoRotate)}
              >
                {settings.autoRotate ? "Stop automatic rotation" : "Start automatic rotation"}
              </button>
              <p className="muted">All officers scan in place. Stop keeps their current direction.</p>
              <label>
                Rotation speed <output>{settings.rotationSpeed}°/s</output>
                <input
                  aria-label="Rotation speed"
                  type="range"
                  min="5"
                  max="180"
                  step="5"
                  value={settings.rotationSpeed}
                  onChange={(e) => change("rotationSpeed", Number(e.target.value))}
                />
              </label>
            </div>
            <div className="toggles">
              {(
                [
                  ["cones", "Vision cones"],
                  ["links", "Communication links"],
                  ["patrol", "Automatic police patrol"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    onChange={(e) => change(key, e.target.checked)}
                  />
                </label>
              ))}
            </div>
          </section>
        </aside>
      </div>
      <section className="explanation">
        <div>
          <span className="step">01</span>
          <h3>Observe</h3>
          <p>
            Head-mounted cameras detect targets inside their field of view.
            Walls block sight.
          </p>
        </div>
        <div>
          <span className="step">02</span>
          <h3>Share</h3>
          <p>
            Live positions reach teammates instantly. The source officer stays
            attached to each observation.
          </p>
        </div>
        <div>
          <span className="step">03</span>
          <h3>Reveal</h3>
          <p>
            Glasses project an outline through walls at any distance when you look toward it. Lose every observer, and
            the outline disappears.
          </p>
        </div>
      </section>
      <footer>
        <span>
          Focus the map · <kbd>W A S D</kbd> move · <kbd>Q E</kbd> turn ·{" "}
          <kbd>Space</kbd> pause
        </span>
        <span>2D MODEL · IDEAL CAMERAS · ZERO NETWORK DELAY</span>
      </footer>
    </main>
  );
}
