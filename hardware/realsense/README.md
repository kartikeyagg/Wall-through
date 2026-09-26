# Intel RealSense D415 capture

This is the physical-camera capture path for the D415. It never overwrites raw
material: each session keeps the native RealSense bag plus separate lossless
RGB, Z16 depth, left-IR and right-IR files before any point cloud is made.

## Install and verify

Connect the D415 directly to a USB 3 port, then run:

```sh
./hardware/realsense/install.sh
./hardware/realsense/.venv/bin/python hardware/realsense/record_d415.py \
  --session data/realsense/2026-09-26-officer-01 --seconds 30
```

The run creates:

```text
session/
  manifest.json                         # device serial, calibration, depth scale
  frames.jsonl                          # source timestamps/frame numbers
  raw/realsense.bag                     # native, replayable source of truth
  raw/rgb/*.png                         # BGR8 camera feed (one file per exposure)
  raw/depth-z16/*.png                   # unmodified depth units; scale in manifest
  raw/ir-left-y8/*.png, ir-right-y8/*.png
  raw/imu/imu.jsonl                     # reserved for your external IMU samples
  processed/camera-frame-clouds/*.ply   # decimated coloured point clouds
```

`realsense-viewer` and `rs-enumerate-devices` are useful diagnostics. They need
the official librealsense apt repository and administrator access:

```sh
sudo apt install librealsense2-utils librealsense2-dev
rs-enumerate-devices -s
```

## Make the full 3D map

Your VIO/SLAM process must emit one JSON object per line with the camera-frame
timestamp, `translation_m`, `quaternion_xyzw`, and optional `valid: false`.
The transform is `world_from_camera`; all timestamps must use the same camera
clock domain as `frames.jsonl`. Then fuse the derived camera clouds:

```sh
./hardware/realsense/.venv/bin/python hardware/realsense/build_map.py \
  --session data/realsense/2026-09-26-officer-01 \
  --poses data/realsense/2026-09-26-officer-01/processed/vio-poses.jsonl
```

It writes `processed/world-map.ply`. A pose mismatch is skipped and reported,
never silently aligned. For two officers, first transform both trajectories to
the same surveyed/AprilTag world frame, then combine their world maps.

## Important D415 limitation

The D415 has **no IMU**, therefore it cannot make an honest world-locked 3D map
while the officer walks. It can collect excellent aligned RGB/depth/IR and
camera-frame clouds. For a full 3D map, add a rigidly mounted external IMU
(BNO085 or BMI088 are sensible choices), calibrate its transform to the camera,
and log its samples with timestamps to `raw/imu/imu.jsonl`. Feed that, together
with VIO/SLAM poses, into the mapping stage. Never use an uncalibrated IMU
orientation as a map pose.

For two officers, record one session per rig and synchronise clocks before the
trial. The data that can be collected is: time-synchronised colour/stereo/depth,
per-camera calibration and exposure timestamps, external IMU gyro/acceleration,
VIO trajectory/covariance, 3D point clouds/maps, anonymous person tracks and
3D skeletons. Avoid face identity data unless policy, consent, retention and
access controls specifically authorise it.
