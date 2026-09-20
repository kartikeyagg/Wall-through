# The minimap

A corner map of the hall, drawn over the 3D view: the floor plan, where the
officers are, where the people the team has found are, and which pucks are
down. It answers the question the 3D view is bad at — *where is everyone right
now* — without leaving the scene.

## What it is allowed to draw

The minimap is an operator display, so it may only show what the network
actually knows. This is the same rule the rest of the system follows, and it is
the whole reason the map is interesting rather than a cheat sheet.

| Layer | Source | Why |
| --- | --- | --- |
| Officers | Published self-localization estimates | What each officer reports about themselves, not where they truly are |
| People | Detected tracks only | A person nobody has sensed is not on the map |
| Walls | The floor plan | Building geometry is known before anyone enters |
| Pucks | Located pucks only | A puck that has not been geolocated has no known position |

**Officer blips sit at the estimated pose, not the true one.** The stereo-map
and compass solution carries deliberate error, and the optional IMU correction
is noisy on purpose, so a blip drifts exactly as far as that officer's own
estimate is wrong. Watching a blip lag its officer is the feature working. Turn
**IMU integration** off and on and the drift changes character — the **Self
localization** panel reports the same error numerically for the selected
officer.

**People appear only once a sensor has found them.** The map is not a radar
sweep of ground truth. A person behind a wall that no camera has resolved and
no puck has painted is simply absent, and appears the moment a sensor reports
them. Blips carry what the team knows about each track:

- yellow for the selected officer's own detections, lime for a teammate's
- violet while a track is radar-only, until stereo fuses with it
- hollow and faded while a track is coasting on predicted motion
- greyed once an officer has cleared that person as a false positive

Because clearances lapse when a person leaves sight, a cleared blip that
wanders out of view and returns comes back flagged. See
[the threat-tagging guide](THREAT-TAGGING.md).

## Using it

| Control | Purpose |
| --- | --- |
| `+` / `−`, or scroll over the map | Zoom in and out |
| `N` / `HDG` | Switch between north-up and heading-up |
| `□` / `×` | Expand to the full floor plan and collapse again |
| Click a blip | Select that officer |

Heading-up rotates the world around a fixed wedge at the centre, so forward is
always up — the orientation to use while driving an officer. North-up keeps the
plan fixed, which is easier for reading the building and comparing positions
across the team. Both draw a north indicator.

Expanding gives the whole hall at once, for checking spread and coverage rather
than immediate surroundings.

## Where it sits in the pipeline

The minimap consumes the same projections the rest of the UI does and adds no
sensing of its own. `src/minimap.js` holds the pure parts — projection between
world and map space, blip assembly, view clamping, and hit testing — so the
rules above are unit-tested without a browser. `src/Minimap.tsx` is the canvas
renderer and reads from refs, so a sixty-hertz map never re-renders the page.

Nothing on the minimap re-enters detection. Like the skeleton overlay, it is
paint on the glass; see [the skeleton overlay guide](SKELETON.md) for why that
seam matters.
