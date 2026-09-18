# Wall Through

An interactive 3D simulation of shared awareness: 5–10 police officers each wear a head-mounted **stereo camera** that detects three moving simulated terrorists, triangulates them from disparity, and tracks their live movement. The detecting officer also publishes an **18-joint body pose**, and every teammate sees that skeleton painted over their own camera feed as a translucent, live-moving figure — so an officer behind an opaque wall sees not just where a target is, but how they are moving.

## Run locally

Use Node.js 22.13 or later and npm:

```sh
cd simulator
npm install
npm run dev
```

Open the URL printed by the development server. Physical cameras, RealSense, LiDAR, ROS, and a separate simulation service are not required for this phase.

## Try it

Select an officer in the 3D world overview, then choose **Officer glasses** for a first-person view. That view comes from the officer's stereo camera, the only sensor, which sits on their eyes. In the overview, each officer's eyes and gaze ray show where they are looking, and the dot marks what they are looking at ([details](docs/SIMULATION.md#where-each-officer-is-looking)). Directly observed targets appear normally; targets observed by teammates appear as shared 3D outlines through walls. Camera range limits the officer making the sensor measurement, not the receiving officer’s shared outline.

Detected targets are marked with a velocity arrow, a fading movement trail, and an uncertainty ring that swells with range — depth error grows with the square of distance, so a distant target is genuinely less precisely located. Drag **Stereo baseline** to watch triangulation tighten or fail.

A resolved target also gets a skeleton. The officer who sees it draws it solid; teammates draw the published pose faintly over their feed, fading out on its own when the source camera loses the subject. Drag **Overlay opacity** to set how present those teammate figures are. The overlay is drawn on the glass and never re-enters detection — the **BYPASSED** counter shows how many layers the detector refused each frame.

Hold **Ctrl and drag** in the world overview to rotate and tilt the view, **Ctrl + scroll** to zoom, and double-click to reset. In Officer glasses, Ctrl + drag turns the officer. Click the 3D scene before using **WASD / arrow keys** to move, **Q / E** to turn, or **Space** to pause. Controls also provide reset, officer count, automatic patrol, shared vision, field of view, stereo baseline, range, vision cones, communication links, movement trails, velocity vectors, skeleton overlays, overlay opacity, and automatic scanning.

Detection runs on simulated stereo optics rather than real imagery, behind the same provider seam a physical camera, Intel RealSense, or LiDAR unit would use. See [the stereo vision guide](docs/VISION.md) for the rig, detection gates, triangulation error, and motion tracking, [the skeleton overlay guide](docs/SKELETON.md) for the keypoint model, the gait, and the detector bypass, and [the 3D simulation guide](docs/SIMULATION.md) for controls, the sensor/track contract, and the physics boundary.

## Verify

From `simulator/`:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

For browser checks, install Chromium once with `npx playwright install chromium`, then run `npm run test:browser`.

This is a development demonstration; it does not implement real hardware drivers, calibration or rectification, trained computer-vision or pose-estimation models, or physical see-through-wall sensing.
