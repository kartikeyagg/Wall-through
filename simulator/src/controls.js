export const CONTROL_GROUPS = [
  {
    id: "movement",
    title: "Movement",
    note: "Movement is relative to the selected officer's heading.",
    controls: [
      { keys: ["W", "↑"], action: "Advance" },
      { keys: ["S", "↓"], action: "Move back" },
      { keys: ["A", "←"], action: "Strafe left" },
      { keys: ["D", "→"], action: "Strafe right" }
    ]
  },
  {
    id: "looking",
    title: "Looking around",
    note: "Click the 3D scene first to give it keyboard focus.",
    controls: [
      { keys: ["Q", "E"], action: "Turn the selected officer continuously" },
      { keys: ["↶ Turn left", "Turn right ↷"], action: "Turn the selected officer 15° per click" },
      { keys: ["Click empty glasses view", "Move mouse"], keyStyle: "chord", action: "Capture the mouse and turn the officer", context: "Needs Mouse look on in Simulation settings." },
      { keys: ["Esc"], action: "Release mouse look" },
      { keys: ["Click while looking"], action: "Select an officer, or clear and re-flag a person, at the crosshair" },
      { keys: ["Mouse look"], action: "Turn mouse capture off entirely; clicks then always select", context: "In Simulation settings." },
      { keys: ["Ctrl", "Drag"], keyStyle: "chord", action: "Turn the officer from the glasses view as a fallback" }
    ]
  },
  {
    id: "sensors-tools",
    title: "Sensors & tools",
    controls: [
      { keys: ["F"], action: "Throw an mmWave sensor puck", context: "Up to 4 pucks can be carried." },
      { keys: ["Click officer"], action: "Select that officer" },
      { keys: ["Click person"], action: "Clear or re-flag that person as a threat" }
    ]
  },
  {
    id: "world-overview-camera",
    title: "World overview camera",
    controls: [
      { keys: ["Ctrl", "Drag"], keyStyle: "chord", action: "Rotate and tilt the overview" },
      { keys: ["Ctrl", "Scroll"], keyStyle: "chord", action: "Zoom the overview" },
      { keys: ["Double-click"], action: "Reset the overview camera" }
    ]
  },
  {
    id: "minimap",
    title: "Minimap",
    note: "The minimap shows only what the team knows: officers at their published self-localized pose, and people the sensors have actually detected.",
    controls: [
      { keys: ["+", "−"], action: "Zoom the minimap in and out" },
      { keys: ["Scroll over map"], action: "Zoom the minimap" },
      { keys: ["N", "HDG"], action: "Switch between north-up and heading-up" },
      { keys: ["□"], action: "Expand the minimap to the full floor plan" },
      { keys: ["Click blip"], action: "Select that officer" }
    ]
  },
  {
    id: "simulation",
    title: "Simulation",
    controls: [
      { keys: ["Space"], action: "Pause or resume the simulation" },
      { keys: ["?"], action: "Open this controls guide" },
      { keys: ["Esc"], action: "Close this controls guide" }
    ]
  }
];

export const ALL_CONTROLS = CONTROL_GROUPS.flatMap(({ id, controls }) => controls.map((control) => ({ ...control, groupId: id })));

export function controlsFor(contextId) {
  return CONTROL_GROUPS.find((group) => group.id === contextId) ?? null;
}

export function formatKeys(keys, keyStyle = "alternatives") {
  return keys.join(keyStyle === "chord" ? " + " : " / ");
}
