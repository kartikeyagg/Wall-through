# Threat tagging and clearance

Sensors detect people, not intent. When three people are in view, the system
flags all three; one is hostile in the lab scenario, but the detection path
does not know which one. The officer supplies that judgement by clearing a
false positive.

## Clearing a live track

Use **Not a terrorist** on a live-track row, or click the person in the 3D
view. Both gestures toggle the correction and attribute it to the selected
officer. A cleared track can be restored with **Re-flag** by either gesture.

## Shared registry

`ThreatRegistry` is one registry for the whole team. A clearance made by one
officer is immediately true in every officer's projection, and any officer can
restore it. Unknown tracks default to `hostile`; the two states are `hostile`
and `cleared`.

Each entry is an audit record: it retains the track ID, original clearing
officer, timestamp, optional reason, and a revision counter. Restoring an entry
retains that original clearance record and adds who restored it and when. The
revision increments on every change, so a later correction is distinguishable
from the earlier decision it replaced.

## A clearance is vouched only while the person is in sight

An officer clearing a body is vouching for a person they can see. Once that
person passes out of sensor sight, nobody can vouch for who walks back in, so
the clearance lapses and the body is flagged again on reappearance. The
conservative default is the safe one: the cost of re-asking is a nuisance, and
the cost of a stale clearance is a hostile waved through.

`observeSight(inSightTrackIds, timestamp)` is told each frame which tracks a
live sensor currently resolves. Sight means a live measurement, not a
prediction: the motion tracker keeps coasting a track after every sensor has
lost it, and a coasting track is *not* in sight. Without that distinction a
cleared bystander could walk behind a wall and stay cleared on the strength of
the filter's own extrapolation.

A cleared track out of sight for longer than `sightGraceMs` reverts to
`hostile`. The default is 1200 ms, long enough that one dropped frame or a
moment behind a door frame does not make the flag thrash, short enough that
walking out of the room lapses the clearance.

A lapse is recorded distinctly from an officer's own **Re-flag**: the entry
keeps the original clearance record and adds `restoredBy: "system"` with
`restoredReason: "left sight"`, bumping `revision` like any other transition.
The audit trail therefore shows whether a person put the flag back or the rule
did. Clearing the track again afterwards works normally.

`graceMs` is a separate, longer-horizon concern: it governs when an entry is
dropped from the registry altogether rather than when a clearance lapses. Its
default is 6000 ms.

The registry also has a bounded retention policy. Its default capacity is 256
entries; when it is full, it evicts the least-recently-seen entry, using change
order to break a tie. That keeps old, absent tracks from growing the shared
audit without bound.

## What changes on screen

Cleared markers turn grey, or disappear as markers when **Hide cleared people**
is enabled. Their velocity arrow, skeleton, and Officer glasses HUD arrow are
removed. The body still renders because clearance changes a judgement, not the
fact that a person is there.

## Lab-only scoring

`scoreClearances` compares annotated observations with hostile ground truth
only in the lab. It reports `correctlyCleared`, `wronglyCleared`,
`correctlyFlagged`, and `bystandersLeftFlagged`. A correctly cleared entry is
a bystander cleared; a wrongly cleared entry is a genuine hostile cleared;
correctly flagged is a hostile still flagged; and the last counts a known
bystander nobody has cleared yet. Clearing a genuine hostile is the dangerous
error. Leaving a bystander flagged is only a nuisance.

Ground truth never enters detection or any officer-facing projection. It is
used only after the officer's correction to score the simulated scenario.
