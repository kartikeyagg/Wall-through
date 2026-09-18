# 3D simulation guide

## What it demonstrates

Wall Through is a browser-based 3D scene with 5–10 police officers, three moving simulated terrorists, opaque 3D walls, and a ground plane. Walls are static colliders; officers and targets are kinematic capsule bodies. Fixed simulation substeps prevent tunnelling and permit sliding along a wall.

The world overview is an inspectable third-person 3D scene. Officer glasses is a first-person 3D camera at the selected officer’s head. In glasses view, only direct contacts and live teammate-shared outlines are rendered.

## Controls

| Control | Purpose |
| --- | --- |
| Click a 3D officer / officer button | Select the officer to inspect and move |
| WASD or arrow keys | Move the selected kinematic body after focusing the 3D scene |
| Q / E | Continuously turn the selected officer |
| Turn left / Turn right | Turn the selected officer 15° (also while paused) |
| Space or Pause / Resume | Pause or resume movement, scanning, and sensor updates |
| Start / Stop automatic rotation | Make every officer scan; stopping retains headings |
| World overview / Officer glasses | Switch between third-person and first-person 3D views |
| Shared vision | Show/hide teammate-provided 3D target outlines |
| Field of view / range | Adjust source camera detection coverage |

Camera range and occlusion apply only to the officer who makes a sensor measurement. A receiving officer still has to face an incoming live track, but is not range-limited. When direct reports stop, a track has a short confidence window before removal instead of becoming a permanent last-known-position marker.

## Sensor-ready architecture

The UI does not read target positions directly for its shared-vision display. It consumes this pipeline:

```text
pose provider + camera / RealSense / LiDAR detection providers
                         ↓
 timestamp-normalized SensorDetection reports
                         ↓
         SensorFusion → TrackStore
                         ↓
       direct contacts + shared 3D outlines
```

`src/sensors.js` defines the current contract. Every provider emits timestamped `officerId`, `trackId`, 3D `position`, `confidence`, optional `velocity`, and optional `outline`. The simulated camera provider emits this exact shape now. Future hardware should implement `read(timestamp)` and pass reports to `SensorFusion.update`; it should not update the renderer or shared-vision policy directly.

Pose data contains officer ID, timestamp, 3D position, and orientation. Future camera, Intel RealSense, and LiDAR adapters must calibrate sensor coordinates into the shared world coordinate system before emitting a report. `TrackStore` owns current tracks and stale-report expiration, and can later be replaced by a stronger association/fusion algorithm without changing output consumers.

`src/physics.js` provides the `KinematicPhysicsAdapter` boundary used by the simulation. It currently performs deterministic JS sweeps against fixed wall colliders and kinematic people. A Rapier 3D implementation can replace it behind the same `setStaticWalls`, `syncKinematicBodies`, and `moveKinematic` API.

## Scope and limits

This phase does not connect real cameras, RealSense units, LiDAR, networking, calibration UI, trained terrorist-detection models, identity recognition, or body tracking. Simulated providers stand in for those live sources. This is a development harness, not a validated safety, detection, or operational system.

## Development checks

```sh
cd simulator
npm install
npm test
npm run typecheck
npm run lint
npm run build
```

Run `npm run dev` for local development. For browser checks, install Chromium once with `npx playwright install chromium`, then run `npm run test:browser`.
