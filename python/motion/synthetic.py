"""Synthetic landmarks made from known joint rotations, for tests and fixtures.

``landmarks_for`` is forward kinematics on the same rest pose ``retarget.py``
assumes: give it local rotations per joint and it places the 33 MediaPipe
landmarks a body in that pose would have (body frame, metres). No video is
involved, so the fixtures carry no one's footage or movement.

    uv run --group motion motion/synthetic.py

rewrites ``motion/fixtures/synthetic-landmarks.json`` (a short sway with arm
and knee bends, in the landmark file format ``video_to_clip.py`` reads) and
the clip made from it, ``features/digital-twin/motion/fixtures/synthetic-clip.json``,
which the TypeScript player's tests load.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from retarget import (
    ANKLE,
    EAR,
    ELBOW,
    HEEL,
    HIP,
    KNEE,
    LANDMARK_COUNT,
    LEFT,
    NOSE,
    REST_FOOT,
    REST_FOREARM,
    REST_NOSE,
    REST_SHIN,
    REST_THIGH,
    REST_UPPER_ARM,
    SHOULDER,
    TOE,
    UP,
    WRIST,
)
from rotations import axis_angle, normalize

HERE = Path(__file__).resolve().parent
LANDMARKS_FIXTURE = HERE / "fixtures" / "synthetic-landmarks.json"
CLIP_FIXTURE = (
    HERE.parents[1] / "features" / "digital-twin" / "motion" / "fixtures" / "synthetic-clip.json"
)
FIXTURE_FPS = 12.0
PIXELS_PER_METRE = 200.0

MIRROR = np.array([-1.0, 1.0, 1.0])


def _side(v: np.ndarray, side: str) -> np.ndarray:
    return v if side == "L" else v * MIRROR


def elbow_axis(side: str) -> np.ndarray:
    """The axis a pure elbow bend turns about (the rest bend plane's normal)."""
    return normalize(np.cross(_side(REST_UPPER_ARM, side), _side(REST_FOREARM, side)))


def knee_axis(side: str) -> np.ndarray:
    return normalize(np.cross(_side(REST_THIGH, side), _side(REST_SHIN, side)))


def ankle_axis(side: str) -> np.ndarray:
    return normalize(np.cross(UP, _side(REST_FOOT, side)))


def landmarks_for(local: dict[str, np.ndarray]) -> np.ndarray:
    """Body-frame landmarks (33 x 3) for local joint rotations (identity when absent)."""
    def r(name: str) -> np.ndarray:
        return local.get(name, np.eye(3))

    p = np.zeros((LANDMARK_COUNT, 3))
    pelvis = r("pelvis")
    chest = pelvis @ r("spineLower") @ r("spineUpper")
    shoulders = chest @ np.array([0.0, 0.52, 0.0])
    for side, sign in (("L", 1.0), ("R", -1.0)):
        hip = pelvis @ np.array([sign * 0.12, 0.0, 0.0])
        thigh = pelvis @ r(f"upperLeg{side}")
        shin = thigh @ r(f"lowerLeg{side}")
        foot = shin @ r(f"foot{side}")
        knee = hip + thigh @ _side(REST_THIGH, side) * 0.47
        ankle = knee + shin @ _side(REST_SHIN, side) * 0.475
        heel = ankle + foot @ np.array([0.0, -0.07, -0.05])
        p[HIP[side]], p[KNEE[side]], p[ANKLE[side]], p[HEEL[side]] = hip, knee, ankle, heel
        p[TOE[side]] = heel + foot @ _side(REST_FOOT, side) * 0.22

        shoulder = shoulders + chest @ np.array([sign * 0.2, 0.0, 0.0])
        upper = chest @ r(f"upperArm{side}")
        fore = upper @ r(f"lowerArm{side}")
        elbow = shoulder + upper @ _side(REST_UPPER_ARM, side) * 0.3
        wrist = elbow + fore @ _side(REST_FOREARM, side) * 0.29
        p[SHOULDER[side]], p[ELBOW[side]], p[WRIST[side]] = shoulder, elbow, wrist
    for hand in range(17, 23):
        p[hand] = p[WRIST["L"] if hand % 2 == 1 else WRIST["R"]]
    head = chest @ r("head")
    ears = shoulders + chest @ np.array([0.0, 0.1, 0.0]) + head @ np.array([0.0, 0.1, 0.0])
    p[EAR["L"]] = ears + head @ (LEFT * 0.075)
    p[EAR["R"]] = ears - head @ (LEFT * 0.075)
    p[NOSE] = ears + head @ (REST_NOSE * 0.104)
    for face in (1, 2, 3, 4, 5, 6, 9, 10):
        p[face] = p[NOSE]
    return p


def to_mediapipe(body: np.ndarray) -> np.ndarray:
    """Body frame back to MediaPipe's world convention (x right in the image, y down, z away)."""
    return body * np.array([1.0, -1.0, -1.0])


def sway_frame(i: int, frames: int) -> dict[str, np.ndarray]:
    """One frame of the fixture: a hip sway with bending arms and knees."""
    u = 2 * np.pi * i / frames
    return {
        "pelvis": axis_angle(UP, np.radians(15 * np.sin(u))) @ axis_angle(
            np.array([0.0, 0, 1]), np.radians(5 * np.sin(u))
        ),
        "spineLower": axis_angle(np.array([0.0, 0, 1]), np.radians(-4 * np.sin(u))),
        "spineUpper": axis_angle(np.array([0.0, 0, 1]), np.radians(-4 * np.sin(u))),
        "upperArmL": axis_angle(LEFT, np.radians(-40 - 20 * np.sin(u))),
        "upperArmR": axis_angle(LEFT, np.radians(-30 + 20 * np.sin(u))),
        "lowerArmL": axis_angle(elbow_axis("L"), np.radians(50 + 20 * np.cos(u))),
        "lowerArmR": axis_angle(elbow_axis("R"), np.radians(60 - 20 * np.cos(u))),
        "upperLegL": axis_angle(LEFT, np.radians(20 + 10 * np.sin(u))),
        "upperLegR": axis_angle(LEFT, np.radians(20 - 10 * np.sin(u))),
        "lowerLegL": axis_angle(knee_axis("L"), np.radians(35 + 10 * np.sin(u))),
        "lowerLegR": axis_angle(knee_axis("R"), np.radians(35 - 10 * np.sin(u))),
        "footL": axis_angle(ankle_axis("L"), np.radians(10 * np.cos(u))),
        "footR": axis_angle(ankle_axis("R"), np.radians(-10 * np.cos(u))),
        "head": axis_angle(UP, np.radians(10 * np.sin(u))),
    }


def fixture_landmarks(frames: int = 12) -> dict:
    """The landmark file for the fixture, as ``video_to_clip.py --landmarks-out`` writes it."""
    world, image = [], []
    for i in range(frames):
        mp_points = to_mediapipe(landmarks_for(sway_frame(i, frames)))
        world.append(np.round(mp_points, 6).tolist())
        image.append(np.round(mp_points[:, :2] * PIXELS_PER_METRE + [360.0, 500.0], 4).tolist())
    return {
        "fps": FIXTURE_FPS,
        "size": [720, 1000],
        "crop": [0, 0, 720, 1000],
        "world": world,
        "image": image,
        "visibility": [[1.0] * LANDMARK_COUNT for _ in range(frames)],
        "source": {"synthetic": "python/motion/synthetic.py (sway_frame)"},
    }


def main() -> int:
    from video_to_clip import main as convert  # noqa: PLC0415

    LANDMARKS_FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    LANDMARKS_FIXTURE.write_text(json.dumps(fixture_landmarks()) + "\n")
    CLIP_FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    return convert(
        [
            "--from-landmarks",
            str(LANDMARKS_FIXTURE),
            "--out",
            str(CLIP_FIXTURE),
            "--name",
            "Synthetic sway",
            "--licence",
            "Synthetic test data, Apache-2.0 like the code that makes it.",
            # The sway bends the knees throughout, so levelling would tilt it.
            "--no-level",
        ]
    )


if __name__ == "__main__":
    raise SystemExit(main())
