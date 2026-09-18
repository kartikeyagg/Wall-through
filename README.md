# Wall Through

An interactive 3D simulation of shared awareness: 5–10 police officers share timestamped, fused sensor tracks for three moving simulated terrorists. An officer behind an opaque wall can see a live 3D outline in their glasses when a teammate has a current detection.

## Run locally

Use Node.js 22.13 or later and npm:

```sh
cd simulator
npm install
npm run dev
```

Open the URL printed by the development server. Physical cameras, RealSense, LiDAR, ROS, and a separate simulation service are not required for this phase.

## Try it

Select an officer in the 3D world overview, then choose **Officer glasses** for a first-person view. Directly observed targets appear normally; targets observed by teammates appear as shared 3D outlines through walls. Camera range limits the officer making the sensor measurement, not the receiving officer’s shared outline.

Click the 3D scene before using **WASD / arrow keys** to move, **Q / E** to turn, or **Space** to pause. Controls also provide reset, officer count, automatic patrol, shared vision, field of view, range, vision cones, communication links, and automatic scanning.

The current simulator intentionally uses a sensor-shaped simulated data feed. It is structured so future camera, Intel RealSense, and LiDAR adapters emit timestamped 3D reports into the same live fusion and track pipeline. See [the 3D simulation guide](docs/SIMULATION.md) for controls, the sensor/track contract, physics boundary, and future hardware-ingestion path.

## Verify

From `simulator/`:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

For browser checks, install Chromium once with `npx playwright install chromium`, then run `npm run test:browser`.

This is a development demonstration; it does not implement real hardware drivers, calibration, computer-vision models, body tracking, or physical see-through-wall sensing.
