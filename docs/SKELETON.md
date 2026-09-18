# Skeleton publishing and shared overlays

A stereo detection tells you *where* a subject is. It does not tell you what
they are doing. This layer adds that: the officer whose rig resolves a subject
estimates an **18-joint body pose**, publishes it, and every teammate draws that
pose over their own camera feed as a near-transparent, live-updating figure.

```text
MotionTrack (position, heading, speed)
        │
        ▼
SkeletonPoser.pose(...)            src/skeleton.js
        │  COCO-18 keypoints, gait driven by distance travelled
        ▼
publishSkeleton(officerId, ...)    src/overlay.js
        │  SkeletonFrame { layer: "overlay", synthetic: true }
        ▼
OverlayBus.layersFor(receiver)     one OverlayLayer per teammate frame
        │  age fade x operator opacity
        ▼
translucent skeleton drawn in the receiver's feed (SimulationScene.tsx)

                    ✂ detectorInput(feed) ✂
        the detector reads through this seam and never sees a layer
```

## The keypoint model

Eighteen keypoints in the OpenPose COCO-18 order, which is the wire order of
`KEYPOINTS` and the index order of every `joints` array:

| # | Joint | # | Joint | # | Joint |
| --- | --- | --- | --- | --- | --- |
| 0 | nose | 6 | left elbow | 12 | left knee |
| 1 | neck | 7 | left wrist | 13 | left ankle |
| 2 | right shoulder | 8 | right hip | 14 | right eye |
| 3 | right elbow | 9 | right knee | 15 | left eye |
| 4 | right wrist | 10 | right ankle | 16 | right ear |
| 5 | left shoulder | 11 | left hip | 17 | left ear |

`BONES` pairs those indices into the limb segments that get drawn, each tagged
`head`, `torso`, `arm` or `leg` and carrying the colour the overlay renders it
in — red for the head, cyan for the arms, amber for the torso, yellow-green for
the legs.

Each joint carries a `score` in `[0, 1]` and a `visible` flag. Joints that fall
behind the subject's own torso are marked occluded and score low, so a side-on
subject legitimately loses the far arm — the renderer drops any bone whose
endpoints score below its threshold rather than drawing a limb the rig never
actually resolved.

## Movement is real, not decorative

The pose is dynamic. `SkeletonPoser` keeps a **gait phase** per track and
advances it by distance travelled, not by wall-clock time:

```text
phase += 2π × (speed × dt) / strideLength
```

So a subject moving twice as fast takes strides twice as often, a subject that
stops mid-stride resumes from the same phase rather than snapping, and the
animation stays continuous across a settings change. Swing amplitude scales
with speed and saturates. Below `standingSpeed` the subject is posed standing
with a small breathing sway — never a frozen mannequin.

Because phase is integrated from the *tracked* speed, the skeleton's gait is a
readout of the tracker, not an independent animation: a coasting track keeps
walking at its last estimated speed, and a stopped one visibly stops.

## Units

`skeleton.js` is unit-agnostic. Every joint offset is a fraction of the
`height` you pass, so supplying simulation units gets simulation units back.
Inside a skeleton, `x` and `z` are the ground plane and `y` is up — **all three
in the same unit**. This differs from `StereoDetection.position`, whose `y` is
in metres; `vision.js` poses skeletons at `TARGET_HEIGHT_UNITS` (42 units,
1.75 m at 24 units/m) and keeps them entirely in unit space.

## The bypass — why a drawn skeleton is never re-detected

An overlay is paint on the glass. If a receiving officer's detector treated a
teammate's drawn skeleton as a body, it would publish a pose for the drawing,
which the first officer would then draw and re-detect, and the two would
manufacture subjects out of each other indefinitely.

The module makes that structurally impossible rather than relying on care:

| Piece | Guarantee |
| --- | --- |
| `SkeletonFrame` | Always stamped `layer: "overlay"` and `synthetic: true` |
| `OverlayLayer` | Always stamped `bypassDetector: true` |
| `composeFeed` | Keeps `subjects` and `overlays` in separate arrays |
| `detectorInput(feed)` | The **only** seam the detector reads through — returns subjects with every overlay stripped, including one smuggled into `subjects` |
| `isOverlay` | Null-safe discriminator check used by that filter |

`vision.js` runs its per-officer candidate list through `detectorInput` before
any optics gate is applied, so detection counts are provably identical whether
or not overlays are present. The test suite asserts exactly that: two pipelines
over identical worlds, one publishing poses and one not, produce byte-identical
detections.

`bypassedCount(feed)` and the pipeline's `bypassed` counter expose how many
layers were kept out, and the UI surfaces it — the bypass is observable, not a
claim in a comment.

## Opacity and fade

A received layer's alpha is the operator's ceiling multiplied by an age fade:

| Stage | Alpha |
| --- | --- |
| `ageMs ≤ holdMs` (400 ms) | full `opacity` |
| across `fadeMs` (600 ms) | linear down to `minOpacity` |
| beyond both | dropped and pruned |

So a teammate's figure fades out on its own when their camera loses the
subject, instead of hanging on the glass as a stale ghost. The **Overlay
opacity** slider sets the ceiling; the default 0.35 is deliberately faint, so
the overlay informs the officer without obscuring what their own camera sees.

An officer never receives their own published frames — those are their direct
detections and are drawn solid. `includeSelf` exists for debugging.

## Configuring it

```js
import { StereoVisionPipeline } from "./src/vision.js";

const pipeline = new StereoVisionPipeline({
  poses: true,                              // estimate and publish skeletons
  skeleton: { height: 42, swing: 0.62 },    // gait, in simulation units
  overlay: { opacity: 0.35, holdMs: 400, fadeMs: 600 },
});

const { detections, tracks, skeletons, bypassed } = pipeline.update(world);
const layers = pipeline.overlaysFor("P2");  // what P2 draws from teammates
const feed = pipeline.feedFor(world, "P2"); // subjects + overlays, separated
```

## New controls

| Control | Effect |
| --- | --- |
| **Skeleton overlay** | Draws poses at all — off returns the view to plain contacts |
| **Overlay opacity** | Ceiling alpha for teammate-published skeletons, 0–100% |

The **Pose overlays** panel reports published frames, received layers, mean
joint confidence and the running bypass count.

## Scope limits

Poses are synthesised from the tracker's position, heading and speed — there is
no trained pose-estimation model, no image-space keypoint regression and no
limb-length calibration from real imagery. The per-joint scores model
self-occlusion geometrically rather than measuring matcher confidence. What is
real is the plumbing: the keypoint model, the publish/subscribe path, the fade,
and above all the detector bypass, all of which a camera-backed estimator would
reuse unchanged.

See [the stereo vision guide](VISION.md) for how subjects are detected in the
first place, and [the 3D simulation guide](SIMULATION.md) for the controls.
