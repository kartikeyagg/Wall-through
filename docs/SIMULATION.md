# 3D simulation guide

## What it demonstrates

Wall Through is a browser-based 3D scene with 5–10 police officers, three moving simulated terrorists, opaque 3D walls, and a ground plane. Walls are static colliders; officers and targets are kinematic capsule bodies. Fixed simulation substeps prevent tunnelling and permit sliding along a wall.

The world overview is an inspectable third-person 3D scene. Officer glasses is a first-person 3D camera placed exactly where the selected officer’s stereo rig is: at eye height (the rig's 1.7 m `mountHeight`), looking level along the heading, with the rig's horizontal field of view. What you see in glasses view is the camera's view. In glasses view, only direct contacts, live teammate-shared outlines, and the translucent skeleton overlays teammates publish are rendered.

### The stereo rig is the target-detection sensor

Each officer carries one sensor: the head-mounted stereo camera. Its two glass lenses sit directly over the officer's eyes, so the camera's optical axis and the officer's line of sight are the same. The old line-of-sight `simulated-camera` detection provider has been removed.

### Self localization: stereo map features, compass, then IMU

Every police head rig also has a compass and a compact IMU. `SelfLocalization` in `src/sensors.js` derives a primary self-pose from known static stereo map features (walls and corners) and compass heading. It then applies the IMU's integrated velocity and yaw as a low-weight correction. This order is deliberate: the simulation makes the IMU noticeably noisier than a real unit, so it may smooth a pose but cannot replace stereo and compass.

The **Self localization** panel exposes local X/Z, compass heading, and simulated position error for the selected officer. **IMU integration** is enabled by default; turn it off to use the stereo-map and compass estimate alone. The violet module on the head rig is lit when that integration is enabled; the gold disc is the compass.

### Lightweight people and environment

People are articulated low-poly figures with heads, clothing, arms, and legs that swing as they patrol. Officers use a dark tactical vest; the three moving subjects have distinct clothing and skin tones. The environment uses generated concrete-grid floor and wall-panel textures plus high-contrast safety stripes. These visual details make the first-person stereo scene easier to inspect while keeping the scene small and asset-free.

The current detector remains a deterministic geometric stereo model, not an image classifier: textures do not alter a detection result. They are also the visible reference map represented by the self-localization seam, ready for replacement with real feature matching later.

### Where each officer is looking

- **Eyes** — every officer has a head with two eyes (white with dark pupils) that turn with the officer's heading.
- **Gaze ray** — a line runs from the eyes along the line of sight and stops at the first wall it hits, or at the camera range. The dot at its end is the point the officer is looking at. The selected officer's ray is lime; the others are blue.
- **Stereo cones** — with **Vision cones** on, each officer's left and right lens cones start at their eyes and point the way they face. In glasses view only the selected officer's cones are drawn, and that officer's own body is hidden so it does not block the camera.

### Direction arrows to every known target

In **Officer glasses**, each live track the officer knows about gets an arrow on a ring around the centre of the view, like a game threat indicator. Up means straight ahead, the sides mean left or right, and down means behind their back. Targets outside the camera's field of view still get an arrow.

- **Colour** — yellow for the officer's own detection, lime for a track shared by a teammate.
- **Size** — closer targets get larger arrows.
- **Pulse** — the arrow dims and pulses while the track is coasting (no fresh measurement).
- **Layer** — arrows are drawn on the same always-on-top layer as the skeletons behind walls, so walls never hide them.

Arrows only appear for real tracks: the officer's own, plus teammates' when **Shared vision** is on. Turn them off with the **Direction arrows** toggle. The list comes from `awareOf` in `simulator/src/simulation.js`. It works like `visibleTo`, but without the field-of-view filter.

## Controls

| Control | Purpose |
| --- | --- |
| Click a 3D officer / officer button | Select the officer to inspect and move |
| WASD or arrow keys | Move the selected kinematic body after focusing the 3D scene. W / Up advances in its current heading, S / Down moves backward, and A / Left and D / Right strafe left and right. |
| Q / E | Continuously turn the selected officer |
| Turn left / Turn right | Turn the selected officer 15° (also while paused) |
| Space or Pause / Resume | Pause or resume movement, scanning, and sensor updates |
| Start / Stop automatic rotation | Make every officer scan; stopping retains headings |
| World overview / Officer glasses | Switch between third-person and first-person 3D views |
| Ctrl + drag (overview) | Orbit the camera: left/right rotates around the arena, up/down tilts from near-ground to top-down |
| Ctrl + scroll (overview) | Zoom the overview camera in and out |
| Double-click (overview) | Reset the overview camera to its default angle and distance |
| Ctrl + drag (glasses) | Turn the selected officer left/right; the view stays locked to their stereo rig |
| Shared vision | Show/hide teammate-provided 3D target outlines |
| Field of view / range | Adjust the stereo rig's horizontal FOV and operator range cutoff |
| Stereo baseline | Set the lens separation on the head rig, 2–30 cm |
| IMU integration | Blend the simulated IMU into the stereo-map and compass self-pose; turn off for stereo + compass only |
| Movement trails / Velocity vectors | Show each track's recent path and heading arrow |
| Direction arrows | In glasses view, point an arrow toward every known target, including those behind the officer |
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
