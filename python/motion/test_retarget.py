"""Retargeting recovers known rotations from synthetic landmarks (synthetic.py)."""

import numpy as np
import pytest

from retarget import JOINTS, REST_THIGH, UP, frame_rotations, to_body_frame
from rotations import (
    axis_angle,
    clamp_angle,
    clamp_twist,
    matrix_from_quat,
    quat_from_matrix,
    swing_twist,
)
from synthetic import ankle_axis, elbow_axis, knee_axis, landmarks_for, sway_frame

LEFT = np.array([1.0, 0, 0])
FORWARD = np.array([0.0, 0, 1])


def angle_deg(a: np.ndarray, b: np.ndarray) -> float:
    """The angle of the rotation taking a to b, degrees, to 6 places."""
    q = quat_from_matrix(a.T @ b)
    return round(float(np.degrees(2 * np.arccos(min(1.0, abs(q[3]))))), 6)


def test_rest_landmarks_give_rest_rotations():
    local = frame_rotations(landmarks_for({})).local
    assert set(local) == set(JOINTS)
    for joint in JOINTS:
        assert angle_deg(local[joint], np.eye(3)) == 0.0, joint


@pytest.mark.parametrize("i", [0, 3, 7])
def test_bent_limbs_are_recovered_exactly(i):
    truth = sway_frame(i, 12)
    local = frame_rotations(landmarks_for(truth)).local
    for joint, expected in truth.items():
        assert angle_deg(local[joint], expected) == 0.0, joint


def test_a_straight_leg_takes_its_twist_from_the_foot():
    turned = axis_angle(UP, np.radians(-25)) @ axis_angle(LEFT, np.radians(15))
    local = frame_rotations(landmarks_for({"upperLegL": turned})).local
    assert angle_deg(local["upperLegL"], turned) == 0.0
    assert angle_deg(local["lowerLegL"], np.eye(3)) == 0.0


def test_a_twist_past_the_limit_is_held_at_it():
    # 70° of thigh twist is more than a frame may show: it stops at 35°.
    twisted = axis_angle(REST_THIGH, np.radians(70))
    bent = axis_angle(knee_axis("L"), np.radians(40))
    local = frame_rotations(landmarks_for({"upperLegL": twisted, "lowerLegL": bent})).local
    _, twist = swing_twist(local["upperLegL"], REST_THIGH)
    assert round(float(np.degrees(twist)), 6) == 35.0


def test_the_hips_sit_over_the_feet():
    # Both thighs swing 10° toward the subject's right: the feet move right,
    # so the hips sit to the left of the midpoint between the ankles.
    lean = axis_angle(FORWARD, np.radians(-10))
    p = landmarks_for({"upperLegL": lean, "upperLegR": lean})
    frame = frame_rotations(p)
    assert frame.hips_over_feet == -0.5 * (p[27][0] + p[28][0])
    assert round(frame.hips_over_feet, 4) == 0.1628


def test_mediapipe_axes_turn_into_the_body_frame():
    assert to_body_frame(np.array([[1.0, 2.0, 3.0]])).tolist() == [[1.0, -2.0, -3.0]]


def test_rotation_helpers():
    m = axis_angle(LEFT, np.radians(30)) @ axis_angle(UP, np.radians(50))
    swung, twist = swing_twist(m, UP)
    assert round(float(np.degrees(twist)), 6) == 50.0
    assert angle_deg(swung, axis_angle(LEFT, np.radians(30))) == 0.0
    limited = clamp_twist(m, UP, np.radians(20))
    assert round(float(np.degrees(swing_twist(limited, UP)[1])), 6) == 20.0
    capped = clamp_angle(axis_angle(UP, np.radians(80)), np.radians(30))
    assert angle_deg(capped, np.eye(3)) == 30.0
    q = quat_from_matrix(m)
    assert angle_deg(matrix_from_quat(q), m) == 0.0
    assert q[3] >= 0
    assert round(float(np.linalg.norm(elbow_axis("R"))), 9) == 1.0
    assert round(float(np.linalg.norm(ankle_axis("R"))), 9) == 1.0
