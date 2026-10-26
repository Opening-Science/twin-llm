"""Foot contact flags and bone-length depth limits, on synthetic tracks."""

import numpy as np

from foot_contact import ContactRule, foot_contacts, hysteresis, tidy
from landmark_filter import bone_lengths, consistent_depth

FPS = 24.0
PX_PER_M = 200.0


def picture(left_lift_m, left_x_m=None, frames=48):
    """A picture track (pixels, y down) with both feet on a floor at y=900,
    the left foot raised by ``left_lift_m[i]`` metres and moved to ``left_x_m``."""
    track = np.zeros((frames, 33, 2))
    track[:, :, 0] = 360.0
    track[:, :, 1] = 500.0
    for side, (ankle, heel, toe), x0 in (("L", (27, 29, 31), 380.0), ("R", (28, 30, 32), 340.0)):
        for i in range(frames):
            lift = left_lift_m[i] if side == "L" else 0.0
            x = x0 + (left_x_m[i] * PX_PER_M if side == "L" and left_x_m is not None else 0.0)
            track[i, ankle] = [x, 880.0 - lift * PX_PER_M]
            track[i, heel] = [x - 5, 900.0 - lift * PX_PER_M]
            track[i, toe] = [x + 20, 900.0 - lift * PX_PER_M]
    return track


def test_a_lifted_foot_is_not_planted_and_a_standing_one_is():
    lift = [0.0] * 16 + [0.15] * 16 + [0.0] * 16
    flags = foot_contacts(picture(lift), 1 / PX_PER_M, FPS)
    assert flags["footR"] == [1] * 48
    left = flags["footL"]
    assert left[:12] == [1] * 12
    assert left[18:30] == [0] * 12
    assert left[36:] == [1] * 12


def test_a_foot_sliding_fast_is_not_planted():
    slide = [0.03 * i for i in range(48)]  # 0.72 m/s across the floor
    flags = foot_contacts(picture([0.0] * 48, slide), 1 / PX_PER_M, FPS)
    assert flags["footL"] == [0] * 48
    assert flags["footR"] == [1] * 48


def test_hysteresis_holds_between_the_thresholds():
    rule = ContactRule()
    height = np.array([0.1, 0.03, 0.05, 0.06, 0.08, 0.05, 0.03])
    speed = np.zeros(7)
    assert hysteresis(height, speed, rule).tolist() == [
        False, True, True, True, False, False, True,
    ]  # fmt: skip


def test_short_contacts_are_dropped_and_short_breaks_closed():
    flags = np.array([1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0], dtype=bool)
    assert tidy(flags, min_contact=2, min_break=2).astype(int).tolist() == [
        1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
    ]  # fmt: skip


def test_depth_is_cut_back_to_what_the_bone_can_reach():
    track = np.zeros((2, 33, 3))
    track[:, 11] = [0.0, 0.0, 0.0]
    # Drawn 0.24 long, so a 0.3 m upper arm reaches at most 0.18 in depth.
    track[0, 13] = [0.24, 0.0, 0.5]
    track[1, 13] = [0.24, 0.0, -0.1]
    track[:, 15] = track[:, 13] + [0.0, 0.0, 0.0]
    lengths = {bone: 0.3 for bone in bone_lengths(track)}
    out = consistent_depth(track, lengths)
    assert np.round(out[:, 13, 2], 6).tolist() == [0.18, -0.1]
    # The wrist moves with the elbow (its own bone is drawn 0 long, depth 0).
    assert np.round(out[:, 15, 2], 6).tolist() == [0.18, -0.1]
