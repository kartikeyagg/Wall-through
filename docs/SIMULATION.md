# 3D simulation guide

## What it demonstrates

Wall Through is a browser-based 3D scene with 5–10 police officers, three moving simulated terrorists, opaque 3D walls, and a ground plane. Walls are static colliders; officers and targets are kinematic capsule bodies. Fixed simulation substeps prevent tunnelling and permit sliding along a wall.

The world overview is an inspectable third-person 3D scene. Officer glasses is a first-person 3D camera at the selected officer’s head. In glasses view, only direct contacts, live teammate-shared outlines, and the translucent skeleton overlays teammates publish are rendered.

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
| Field of view / range | Adjust the stereo rig's horizontal FOV and operator range cutoff |
| Stereo baseline | Set the lens separation on the head rig, 2–30 cm |
| Movement trails / Velocity vectors | Show each track's recent path and heading arrow |
| Skeleton overlay | Draw 18-joint body poses for resolved subjects |
| Overlay opacity | Ceiling alpha for teammate-published skeletons, 0–100% |

Camera range and occlusion apply only to the officer who makes a sensor measurement. A receiving officer still has to face an incoming live track, but is not range-limited. When direct reports stop, a track coasts on predicted motion for a short confidence window before removal instead of becoming a permanent last-known-position marker.

## Sensor-ready architecture

The UI does not read target positions directly for its shared-vision display. Detection runs through a head-mounted stereo camera on every officer, and the UI consumes the result of that pipeline:

```text
officer head pose → stereo rig projection (src/stereo.js)
                         ↓
   disparity → triangulated position + per-report σ
                         ↓
        StereoDetection reports (src/vision.js)
                         ↓
    MotionTracker — constant-velocity Kalman (src/tracking.js)
                         ↓
    SkeletonPoser → OverlayBus (src/skeleton.js, src/overlay.js)
                         ↓
  direct contacts + shared 3D outlines + live movement marking
                  + translucent teammate skeleton overlays
```

Overlays are drawn onto an officer's feed, never fed back into it. The detector
reads its subjects exclusively through `detectorInput(feed)`, which strips every
overlay layer, so a painted skeleton can never be re-detected as a fresh
subject. [The skeleton overlay guide](SKELETON.md) covers the keypoint model,
the gait, the fade, and that bypass.

[The stereo vision guide](VISION.md) covers the optics, the detection gates, why depth error grows with the square of range, and how movement is tracked and drawn. `src/sensors.js` remains the hardware-neutral provider contract that a real camera driver plugs into.

`src/sensors.js` defines the current contract. Every provider emits timestamped `officerId`, `trackId`, 3D `position`, `confidence`, optional `velocity`, and optional `outline`. The simulated camera provider emits this exact shape now. Future hardware should implement `read(timestamp)` and pass reports to `SensorFusion.update`; it should not update the renderer or shared-vision policy directly.

Pose data contains officer ID, timestamp, 3D position, and orientation. Future camera, Intel RealSense, and LiDAR adapters must calibrate sensor coordinates into the shared world coordinate system before emitting a report. `TrackStore` owns current tracks and stale-report expiration, and can later be replaced by a stronger association/fusion algorithm without changing output consumers.

`src/physics.js` provides the `KinematicPhysicsAdapter` boundary used by the simulation. It currently performs deterministic JS sweeps against fixed wall colliders and kinematic people. A Rapier 3D implementation can replace it behind the same `setStaticWalls`, `syncKinematicBodies`, and `moveKinematic` API.

## Scope and limits

This phase models stereo optics and geometry, not real imagery: it does not connect physical cameras, RealSense units, LiDAR, networking, calibration or rectification UI, trained terrorist-detection or pose-estimation models, or identity recognition. Skeletons are synthesised from tracked motion rather than regressed from imagery. Simulated providers stand in for those live sources. This is a development harness, not a validated safety, detection, or operational system.

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
