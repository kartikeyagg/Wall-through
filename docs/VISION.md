# Stereo vision detection

Targets are no longer revealed by a geometric cone test. Every officer wears a
**head-mounted stereo camera rig**, and a terrorist exists to the system only
when that rig can actually resolve them in *both* images. Position comes from
disparity, so it carries error, and a tracker turns those noisy per-frame
readings into a live estimate of where each target is and where they are going.

```text
officer head pose ──► stereo rig (src/stereo.js)
                          │  project into left + right image planes
                          │  disparity ► depth ► triangulated position + σ
                          ▼
              StereoDetection reports (src/vision.js)
                          │  one per (officer, target) that is resolvable
                          ▼
        MotionTracker — constant-velocity Kalman (src/tracking.js)
                          │  inverse-variance fusion across officers
                          ▼
     MotionTrack: position, velocity, heading, moving, σ, trail, predicted
                          │
                          ▼
        visibleTo(...) ► direct contacts + shared 3D outlines
```

## What makes a target detectable

A detection is emitted only when **all** of these hold:

| Gate | Meaning |
| --- | --- |
| Line of sight | No opaque wall between the officer and the target |
| Both frames | The target projects inside the left **and** the right image |
| Disparity | `disparity ≥ minDisparityPx` — below this the matcher cannot triangulate |
| Pixel height | `heightPx ≥ minBoxHeightPx` — the detector will not report a person smaller than this |
| Operator cutoff | Within the **Camera range** slider, which can only *tighten* the optical limit |

In practice the pixel-height gate binds first, so the effective reach is
`TARGET_HEIGHT × focalPx / minBoxHeightPx`, not a hand-picked constant. The
**Stereo rig telemetry** panel shows that reach live. Widening the field of view
shortens the focal length and therefore *shortens* range — a real trade-off you
can feel on the slider.

## Why depth is uncertain

Depth is `focal × baseline / disparity`, so the error in depth grows with the
**square** of distance:

```text
σ_depth = depth² × σ_disparity / (focal × baseline)
```

A target at 5 m is located to a few centimetres; the same target at 20 m is
located to roughly a metre. The scene draws this as an uncertainty ring that
visibly swells with range, and the tracker weights each report by `1/σ²`, so two
officers watching the same target produce a track tighter than either alone.

## Marking dynamic movement

`MotionTracker` runs one 2-state (position, velocity) Kalman filter per axis.
Each track therefore reports live `velocity`, ground-plane `speed` and
`heading`, a `moving` flag with hysteresis so the label does not flicker, a
`trail` of recent filtered positions, and a `predicted` position extrapolated a
few hundred milliseconds ahead.

The 3D scene renders these as a velocity arrow along the target's heading, a
fading movement trail, and the uncertainty ring. When no camera currently
resolves a target, the track **coasts** on prediction: it stays on screen,
dimmed and marked `Predicted`, until it goes stale.

## Rig configuration

`createStereoRig(config)` in `src/stereo.js` owns the optics. Defaults:

| Field | Default | Meaning |
| --- | --- | --- |
| `baseline` | `0.08` m | Distance between the two lens centres |
| `imageWidth` / `imageHeight` | `1280 × 720` px | Sensor resolution |
| `hfov` | `117°` | Horizontal field of view; sets `focalPx` |
| `mountHeight` | `1.7` m | Rig height above the ground plane |
| `minDisparityPx` | `1.2` px | Far-depth limit of the matcher |
| `disparityNoisePx` | `0.15` px | One-sigma matching error |
| `centroidNoisePx` | `0.4` px | One-sigma box-centre error |
| `minBoxHeightPx` | `32` px | Smallest person the detector reports |
| `detectorConfidence` | `0.97` | Confidence ceiling |

`src/stereo.js` works purely in **metres**. `src/vision.js` is the only module
that converts to the simulation's ground units (`UNITS_PER_METRE = 24`), which
keeps the optics testable against real-world numbers.

Matcher noise is deterministic: pass a `seed` (or `noise: false` for exact
triangulation) and a run is byte-for-byte reproducible, which is what the tests
rely on.

## Using it

```js
import { StereoVisionPipeline, trackObservations } from "./src/vision.js";
import { visibleTo } from "./src/simulation.js";

const pipeline = new StereoVisionPipeline({ rig: { baseline: 0.12 }, range: 420 });
const { detections, tracks, rig } = pipeline.update(world, world.time * 1000);
const contacts = visibleTo(world, "P2", trackObservations(tracks, vision), true);
```

- `pipeline.configure({ rig: { baseline } })` re-optics the rig **without**
  dropping existing tracks, so dragging a slider does not reset the scene.
- `pipeline.reset()` clears the tracker.
- `createStereoVisionProvider(world, options)` exposes the same detections
  behind the `read(timestamp)` provider contract from `src/sensors.js`, so a
  real camera driver can drop into the same seam.

## New controls

| Control | Purpose |
| --- | --- |
| Stereo baseline | Lens separation, 2–30 cm. Wider triangulates further and more precisely |
| Camera field of view | Horizontal FOV; widening it shortens focal length and range |
| Camera range | Operator cutoff, applied on top of the optical limit |
| Movement trails | Show each track's recent filtered path |
| Velocity vectors | Show the heading arrow for moving targets |

## Scope

`src/sensors.js` and its `TrackStore` / `SensorFusion` remain as the
hardware-neutral provider contract and are still covered by tests. This phase
models stereo *optics and geometry*; it does not run a trained person detector,
stereo block matching on real imagery, calibration, or rectification. It is a
development harness, not a validated detection system.
