#!/usr/bin/env python3
"""Fuse D415 camera-frame PLYs into a world map using external VIO/SLAM poses.

Input poses must be calibrated world-from-camera poses produced by a real VIO or
SLAM system. This program intentionally refuses to invent poses from D415 data:
the D415 contains no IMU.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

VERTEX = np.dtype([("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
                   ("red", "u1"), ("green", "u1"), ("blue", "u1")])


def quaternion_matrix(q: list[float]) -> np.ndarray:
    x, y, z, w = np.asarray(q, dtype=float)
    norm = np.linalg.norm((x, y, z, w))
    if norm == 0:
        raise ValueError("zero quaternion")
    x, y, z, w = x / norm, y / norm, z / norm, w / norm
    return np.array([[1 - 2*(y*y + z*z), 2*(x*y - z*w), 2*(x*z + y*w)],
                     [2*(x*y + z*w), 1 - 2*(x*x + z*z), 2*(y*z - x*w)],
                     [2*(x*z - y*w), 2*(y*z + x*w), 1 - 2*(x*x + y*y)]])


def read_ply(path: Path) -> np.ndarray:
    with path.open("rb") as handle:
        count = None
        while True:
            line = handle.readline().decode("ascii").strip()
            if line.startswith("element vertex "):
                count = int(line.split()[-1])
            if line == "end_header":
                break
        if count is None:
            raise ValueError(f"no vertex count in {path}")
        return np.fromfile(handle, dtype=VERTEX, count=count)


def write_ply(path: Path, vertices: np.ndarray) -> None:
    with path.open("wb") as handle:
        handle.write(("ply\nformat binary_little_endian 1.0\n"
                      f"element vertex {len(vertices)}\nproperty float x\nproperty float y\nproperty float z\n"
                      "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n").encode())
        handle.write(vertices.tobytes())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", type=Path, required=True)
    parser.add_argument("--poses", type=Path, required=True,
                        help="JSONL: timestamp_ns, translation_m [x,y,z], quaternion_xyzw [x,y,z,w]")
    parser.add_argument("--voxel-m", type=float, default=0.03)
    args = parser.parse_args()
    poses = {int(row["timestamp_ns"]): row for row in
             map(json.loads, args.poses.read_text().splitlines()) if row.get("valid", True)}
    all_points: list[np.ndarray] = []
    skipped = 0
    for cloud in sorted((args.session / "processed" / "camera-frame-clouds").glob("*.ply")):
        timestamp = int(cloud.stem.split("_")[-1])
        pose = poses.get(timestamp)
        if pose is None:
            skipped += 1
            continue
        points = read_ply(cloud)
        xyz = np.column_stack((points["x"], points["y"], points["z"]))
        xyz = xyz @ quaternion_matrix(pose["quaternion_xyzw"]).T + np.asarray(pose["translation_m"])
        points = points.copy()
        points["x"], points["y"], points["z"] = xyz.T
        all_points.append(points)
    if not all_points:
        raise SystemExit("No cloud timestamps matched poses. Check timestamp clock domains and calibration.")
    merged = np.concatenate(all_points)
    cells = np.floor(np.column_stack((merged["x"], merged["y"], merged["z"])) / args.voxel_m).astype(np.int64)
    _, first = np.unique(cells, axis=0, return_index=True)
    fused = merged[np.sort(first)]
    output = args.session / "processed" / "world-map.ply"
    write_ply(output, fused)
    print(f"Wrote {len(fused):,} voxel-filtered points to {output} ({skipped} clouds lacked a pose).")


if __name__ == "__main__":
    main()
