"""A cleaned landmark track to the keyframe clip JSON the app plays.

The format is checked on the TypeScript side by the zod schema in
``features/digital-twin/motion/keyframe-clip.ts``; keep the two in step.

- ``joints``: joint ids, in the order of each frame's quaternions.
- ``frames``: one row per frame, four numbers (x, y, z, w) per joint: the
  joint's rotation relative to its parent in the body frame (x left, y up,
  z forward), on top of the rig's bind pose.
- ``pelvisShift``: per frame, metres toward the subject's left that the hips
  sit over the midpoint of the ankles, scaled to the ANNY body's legs.
- Root motion is removed: the clip plays in place. Travel across the floor,
  forward or sideways, is dropped; the up and down of the body comes back on
  its own because the app keeps the lowest foot on the floor, so bent knees
  lower the hips.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from retarget import (
    ANKLE,
    JOINTS,
    SHOULDER,
    frame_rotations,
    head_relative,
    leg_length,
)
from rotations import axis_angle, matrix_from_quat, normalize, quat_from_matrix

FORMAT = "twinllm.motion-clip"
VERSION = 1
#: Hip to knee to ankle on the ANNY adult male bind pose, metres.
RIG_LEG_LENGTH = 0.948
DIGITS = 4


def level(track: np.ndarray) -> tuple[np.ndarray, float]:
    """Removes a camera's tilt up or down: rotates every frame about the
    left-right axis so the clip's average ankles-to-shoulders direction is
    vertical. Returns the track and the tilt removed, in degrees."""
    shoulders = 0.5 * (track[:, SHOULDER["L"]] + track[:, SHOULDER["R"]])
    ankles = 0.5 * (track[:, ANKLE["L"]] + track[:, ANKLE["R"]])
    mean = normalize(np.mean([normalize(v) for v in shoulders - ankles], axis=0))
    tilt = float(np.arctan2(mean[2], mean[1]))
    rotation = axis_angle(np.array([1.0, 0, 0]), -tilt)
    return track @ rotation.T, float(np.degrees(tilt))


def median_rotation(matrices: list[np.ndarray]) -> np.ndarray:
    """A robust average rotation: the normalised mean quaternion of the frames
    whose angle from a first mean is at or below the median."""
    quats = np.array([quat_from_matrix(m) for m in matrices])
    mean = normalize(quats.mean(axis=0))
    dots = np.abs(quats @ mean)
    keep = quats[dots >= np.median(dots)]
    signs = np.sign(keep @ mean)[:, None]
    return matrix_from_quat(normalize((keep * signs).mean(axis=0)))


def _continuous(rows: list[np.ndarray]) -> list[np.ndarray]:
    """Flips each quaternion's sign to the hemisphere of the previous frame's,
    so linear reading and slerp never go the long way round."""
    out: list[np.ndarray] = []
    for q in rows:
        prev = out[-1] if out else None
        out.append(-q if prev is not None and float(np.dot(prev, q)) < 0 else q)
    return out


def build_clip(
    track: np.ndarray,
    fps: float,
    *,
    name: str,
    source: dict[str, Any],
    licence: str,
    generator: dict[str, Any],
    calibrate_head: bool = True,
    crossfade_s: float = 0.5,
) -> dict[str, Any]:
    """The clip dictionary for a cleaned body-frame track (frames x 33 x 3)."""
    head_rest = (
        median_rotation([head_relative(p) for p in track]) if calibrate_head else None
    )
    scale = RIG_LEG_LENGTH / float(np.median([leg_length(p) for p in track]))
    per_frame = [frame_rotations(p, head_rest) for p in track]
    columns = {
        joint: _continuous([f.quaternions()[joint] for f in per_frame]) for joint in JOINTS
    }
    frames = [
        [round(float(v), DIGITS) + 0.0 for joint in JOINTS for v in columns[joint][i]]
        for i in range(len(track))
    ]
    shift = [round(f.hips_over_feet * scale, DIGITS) + 0.0 for f in per_frame]
    return {
        "format": FORMAT,
        "version": VERSION,
        "name": name,
        "fps": fps,
        "frameCount": len(frames),
        "loop": {"crossfadeS": crossfade_s},
        "joints": list(JOINTS),
        "frames": frames,
        "pelvisShift": shift,
        "source": source,
        "licence": licence,
        "generator": generator,
    }

