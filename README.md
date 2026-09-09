# Wall Through

A lightweight, interactive 2D simulation of shared vision: 5–10 police officers share observations of three moving simulated terrorists. An officer behind an opaque wall can see a live outline in their glasses when a teammate can see the target.

## Run locally

Use Node.js 22.13 or later and npm. From the repository root:

```sh
cd simulator
npm install
npm run dev
```

Open the local URL printed by the development server. ROS, physical cameras, and a separate simulation service are not required.

## Try shared vision

Select an officer in the world overview, then use the glasses view to inspect what that officer can see. Directly observed targets appear normally; targets observed by teammates appear as shared outlines through walls at any distance when within the selected officer's field of view. Camera range limits the observing officer's detection, not the receiving officer's outline. Disable shared vision to compare the views. When no officer can see a target, its shared outline disappears.

For a repeatable example, pause and reset with the default camera settings, then open P2's glasses view: P1's observation reveals T1 across the main wall.

The world overview deliberately reveals the whole simulation for inspection. The glasses view restricts target visibility to the selected officer's direct and shared observations.

Click the simulation canvas before using **WASD / arrow keys** to move, **Q / E** to turn, or **Space** to pause. The controls also provide reset, officer count, automatic patrol, shared vision, field of view, range, vision cones, and communication links.

Use **Start automatic rotation** to make all officers scan, and adjust **Rotation speed** (5–180° per simulation second). **Stop automatic rotation** keeps their current headings. **Turn left / Turn right** adjust the selected officer by 15° per click, including while paused. Q/E temporarily overrides automatic scanning for the selected officer while held.

See [the simulation guide](docs/SIMULATION.md) for controls, observation rules, and modeling limitations.

## Verify

Run from `simulator/`:

```sh
npm test
npm run build
```

For browser interaction and responsive-layout checks, install Chromium once with `npx playwright install chromium`, then run `npm run test:browser`. The test configuration starts a local development server when necessary. An existing Chromium executable can be selected with the `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` environment variable.

This is a geometry-based demonstration using exact simulated positions and instantaneous sharing. It does not implement computer vision, real glasses calibration, or a physical see-through-wall sensor.
