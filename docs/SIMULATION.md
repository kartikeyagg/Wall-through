# Simulation guide

## What the demonstration models

The scene contains 5–10 police officers, exactly three moving simulated terrorists, and opaque walls. Every officer has a position and a head direction, plus a camera field of view and detection range. Agents collide with walls rather than walking through them.

A direct observation requires the target to be within the observing officer's camera range and field of view, with an unobstructed line of sight. Walls block that line of sight. Turning an officer away or moving the target behind a wall can therefore end a detection.

Direct observations are shared with teammates. If the selected officer cannot see a target directly but another officer currently can, shared vision can display an outline at the target's simulated position, including through an opaque wall. The receiving officer must look toward the target within their field of view, but their distance to it does not matter. Camera range still limits the source officer's direct detection. Multiple officers may observe the same target. Losing one observer does not remove the outline if another still sees it.

If all observers lose sight of a target, its shared outline disappears. There is no last-known-position trail or prediction that continues to reveal an unseen target. Disabling shared vision removes teammate-derived outlines without changing direct vision.

## Understanding the views

The **world overview** exposes the entire scene so you can understand where walls, officers, and targets are. Seeing a target in this overview does not mean an officer has detected it.

The **glasses view** shows the selected officer's available target observations. Directly visible targets and shared outlines have different visual treatments. This is a 2D representation of information available to the glasses, rather than a first-person 3D headset rendering.

Vision cones illustrate camera orientation and coverage; communication links help explain which observations are being shared. These visual aids do not grant extra detections.

## Controls

| Control                 | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| Click an officer        | Select whose movement and glasses view to inspect                        |
| WASD or arrow keys      | Move the selected officer after focusing the canvas                      |
| Q / E                   | Turn the selected officer's head direction                               |
| Turn left / Turn right  | Adjust the selected officer's heading by 15° per click, even while paused |
| Start / Stop automatic rotation | Toggle scanning for all officers; stopping preserves their headings |
| Rotation speed          | Set automatic scanning to 5–180° per simulation second (default 30°/s) |
| Space                   | Pause or resume while the canvas has keyboard focus                      |
| Pause / resume          | Freeze or continue simulation movement                                   |
| Reset scene             | Restart positions and elapsed time, select P2, and retain other settings |
| Speed                   | Run movement at 0.5×, 1×, or 2×                                          |
| Officer count           | Choose between 5 and 10 officers and restart the scene                   |
| Automatic police patrol | Toggle automatic movement for officers other than the selected officer   |
| Shared vision           | Toggle teammate-derived target outlines                                  |
| Vision cones            | Show or hide camera coverage guides                                      |
| Communication links     | Show or hide sharing guides                                              |
| Field of view / range   | Adjust camera detection coverage                                         |

Keyboard movement is intended for the simulation canvas. Click it again after interacting with a slider or another control.

The selected officer's movement stays under manual control even when automatic police patrol is enabled. Automatic rotation is separate from patrol and rotates every officer, including the selected one; with patrol disabled, officers scan while standing still. Holding Q/E overrides scanning for the selected officer until released. The turn buttons add a 15° adjustment; scanning continues if enabled. The heading readout uses screen coordinates: 0° right, 90° down, 180° left, and 270° up.

**Stop automatic rotation** stops scanning without resetting headings or pausing the simulation. Other motion continues: automatic patrol can still turn officers when they collide with an obstacle. Disable patrol as well to keep non-selected officers facing a fixed direction. All three targets patrol whenever the simulation is running. Pausing freezes motion and scanning; manual turn buttons, viewing settings, and officer selection still update observations. Reset retains the rotation toggle and speed along with other settings. Simulation speed scales scanning as well as movement.

## Suggested checks

1. Pause and reset the scene. With the default range of 420 and field of view of 117°, P2 faces T1 across the main wall while P1 can see T1 directly.
2. Select P2 and inspect the glasses view. With shared vision enabled, the teammate's observation should supply a T1 outline. If you previously changed camera settings, restore the defaults first.
3. Disable shared vision. The outline should disappear while directly visible targets remain visible.
4. Re-enable sharing, then turn or move observers until none can see the target. Its shared outline should disappear.
5. Change the officer count and reset. The scene should still contain exactly three targets.
6. With 5 officers, pause/reset and set camera range to 220. P1 is 200 units from T1; P2 is 240 units away behind the wall. P2 still receives T1 despite being beyond camera range. At a range of 100, P1 also loses detection, and T1 disappears.
7. Restore default camera settings, start automatic rotation, and resume. Headings and camera cones rotate, acquiring and losing targets as they scan. Stop rotation and check that headings hold while simulation time continues. Manual turn buttons remain available.

## Modeling limits

All positions, identities, and head directions are known exactly inside the simulation. Detection uses scene geometry, not camera images or a trained recognition model. Sharing is instantaneous: network latency, packet loss, sensor noise, false detections, and synchronization errors are not modeled.

The physical model is intentionally simple: movement and collisions with walls, scene boundaries, and other agents in a flat 2D scene. Detection checks the line to each target's center, so it does not calculate partial visibility of a body around a corner. It does not model human biomechanics, weapons, or complex rigid-body dynamics.

A real glasses system would additionally need target localization, shared coordinate alignment, tracking, networking, and calibration between the wearer's head pose and display. This demonstration does not validate those capabilities. ROS integration is not required or included.

## Development checks

From the repository root:

```sh
cd simulator
npm install
npm test
npm run build
```

The development server starts with `npm run dev`. Use its printed URL when the default port is already occupied.

Browser integration checks exercise shared/direct observations, count and camera controls, keyboard movement and rotation, and responsive layouts. Install the browser once with `npx playwright install chromium`, then run `npm run test:browser`. The tests start or reuse the local server on port 3000 and save screenshots to `/tmp/wall-through-desktop.png` and `/tmp/wall-through-mobile.png`. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chromium executable if you want to use that installation instead.
