"""Gap filling, smoothing, left/right repair, picture anchoring and the clip file,
on synthetic landmarks only."""

import json

import numpy as np
import pytest

from landmark_filter import (
    anchor_to_picture,
    fill_gaps,
    fix_swaps,
    savgol,
    savgol_coefficients,
    window_frames,
)
from synthetic import CLIP_FIXTURE, LANDMARKS_FIXTURE, fixture_landmarks
from video_to_clip import main, picture_rows

NAN = np.nan


def track(values):
    """A one-landmark, one-axis-repeated track from a list of numbers (None is a gap)."""
    rows = [np.full((1, 3), NAN) if v is None else np.full((1, 3), float(v)) for v in values]
    return np.stack(rows)


def test_short_gaps_are_bridged_and_long_ones_held():
    filled, report = fill_gaps(track([0, None, None, 3, None, None, None, None, 8]), max_gap=2)
    assert filled[:, 0, 0].tolist() == [0, 1, 2, 3, 3, 3, 8, 8, 8]
    assert (report.missing, report.filled, report.held) == (6, 2, 4)


def test_gaps_at_the_ends_hold_the_nearest_pose():
    filled, report = fill_gaps(track([None, 5, 6, None]), max_gap=3)
    assert filled[:, 0, 0].tolist() == [5, 5, 6, 6]
    assert report.held == 2


def test_no_pose_at_all_is_an_error():
    with pytest.raises(ValueError, match="No pose"):
        fill_gaps(track([None, None]), max_gap=1)


def test_savgol_keeps_a_parabola_and_has_no_lag():
    x = np.arange(20, dtype=float)
    parabola = track((0.5 * x**2 - 3 * x).tolist())
    smooth = savgol(parabola, 7, 2)
    assert np.round(smooth[3:-3, 0, 0], 9).tolist() == np.round(parabola[3:-3, 0, 0], 9).tolist()
    assert np.round(savgol_coefficients(5, 2), 6).tolist() == [
        -0.085714,
        0.342857,
        0.485714,
        0.342857,
        -0.085714,
    ]


def test_savgol_damps_frame_to_frame_jitter():
    jitter = track([(-1) ** i for i in range(15)])
    assert float(np.abs(savgol(jitter, 7, 2)[3:-3, 0, 0]).max()) < 0.5


def test_window_frames_is_odd_and_at_least_three():
    assert [window_frames(0.25, 24), window_frames(0.25, 12), window_frames(0.01, 30)] == [7, 3, 3]


def test_a_frame_labelled_the_wrong_way_round_is_swapped_back():
    data = fixture_landmarks(6)
    world = np.array(data["world"])
    image = np.array(data["image"])
    pairs = [(i, i + 1) for i in range(11, 33, 2) if i not in (23,)] + [(23, 24), (7, 8)]
    bad_world, bad_image = world.copy(), image.copy()
    for a, b in pairs + [(1, 4), (2, 5), (3, 6), (9, 10)]:
        bad_world[3, [a, b]] = bad_world[3, [b, a]]
        bad_image[3, [a, b]] = bad_image[3, [b, a]]
    bad_world[3, :, 2] *= -1  # the estimator had the body facing away
    fixed_world, fixed_image, fixes = fix_swaps(bad_world, bad_image)
    assert fixes == 2
    assert np.allclose(fixed_image, image)
    assert np.allclose(fixed_world, world)


def test_the_picture_gives_x_and_y_and_the_estimate_depth():
    data = fixture_landmarks(4)
    world = np.array(data["world"])
    noisy = world.copy()
    # The 3D guess is off for the limbs (the trunk, which sets the scale, is right).
    noise = 0.05 * np.sin(np.arange(33))
    noise[[11, 12, 23, 24]] = 0
    noisy[:, :, :2] += noise[None, :, None]
    anchored, scale = anchor_to_picture(noisy, np.array(data["image"]))
    assert round(scale, 6) == 0.005
    hips = 0.5 * (world[:, 23] + world[:, 24])
    assert np.allclose(anchored[:, :, :2], world[:, :, :2] - hips[:, None, :2], atol=1e-4)
    assert np.allclose(anchored[:, :, 2], noisy[:, :, 2] - hips[:, None, 2])


def test_the_picture_rows_skip_caption_bands():
    luma = np.array([0] * 10 + [200] * 3 + [10] * 5 + [150] * 40 + [0] * 7, dtype=float)
    assert picture_rows(luma) == (18, 58)


def test_the_committed_fixture_clip_is_what_the_pipeline_makes(tmp_path):
    assert json.loads(LANDMARKS_FIXTURE.read_text()) == json.loads(
        json.dumps(fixture_landmarks())
    )
    out = tmp_path / "clip.json"
    code = main(
        [
            "--from-landmarks",
            str(LANDMARKS_FIXTURE),
            "--out",
            str(out),
            "--name",
            "Synthetic sway",
            "--licence",
            "Synthetic test data, Apache-2.0 like the code that makes it.",
            "--no-level",
        ]
    )
    assert code == 0
    made = json.loads(out.read_text())
    assert made == json.loads(CLIP_FIXTURE.read_text())
    assert made["frameCount"] == 12
    assert len(made["frames"][0]) == 4 * len(made["joints"])
    assert made["source"]["landmarks"] == "synthetic-landmarks.json"
    assert made["generator"]["gaps"] == {"missing": 0, "filled": 0, "held": 0}
