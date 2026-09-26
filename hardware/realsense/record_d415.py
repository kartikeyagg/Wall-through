#!/usr/bin/env python3
"""Losslessly record an Intel RealSense D415 session.

The native .bag is the source of truth.  Per-stream PNG files are deliberately
also written so RGB, depth, left IR, and right IR remain independently usable.
No rendered or annotated image is ever substituted for a camera input.
"""
from __future__ import annotations

import argparse
import json
import signal
import time
from pathlib import Path

import cv2
import numpy as np
import pyrealsense2 as rs


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", required=True, type=Path,
                        help="new directory for this recording")
    parser.add_argument("--seconds", type=float, default=0,
                        help="stop after this many seconds (0 = Ctrl-C)")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--fps", type=int, default=30)
    return parser.parse_args()


def mkdirs(root: Path) -> dict[str, Path]:
    if root.exists() and any(root.iterdir()):
        raise SystemExit(f"Refusing to append to non-empty session: {root}")
    paths = {
        "bag": root / "raw" / "realsense.bag",
        "rgb": root / "raw" / "rgb",
        "depth": root / "raw" / "depth-z16",
        "ir_left": root / "raw" / "ir-left-y8",
        "ir_right": root / "raw" / "ir-right-y8",
        "imu": root / "raw" / "imu",
        "cloud": root / "processed" / "camera-frame-clouds",
    }
    for value in paths.values():
        value.parent.mkdir(parents=True, exist_ok=True)
    for key in ("rgb", "depth", "ir_left", "ir_right", "imu", "cloud"):
        paths[key].mkdir(parents=True, exist_ok=True)
    return paths


def stream_metadata(profile: rs.pipeline_profile, depth_scale: float) -> dict:
    streams = []
    for stream in profile.get_streams():
        item = {"stream": str(stream.stream_type()), "index": stream.stream_index(),
                "format": str(stream.format()), "fps": stream.fps()}
        if stream.is_video_stream_profile():
            video = stream.as_video_stream_profile()
            intrinsics = video.get_intrinsics()
            item.update({"width": video.width(), "height": video.height(),
                         "intrinsics": {"fx": intrinsics.fx, "fy": intrinsics.fy,
                                        "ppx": intrinsics.ppx, "ppy": intrinsics.ppy,
                                        "model": str(intrinsics.model),
                                        "coeffs": list(intrinsics.coeffs)}})
        streams.append(item)
    return {"schema": 1, "device": "Intel RealSense D415 (reported device is recorded below)",
            "created_unix_ns": time.time_ns(), "depth_scale_metres": depth_scale,
            "streams": streams,
            "coordinate_frame": "camera optical frame: +x right, +y down, +z forward",
            "map_note": "D415 has no IMU. Camera-frame clouds are not a world map; use calibrated external-IMU/VIO poses with build_map.py."}


def write_cloud(path: Path, depth: np.ndarray, color: np.ndarray, intr: rs.intrinsics,
                scale: float) -> int:
    """Write an organized, decimated camera-frame point cloud as binary PLY."""
    step = 4
    z = depth[::step, ::step].astype(np.float32) * scale
    rows, cols = np.indices(z.shape, dtype=np.float32)
    u, v = cols * step, rows * step
    valid = (z > 0.15) & (z < 10.0)
    x = (u - intr.ppx) * z / intr.fx
    y = (v - intr.ppy) * z / intr.fy
    rgb = color[::step, ::step]
    vertices = np.empty(valid.sum(), dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
                                             ("red", "u1"), ("green", "u1"), ("blue", "u1")])
    vertices["x"], vertices["y"], vertices["z"] = x[valid], y[valid], z[valid]
    # OpenCV exposes the D415 colour frame as BGR; PLY colour fields are RGB.
    vertices["red"], vertices["green"], vertices["blue"] = rgb[valid, 2], rgb[valid, 1], rgb[valid, 0]
    with path.open("wb") as handle:
        handle.write(("ply\nformat binary_little_endian 1.0\n"
                      f"element vertex {len(vertices)}\nproperty float x\nproperty float y\nproperty float z\n"
                      "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n").encode())
        handle.write(vertices.tobytes())
    return len(vertices)


def main() -> None:
    args = parse_args()
    paths = mkdirs(args.session)
    pipeline, config = rs.pipeline(), rs.config()
    config.enable_stream(rs.stream.color, args.width, args.height, rs.format.bgr8, args.fps)
    config.enable_stream(rs.stream.depth, args.width, args.height, rs.format.z16, args.fps)
    config.enable_stream(rs.stream.infrared, 1, args.width, args.height, rs.format.y8, args.fps)
    config.enable_stream(rs.stream.infrared, 2, args.width, args.height, rs.format.y8, args.fps)
    config.enable_record_to_file(str(paths["bag"]))

    profile = pipeline.start(config)
    device = profile.get_device()
    depth_scale = device.first_depth_sensor().get_depth_scale()
    metadata = stream_metadata(profile, depth_scale)
    metadata["device_info"] = {key: device.get_info(key) for key in
                               (rs.camera_info.name, rs.camera_info.serial_number, rs.camera_info.firmware_version)
                               if device.supports(key)}
    (args.session / "manifest.json").write_text(json.dumps(metadata, indent=2) + "\n")
    color_intr = profile.get_stream(rs.stream.color).as_video_stream_profile().get_intrinsics()
    align = rs.align(rs.stream.color)
    running, frame_number, started = True, 0, time.monotonic()

    def stop(*_unused: object) -> None:
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    print(f"Recording to {args.session}; Ctrl-C stops cleanly.")
    try:
        while running and (not args.seconds or time.monotonic() - started < args.seconds):
            try:
                frames = align.process(pipeline.wait_for_frames(1000))
            except RuntimeError as error:
                print(f"Frame timeout/error: {error}")
                continue
            color_f, depth_f = frames.get_color_frame(), frames.get_depth_frame()
            left_f, right_f = frames.get_infrared_frame(1), frames.get_infrared_frame(2)
            if not all((color_f, depth_f, left_f, right_f)):
                continue
            timestamp_ns = int(depth_f.get_timestamp() * 1_000_000)
            stem = f"{frame_number:08d}_{timestamp_ns}"
            color, depth = np.asanyarray(color_f.get_data()), np.asanyarray(depth_f.get_data())
            cv2.imwrite(str(paths["rgb"] / f"{stem}.png"), color)
            cv2.imwrite(str(paths["depth"] / f"{stem}.png"), depth)
            cv2.imwrite(str(paths["ir_left"] / f"{stem}.png"), np.asanyarray(left_f.get_data()))
            cv2.imwrite(str(paths["ir_right"] / f"{stem}.png"), np.asanyarray(right_f.get_data()))
            if frame_number % 10 == 0:
                points = write_cloud(paths["cloud"] / f"{stem}.ply", depth, color, color_intr, depth_scale)
                print(f"frame {frame_number}: saved {points} camera-frame points")
            with (args.session / "frames.jsonl").open("a") as log:
                log.write(json.dumps({"frame": frame_number, "timestamp_ns": timestamp_ns,
                                      "depth_frame_number": depth_f.get_frame_number(),
                                      "color_frame_number": color_f.get_frame_number()}) + "\n")
            frame_number += 1
    except KeyboardInterrupt:
        pass
    finally:
        pipeline.stop()
        print(f"Stopped after {frame_number} frames. Raw bag and separated streams retained in {args.session}.")


if __name__ == "__main__":
    main()
