"""3D pose landmarks to joint rotations in TwinLLM's joint vocabulary.

Input is one frame of MediaPipe Pose world landmarks (33 points, metres, origin
between the hips), already turned into the body frame of
``features/digital-twin/motion/gait.ts`` (x to the subject's left, y up, z
forward) by ``to_body_frame``. Output is, per joint, the rotation relative to
its parent in that frame, which is what ``rig-map.ts`` applies on top of the
rig's bind pose.

Rest pose. A rotation of zero means the bind pose of the rigged ANNY demo
bodies (docs/anatomy.md, "Rigged demo bodies"): upright, upper arms about 10°
out from vertical, forearms hanging about 20° in front of the upper arm, legs
straight and slightly apart, feet flat. The rest directions below were measured
on ``anny-adult-m.rigged.glb``. A segment's rotation is found by mapping its
rest direction onto the measured one; the twist about the segment comes from a
second direction:

- pelvis: the hip line, with the vertical (landmarks cannot see pelvic tilt);
- spine: hips to shoulders and the shoulder line, split evenly between the
  lower and upper spine joints;
- upper arm: the plane of the bent elbow; near straight, where that plane is
  noise, it eases to the smallest swing from the chest;
- thigh: the plane of the bent knee; near straight, the direction of the foot;
- forearm, shin, foot: the smallest swing from where the parent carries them
  (elbow and knee are hinges, so the plane above already holds their twist);
- head: the ear line and the nose.

Nothing here reads files or the network.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from rotations import (
    angle_between,
    basis_left_up,
    basis_up_left,
    blend_rotation,
    clamp_angle,
    clamp_twist,
    fraction_of,
    frame,
    normalize,
    perpendicular,
    quat_from_matrix,
    smoothstep,
    swing,
)

JOINTS: tuple[str, ...] = (
    "pelvis",
    "spineLower",
    "spineUpper",
    "clavicleL",
    "clavicleR",
    "upperArmL",
    "upperArmR",
    "lowerArmL",
    "lowerArmR",
    "upperLegL",
    "upperLegR",
    "lowerLegL",
    "lowerLegR",
    "footL",
    "footR",
    "head",
)

# MediaPipe Pose landmark indices.
NOSE = 0
EAR = {"L": 7, "R": 8}
SHOULDER = {"L": 11, "R": 12}
ELBOW = {"L": 13, "R": 14}
WRIST = {"L": 15, "R": 16}
HIP = {"L": 23, "R": 24}
KNEE = {"L": 25, "R": 26}
ANKLE = {"L": 27, "R": 28}
HEEL = {"L": 29, "R": 30}
TOE = {"L": 31, "R": 32}
LANDMARK_COUNT = 33

UP = np.array([0.0, 1.0, 0.0])
LEFT = np.array([1.0, 0.0, 0.0])

# Rest directions of the left limbs on the ANNY bind pose; the right mirrors x.
REST_UPPER_ARM = normalize(np.array([0.0534, -0.2925, 0.0056]))
REST_FOREARM = normalize(np.array([0.0139, -0.2721, 0.0966]))
REST_THIGH = normalize(np.array([0.0488, -0.4682, 0.0372]))
REST_SHIN = normalize(np.array([0.0467, -0.4724, -0.0313]))
# Heel to toe tip with the foot flat (MediaPipe's heel and foot-index points).
REST_FOOT = normalize(np.array([0.0175, 0.0, 0.1634]))
# The nose seen from between the ears with the head level: ahead and a little low.
REST_NOSE = normalize(np.array([0.0, -0.03, 0.1]))

# Limits that keep a noisy frame from twisting a limb round (radians): the
# landmarks see a limb's direction well and its turn about itself poorly.
THIGH_TWIST = np.radians(35.0)
UPPER_ARM_TWIST = np.radians(80.0)
ANKLE_MAX = np.radians(50.0)
HEAD_MAX = np.radians(40.0)

# Elbow or knee bend (radians) below which the bend plane is not trusted.
HINGE_TRUST = (np.radians(12.0), np.radians(30.0))


def to_body_frame(world: np.ndarray) -> np.ndarray:
    """MediaPipe world landmarks (x image right, y down, z away from the camera)
    to the body frame for a subject facing the camera: their left is the image's
    right, so (x, -y, -z)."""
    return np.asarray(world, dtype=float) * np.array([1.0, -1.0, -1.0])


def _mirror(v: np.ndarray, side: str) -> np.ndarray:
    return v if side == "L" else v * np.array([-1.0, 1.0, 1.0])


@dataclass(frozen=True)
class FrameRotations:
    """Local rotation matrices per joint, and the pelvis offset over the feet."""

    local: dict[str, np.ndarray]
    #: Where the hips sit over the midpoint of the ankles, metres toward the left.
    hips_over_feet: float

    def quaternions(self) -> dict[str, np.ndarray]:
        return {joint: quat_from_matrix(m) for joint, m in self.local.items()}


def _hinged(
    rest_axis: np.ndarray,
    rest_ref: np.ndarray,
    axis: np.ndarray,
    ref: np.ndarray,
) -> np.ndarray:
    """The rotation taking the rest pair (axis, reference) onto the measured pair."""
    return frame(axis, ref) @ frame(rest_axis, rest_ref).T


def _arm(p: np.ndarray, side: str, chest: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """World rotations of the upper arm and forearm."""
    rest_upper = _mirror(REST_UPPER_ARM, side)
    rest_fore = _mirror(REST_FOREARM, side)
    upper = normalize(p[ELBOW[side]] - p[SHOULDER[side]])
    fore = normalize(p[WRIST[side]] - p[ELBOW[side]])
    # Fallback: the chest carries the arm, then the smallest swing points it.
    carried = chest @ rest_upper
    fallback = swing(carried, upper) @ chest
    trust = smoothstep(*HINGE_TRUST, angle_between(upper, fore))
    if trust > 0:
        rest_plane = np.cross(rest_upper, rest_fore)
        plane = np.cross(upper, fore)
        measured = _hinged(rest_upper, rest_plane, upper, plane)
        upper_world = blend_rotation(fallback, measured, trust)
    else:
        upper_world = fallback
    upper_world = chest @ clamp_twist(chest.T @ upper_world, rest_upper, UPPER_ARM_TWIST)
    fore_world = swing(upper_world @ rest_fore, fore) @ upper_world
    return upper_world, fore_world


def _leg(
    p: np.ndarray, side: str, pelvis: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """World rotations of the thigh, shin and foot."""
    rest_thigh = _mirror(REST_THIGH, side)
    rest_shin = _mirror(REST_SHIN, side)
    rest_foot = _mirror(REST_FOOT, side)
    thigh = normalize(p[KNEE[side]] - p[HIP[side]])
    shin = normalize(p[ANKLE[side]] - p[KNEE[side]])
    foot = normalize(p[TOE[side]] - p[HEEL[side]])
    # Straight leg: the foot points the knee (its hinge is across the foot).
    by_foot = _hinged(
        rest_thigh,
        np.cross(rest_foot, rest_thigh),
        thigh,
        np.cross(foot, thigh) if np.linalg.norm(np.cross(foot, thigh)) > 1e-6 else pelvis @ LEFT,
    )
    trust = smoothstep(*HINGE_TRUST, angle_between(thigh, shin))
    if trust > 0:
        by_knee = _hinged(
            rest_thigh, np.cross(rest_thigh, rest_shin), thigh, np.cross(thigh, shin)
        )
        thigh_world = blend_rotation(by_foot, by_knee, trust)
    else:
        thigh_world = by_foot
    thigh_world = pelvis @ clamp_twist(pelvis.T @ thigh_world, rest_thigh, THIGH_TWIST)
    shin_world = swing(thigh_world @ rest_shin, shin) @ thigh_world
    foot_world = swing(shin_world @ rest_foot, foot) @ shin_world
    foot_world = shin_world @ clamp_angle(shin_world.T @ foot_world, ANKLE_MAX)
    return thigh_world, shin_world, foot_world


def _head(p: np.ndarray) -> np.ndarray:
    left = p[EAR["L"]] - p[EAR["R"]]
    ears = 0.5 * (p[EAR["L"]] + p[EAR["R"]])
    nose = perpendicular(p[NOSE] - ears, normalize(left))
    rest = frame(LEFT, REST_NOSE)
    return frame(left, nose) @ rest.T


def frame_rotations(p: np.ndarray, head_rest: np.ndarray | None = None) -> FrameRotations:
    """Joint rotations for one frame of body-frame landmarks ``p`` (33 x 3).

    ``head_rest``, when given, is a head rotation (relative to the chest) taken
    as level: the clip's median head pose, since a face-less body gives the
    nose a different offset from the ears than a real face.
    """
    hips = 0.5 * (p[HIP["L"]] + p[HIP["R"]])
    shoulders = 0.5 * (p[SHOULDER["L"]] + p[SHOULDER["R"]])
    pelvis = basis_left_up(p[HIP["L"]] - p[HIP["R"]], UP)
    chest = basis_up_left(shoulders - hips, p[SHOULDER["L"]] - p[SHOULDER["R"]])
    spine = pelvis.T @ chest
    half = fraction_of(spine, 0.5)

    upper_l, fore_l = _arm(p, "L", chest)
    upper_r, fore_r = _arm(p, "R", chest)
    thigh_l, shin_l, foot_l = _leg(p, "L", pelvis)
    thigh_r, shin_r, foot_r = _leg(p, "R", pelvis)
    head = chest.T @ _head(p)
    if head_rest is not None:
        head = head @ head_rest.T
    head = clamp_angle(head, HEAD_MAX)

    local = {
        "pelvis": pelvis,
        "spineLower": half,
        "spineUpper": half.T @ spine,
        "clavicleL": np.eye(3),
        "clavicleR": np.eye(3),
        "upperArmL": chest.T @ upper_l,
        "upperArmR": chest.T @ upper_r,
        "lowerArmL": upper_l.T @ fore_l,
        "lowerArmR": upper_r.T @ fore_r,
        "upperLegL": pelvis.T @ thigh_l,
        "upperLegR": pelvis.T @ thigh_r,
        "lowerLegL": thigh_l.T @ shin_l,
        "lowerLegR": thigh_r.T @ shin_r,
        "footL": shin_l.T @ foot_l,
        "footR": shin_r.T @ foot_r,
        "head": head,
    }
    ankles = 0.5 * (p[ANKLE["L"]] + p[ANKLE["R"]])
    return FrameRotations(local=local, hips_over_feet=float((hips - ankles)[0]))


def head_relative(p: np.ndarray) -> np.ndarray:
    """The head's rotation relative to the chest, uncalibrated (for the median)."""
    hips = 0.5 * (p[HIP["L"]] + p[HIP["R"]])
    shoulders = 0.5 * (p[SHOULDER["L"]] + p[SHOULDER["R"]])
    chest = basis_up_left(shoulders - hips, p[SHOULDER["L"]] - p[SHOULDER["R"]])
    return chest.T @ _head(p)


def leg_length(p: np.ndarray) -> float:
    """Mean hip-knee-ankle length of both legs, metres."""
    return float(
        np.mean(
            [
                np.linalg.norm(p[KNEE[s]] - p[HIP[s]]) + np.linalg.norm(p[ANKLE[s]] - p[KNEE[s]])
                for s in ("L", "R")
            ]
        )
    )
