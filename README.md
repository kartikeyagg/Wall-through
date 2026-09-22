# Wall Through

An interactive 3D simulation of shared awareness: 5–10 police officers each wear a head-mounted **stereo camera**, compass, and optional IMU. Stereo detects three moving simulated people, triangulates them from disparity, and tracks their live movement; stereo map features plus compass also establish each officer’s own pose, with the deliberately imperfect IMU contributing only a low-weight integrated correction. The detecting officer also publishes an **18-joint body pose**, estimated through their own rig rather than from fused state, and every teammate sees that skeleton painted over their own camera feed as a translucent, live-moving figure — so an officer behind an opaque wall sees not just where a target is, but how they are moving. Officers can also throw mmWave radar pucks through a wall and clear the false-positive body flags that sensors cannot judge.

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

In **Officer glasses**, arrows around the centre of the view point toward every live target, even ones behind the officer. Up means ahead and down means behind. Yellow arrows are the officer's own detections; lime arrows come from teammates. Like skeletons, the arrows are drawn over walls ([details](docs/SIMULATION.md#direction-arrows-to-every-known-target)).

A resolved target also gets a skeleton. The officer who sees it draws it solid; teammates draw the published pose faintly over their feed, fading out on its own when the source camera loses the subject. Drag **Overlay opacity** to set how present those teammate figures are. The overlay is drawn on the glass and never re-enters detection — the **BYPASSED** counter shows how many layers the detector refused each frame.

Face a wall and press **F** or choose **Throw sensor**. The puck arcs, bounces, and settles; officers then geolocate its marker with stereo before its mmWave returns can track moving bodies through drywall. A violet track is radar-only until it can be associated with a stereo track. Turn on **Radar coverage rings** to inspect a located puck's footprint.

Every detected body is initially flagged because sensors cannot infer intent. Use **Not a terrorist** on a live-track row, or click a person in the 3D view, to clear a false positive for the whole team. **Hide cleared people** removes cleared markers while leaving the person visible. A clearance is vouched only while the person stays in sight: once no live sensor resolves them, it lapses and they are flagged again when they reappear.

A minimap in the corner of the 3D view plots the hall, the team and the people it has found. Officers are drawn at their **published self-localized pose**, so a blip drifts as far as that officer's own estimate is wrong, and only detected tracks appear — someone nobody has sensed is not on the map. Switch between heading-up and north-up, zoom, or expand it to the full floor plan ([details](docs/MINIMAP.md)).

In **Officer glasses**, click empty space to capture the mouse and steer the officer's heading like a first-person game; Esc releases it. Clicking a person still clears or re-flags them — while the mouse is captured that picks at the centre crosshair. Switch **Mouse look** off in the settings to disable capture entirely. Hold **Ctrl and drag** in the world overview to rotate and tilt the view, **Ctrl + scroll** to zoom, and double-click to reset. Ctrl + drag still turns the officer in glasses view without capturing the mouse. The **Controls** button in the map toolbar, or **?**, lists every binding. Click the 3D scene before using **WASD / arrow keys** to move, **Q / E** to turn, **F** to throw a sensor, or **Space** to pause. Movement follows the selected officer's heading: **W / ↑** advances, **S / ↓** moves backward, and **A / ←** and **D / →** strafe left and right. The **Self localization** panel shows the selected officer’s stereo-map/compass pose and simulated error, plus how many landmarks the rig can currently see and the resulting fix quality. Paintings, panels, floor markings and fixtures are scattered through the hall as the visual features the stereo rigs match against, so the fix tightens where they are plentiful, distinctive and spread across the view, and loosens where they are not — turn to face the deliberately bare wall and watch the error climb. Use **IMU integration** to include or remove its intentionally noisy correction. Controls also provide reset, officer count, automatic patrol, shared vision, field of view, stereo baseline, range, camera frame rate, vision cones, communication links, movement trails, velocity vectors, direction arrows, skeleton overlays, overlay opacity, radar coverage rings, hide cleared people, and automatic scanning.

The **Camera frame rate** slider sets how often the head rigs actually expose, from 1 to 60 fps, and the telemetry panel reports the rate they are achieving; between exposures stereo-only tracks coast ([details](docs/VISION.md#camera-frame-rate)).

Detection runs on simulated stereo optics rather than real imagery, behind the same provider seam a physical camera, Intel RealSense, or LiDAR unit would use. See [the stereo vision guide](docs/VISION.md) for the rig, detection gates, triangulation error, and motion tracking, [the skeleton overlay guide](docs/SKELETON.md) for the keypoint model, the gait, and the detector bypass, [the mmWave puck guide](docs/MMWAVE.md) for deployment, geolocation, and through-wall tracking, [the threat-tagging guide](docs/THREAT-TAGGING.md) for shared officer corrections and how a clearance lapses, [the minimap guide](docs/MINIMAP.md) for what the corner map may and may not draw, and [the 3D simulation guide](docs/SIMULATION.md) for controls, the sensor/track contract, and the physics boundary.

## Verify

From `simulator/`:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

For browser checks, install Chromium once with `npx playwright install chromium`, then run `npm run test:browser`.

This is a development demonstration; it does not implement real hardware drivers, real radar hardware or RF modelling, calibration or rectification, trained computer-vision or pose-estimation models, or physical see-through-wall sensing.

## Going real

[The real-world plan](docs/REAL-WORLD-PLAN.md) sets out what a hardware build needs: the officer kit, the thrown radar puck, the team network and the software that replaces each simulator module. It also lists every place the simulator is currently more optimistic than reality, and how to make it realistic while keeping it lag-free on a modest laptop.
