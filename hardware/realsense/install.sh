#!/usr/bin/env bash
# Installs the user-space capture dependencies.  No sudo is required.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
venv_dir="$script_dir/.venv"

python3 -m venv "$venv_dir"
# Ubuntu 22.04's bundled pip has compatible Python 3.9 wheels for librealsense.
# Do not upgrade it before this install: newer pip releases can reject those
# legacy manylinux wheels even though the D415 binding works correctly.
"$venv_dir/bin/python" -m pip install -r "$script_dir/requirements.txt"

cat <<'EOF'

Installed Python capture dependencies.

Connect the D415 directly to a USB 3 port, then run:
  ./hardware/realsense/.venv/bin/python hardware/realsense/record_d415.py --session data/realsense/session-001

Optional RealSense Viewer / device diagnostic tools require the official
librealsense apt repository and administrator access.  Once that repository
is configured, install them with:
  sudo apt install librealsense2-utils librealsense2-dev

The D415 has no IMU.  Add a rigidly-mounted external IMU (for example BNO085
or BMI088) and store its calibrated pose samples in raw/imu/imu.jsonl.
EOF
