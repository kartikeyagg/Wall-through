# Thrown mmWave radar puck

An officer can throw a radar puck into the next room. It arcs from the hand,
bounces from walls, skids, and settles on the floor. Its millimetre-wave radar
can report moving bodies through drywall, where a stereo camera cannot see
through an opaque wall.

## Throwing and recalling a puck

Use **F** or **Throw sensor** to throw a puck along the selected officer's
heading. The kit holds four pucks at once. Use **Recall** on a deployed puck to
remove it and free that slot.

A puck collides with the walls instead of passing over them. Walls in this
world run from floor to ceiling, so a throw does not clear a barrier. The
flight model applies gravity, air drag, wall bounces, and a resting threshold;
once the puck settles, it remains where it stopped.

## Geolocating a puck

A thrown puck does not know where it landed. Officers' stereo rigs must fix
its marker, and `SensorLocalizer` combines those fixes into an estimate. Each
fix is weighted by inverse variance, while the estimate covariance ages as a
random walk between fixes. This makes a newer, more precise observation count
more without treating the old estimate as permanently certain.

No fix is taken while the puck is airborne. Averaging positions from a moving
trajectory into one point would be worse than reporting no location. Once it
has settled, fixes are taken every 200 ms rather than every render frame:
consecutive frames share the same viewing error, so treating them as
independent evidence would collapse covariance below the real accuracy.

The marker rig has a looser pixel-height gate than the person detector. Its
retroreflective marker is a known bright beacon, while person detection has to
recognise a body; those are different problems. A puck is **located** only
after it is settled, has at least one usable fix, and its estimated one-sigma
position error is at or below the localizer's location threshold.

The sensor panel reports four states:

| State | Meaning |
| --- | --- |
| **IN FLIGHT** | The puck is airborne. It has no fixes and does not report radar. |
| **UNLOCATED** | It is settled, but no camera can currently fix its marker. |
| **TAGGING** | It has fixes, but the estimate is not yet accurate enough to use. |
| **LOCATED** | The estimate is trusted; the panel shows its location, uncertainty, and fix count, and the puck can report radar. |

## Returns and tracking

The radar measures range, bearing, and Doppler. The default radar has an
18 m maximum range, a 0.25 m minimum range, a 240° field of view, 0.06 m
one-sigma range error, 0.055 rad one-sigma bearing error, and 0.12 m/s
one-sigma Doppler error. Range is precise but bearing is not: a return's
position uncertainty is an ellipse stretched across the puck's line of sight,
and that cross-range uncertainty grows with range.

`MmWaveTracker` is an extended Kalman filter with state `x, vx, y, vy` and a
constant-velocity process model. It uses the analytic Jacobian of the polar
range, bearing, and radial-velocity measurement. Doppler therefore constrains
motion along the line of sight instead of leaving velocity to be inferred only
from later positions. Candidate updates are gated by normalized innovation
distance, associated greedily from the smallest value, confirmed after two
hits, and expired after 900 ms without a report.

That gate is deliberately wider than the textbook chi-square value. A
constant-velocity model under-describes people who turn on the spot and rebound
off walls, so during a turn the filter is more confident than it deserves to
be and rejects a perfectly good return. Each rejection starts a rival track:
at the textbook gate, one puck accumulated twelve track ids and nine
simultaneous ghosts for three bodies over twenty-five seconds. The wider gate
costs no detections and holds one track per body.

Returns carry no identity. `associateRadarTracks` matches a radar track to a
nearby stereo track ID on the ground plane, so the radar and stereo reports
correct the same motion filter. Without a match, the radar track remains its
own radar-only contact, which is normally a person no camera can see.

## Through drywall

The link budget starts at 62 dB at one metre, loses 40 dB per decade of range
for the two-way path, loses 7.5 dB for each wall crossing, and requires 12 dB
to detect a return. With the default maximum-range cap, that is 18 m in clear
air, about 11.5 m through one wall, and 7.5 m through two walls. A third wall
does not pass a return: `maxWalls` is two regardless of the remaining budget.

## Estimated origin, visible error

Radar returns are read from the estimated puck pose, not its hidden true pose.
Localization error therefore propagates into the radar tracks. The scene draws
the puck's estimate marker where the estimate is, which makes that dependency
visible rather than concealing it behind a perfect origin.

## Trying it

Select an officer facing a wall and press **F**. Watch the puck arc, settle,
and move through tagging to located as a stereo rig fixes its marker. A moving
body in the far room can then appear as a violet radar track. Turn on **Radar
coverage rings** in Simulation settings to show the ground footprint of each
located puck's coverage.

## Scope limits

This is not real radar hardware, RF propagation, micro-Doppler gait
classification, or a dielectric model of drywall. It is a deliberate,
legible approximation behind the same provider seam a physical puck would use.
