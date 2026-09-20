"use client";

import { useEffect, useRef, useState } from "react";
import type { World } from "./simulation.js";
import type { LocalizationEstimate } from "./sensors.js";
import type { SensorReport, VisionContact } from "./SimulationScene";
import { clampView, collectBlips, fitView, hitTest, worldToMinimap } from "./minimap.js";
import "./minimap.css";

type Props = {
  world: React.MutableRefObject<World | null>;
  localizations: React.MutableRefObject<LocalizationEstimate[]>;
  contacts: React.MutableRefObject<VisionContact[]>;
  sensors: React.MutableRefObject<SensorReport[]>;
  options: React.MutableRefObject<{ selected: string }>;
  onSelect?: (officerId: string) => void;
  className?: string;
};

type View = { center: { x: number; y: number }; scale: number; rotation: number; size: { width: number; height: number } };

const triangle = (context: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number) => {
  context.save(); context.translate(x, y); context.rotate(heading + Math.PI / 2);
  context.beginPath(); context.moveTo(0, -size); context.lineTo(size * 0.68, size); context.lineTo(-size * 0.68, size); context.closePath(); context.fill(); context.restore();
};

export default function Minimap({ world, localizations, contacts, sensors, options, onSelect, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null), viewRef = useRef<View>(fitView(undefined, { width: 180, height: 180 }));
  const [headingUp, setHeadingUp] = useState(true), [expanded, setExpanded] = useState(false), [summary, setSummary] = useState("Tactical minimap loading");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0, width = 180, height = 180, lastSummary = 0;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      viewRef.current = clampView({ ...viewRef.current, size: { width, height } });
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.16 : 1 / 1.16;
      viewRef.current = clampView({ ...viewRef.current, scale: viewRef.current.scale * factor });
    };
    const click = (event: MouseEvent) => {
      const bounds = canvas.getBoundingClientRect(), pixel = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const blip = hitTest(pixel, collectBlips({ localizations: localizations.current, contacts: contacts.current, sensors: sensors.current, selectedId: options.current.selected }), viewRef.current, 14);
      if (blip?.kind === "officer") onSelect?.(blip.id);
    };
    canvas.addEventListener("wheel", wheel, { passive: false }); canvas.addEventListener("click", click);
    const draw = (now: number) => {
      const context = canvas.getContext("2d"), currentWorld = world.current;
      if (!context || !currentWorld) { frame = requestAnimationFrame(draw); return; }
      const estimates = localizations.current, selected = estimates.find((item) => item.officerId === options.current.selected) ?? estimates[0];
      const rotation = headingUp && selected ? selected.orientation.yaw + Math.PI / 2 : 0;
      const old = viewRef.current;
      viewRef.current = clampView({ ...old, center: selected ? { x: selected.position.x, y: selected.position.z } : old.center, rotation, size: { width, height } });
      const view = viewRef.current, ratio = window.devicePixelRatio || 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
      context.fillStyle = "#101a20"; context.fillRect(0, 0, width, height);
      context.save(); context.beginPath(); context.roundRect(0, 0, width, height, expanded ? 8 : width / 2); context.clip();
      context.fillStyle = "#14242a"; context.fillRect(0, 0, width, height);
      context.fillStyle = "#35464b";
      for (const wall of currentWorld.walls) {
        const start = worldToMinimap({ x: wall.x, y: wall.y }, view);
        context.save(); context.translate(start.x, start.y); context.rotate(view.rotation); context.fillRect(0, 0, wall.w * view.scale, wall.h * view.scale); context.restore();
      }
      const blips = collectBlips({ localizations: estimates, contacts: contacts.current, sensors: sensors.current, selectedId: options.current.selected });
      for (const blip of blips) {
        const point = worldToMinimap(blip, view);
        if (blip.kind === "officer") {
          context.fillStyle = blip.selected ? "#ffffff" : "#9fd8ff"; triangle(context, point.x, point.y, (blip.heading ?? 0) + view.rotation, blip.selected ? 8 : 6);
          if (expanded) { context.fillStyle = "#dce8ed"; context.font = "10px monospace"; context.fillText(blip.id, point.x + 8, point.y - 7); }
        } else if (blip.kind === "sensor") {
          context.fillStyle = "#f7bf58"; context.fillRect(point.x - 3, point.y - 3, 6, 6);
        } else {
          const color = blip.state === "cleared" ? "#94a3b8" : blip.modality === "radar-only" ? "#e879f9" : blip.source === "shared" ? "#bcf574" : "#ffd479";
          context.save(); context.globalAlpha = blip.coasting ? 0.42 : 0.95; context.strokeStyle = color; context.fillStyle = color; context.lineWidth = 2;
          context.beginPath(); context.arc(point.x, point.y, 5, 0, Math.PI * 2);
          if (blip.coasting) context.stroke(); else context.fill();
          if (blip.source === "shared") { context.beginPath(); context.arc(point.x, point.y, 8, 0, Math.PI * 2); context.stroke(); } context.restore();
        }
      }
      if (selected) { context.fillStyle = "#bcf574"; triangle(context, width / 2, height / 2, 0, 9); }
      context.strokeStyle = "rgba(188,245,116,.55)"; context.lineWidth = 1; context.beginPath(); context.moveTo(width - 18, 14); context.lineTo(width - 18, 28); context.stroke(); context.fillStyle = "#bcf574"; context.font = "9px monospace"; context.fillText("N", width - 21, 11);
      context.restore();
      if (now - lastSummary > 1000) { lastSummary = now; setSummary(`${estimates.length} officers and ${contacts.current.length} detected tracks shown`); }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); canvas.removeEventListener("wheel", wheel); canvas.removeEventListener("click", click); };
  }, [contacts, expanded, headingUp, localizations, onSelect, options, sensors, world]);

  return <section className={`minimap${expanded ? " minimap--expanded" : ""}${className ? ` ${className}` : ""}`}>
    <canvas ref={canvasRef} aria-label="Tactical minimap showing known officers and detected tracks" />
    <div className="minimap__controls">
      <button type="button" aria-label="Zoom in tactical minimap" onClick={() => { viewRef.current = clampView({ ...viewRef.current, scale: viewRef.current.scale * 1.25 }); }}>+</button>
      <button type="button" aria-label="Zoom out tactical minimap" onClick={() => { viewRef.current = clampView({ ...viewRef.current, scale: viewRef.current.scale / 1.25 }); }}>−</button>
      <button type="button" aria-label="Toggle heading-up map" aria-pressed={headingUp} onClick={() => setHeadingUp((value) => !value)}>{headingUp ? "HDG" : "N"}</button>
      <button type="button" aria-label={expanded ? "Collapse tactical minimap" : "Expand tactical minimap"} aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "×" : "□"}</button>
    </div>
    <span className="minimap__summary" aria-live="polite">{summary}</span>
  </section>;
}
