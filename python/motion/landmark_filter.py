"""Cleaning a landmark track: fill short gaps, then smooth without lag.

A track is a float array of shape (frames, landmarks, 3) with NaN rows for
frames where no pose was found. Smoothing is a Savitzky–Golay filter (a moving
local polynomial fit), applied forward over the whole recording, so it adds no
delay: the twin's pose at a time matches the video at that time.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class GapReport:
    missing: int
    filled: int
    held: int


def fill_gaps(track: np.ndarray, max_gap: int) -> tuple[np.ndarray, GapReport]:
    """Linear interpolation over runs of missing frames up to ``max_gap`` long;
    longer runs, and runs at either end, hold the nearest found pose."""
    out = np.array(track, dtype=float, copy=True)
    found = ~np.isnan(out).any(axis=(1, 2))
    n = len(out)
    if not found.any():
        raise ValueError("No pose was found in any frame.")
    missing = int((~found).sum())
    filled = held = 0
    i = 0
    while i < n:
        if found[i]:
            i += 1
            continue
        start = i
        while i < n and not found[i]:
            i += 1
        end = i  # first found frame after the run, or n
        before, after = start - 1, end
        length = end - start
        if before >= 0 and after < n and length <= max_gap:
            for k in range(start, end):
                u = (k - before) / (after - before)
                out[k] = (1 - u) * out[before] + u * out[after]
            filled += length
        else:
            source = before if before >= 0 else after
            if before >= 0 and after < n:
                # A long gap: hold each side up to the middle.
                middle = start + length // 2
                out[start:middle] = out[before]
                out[middle:end] = out[after]
            else:
                out[start:end] = out[source]
            held += length
    return out, GapReport(missing=missing, filled=filled, held=held)


def savgol_coefficients(window: int, order: int) -> np.ndarray:
    """Weights of the centre value of a least-squares polynomial fit."""
    if window % 2 == 0 or window < 3:
        raise ValueError("The window must be odd and at least 3.")
    if order >= window:
        raise ValueError("The polynomial order must be below the window.")
    half = window // 2
    x = np.arange(-half, half + 1, dtype=float)
    vander = np.vander(x, order + 1, increasing=True)
    return np.linalg.pinv(vander)[0]


def savgol(track: np.ndarray, window: int, order: int) -> np.ndarray:
    """Savitzky–Golay along the first axis, with point-mirrored ends."""
    if len(track) < 2 or window <= 1:
        return np.array(track, dtype=float, copy=True)
    window = min(window, len(track) if len(track) % 2 == 1 else len(track) - 1)
    if window < 3:
        return np.array(track, dtype=float, copy=True)
    weights = savgol_coefficients(window, min(order, window - 1))
    half = window // 2
    # Point-mirrored ends keep a trend going instead of folding it back, so a
    # movement at the first or last frame does not read as a stop.
    padded = np.concatenate(
        [
            2 * track[0] - track[half:0:-1],
            track,
            2 * track[-1] - track[-2 : -half - 2 : -1],
        ],
        axis=0,
    )
    out = np.zeros_like(track, dtype=float)
    for k, w in enumerate(weights):
        out += w * padded[k : k + len(track)]
    return out


def window_frames(seconds: float, fps: float) -> int:
    """The odd number of frames closest to ``seconds``, at least 3."""
    frames = max(3, int(round(seconds * fps)))
    return frames if frames % 2 == 1 else frames + 1


def anchor_to_picture(world: np.ndarray, image: np.ndarray) -> tuple[np.ndarray, float]:
    """World landmarks whose x and y come from the picture and only z (depth)
    from the 3D estimate.

    The estimator's 2D points are much closer to what the video shows than the
    x and y of its 3D guess, which it infers from a crop of the person. Seen
    from far enough away, the picture is the body's x and y up to one scale
    (an orthographic camera), so each frame's picture points, centred between
    the hips and scaled to metres by the clip's median ratio of 3D to picture
    trunk height, replace the 3D x and y. Both arrays use x to the right and y
    down. Returns the track and the metres per pixel used. NaN frames stay NaN.
    """
    hips_w = 0.5 * (world[:, 23] + world[:, 24])
    shoulders_w = 0.5 * (world[:, 11] + world[:, 12])
    hips_i = 0.5 * (image[:, 23] + image[:, 24])
    shoulders_i = 0.5 * (image[:, 11] + image[:, 12])
    trunk_w = np.linalg.norm(shoulders_w - hips_w, axis=1)
    trunk_i = np.linalg.norm(shoulders_i - hips_i, axis=1)
    ratio = trunk_w / np.where(trunk_i > 1e-6, trunk_i, np.nan)
    scale = float(np.nanmedian(ratio))
    out = np.array(world, dtype=float, copy=True)
    out[:, :, :2] = (image - hips_i[:, None, :]) * scale
    out[:, :, 2] = world[:, :, 2] - hips_w[:, None, 2]
    return out, scale


#: Limb bones, parent joint first, in chain order so a joint's depth is set
#: before its child's.
LIMB_BONES = (
    (11, 13), (13, 15), (12, 14), (14, 16),
    (23, 25), (25, 27), (24, 26), (26, 28),
)  # fmt: skip


def bone_lengths(world: np.ndarray) -> dict[tuple[int, int], float]:
    """Median 3D length of each limb bone over the frames with a pose, metres."""
    return {
        (a, b): float(np.nanmedian(np.linalg.norm(world[:, b] - world[:, a], axis=1)))
        for a, b in LIMB_BONES
    }


def consistent_depth(
    track: np.ndarray, lengths: dict[tuple[int, int], float]
) -> np.ndarray:
    """Limb depths limited to what the bones' lengths allow.

    With x and y from the picture, a bone of length L drawn l long in the
    picture can reach at most sqrt(L² − l²) toward or away from the camera.
    The estimator's depth beyond that is cut back to it, keeping its sign.
    """
    out = np.array(track, dtype=float, copy=True)
    for a, b in LIMB_BONES:
        length = lengths[(a, b)]
        drawn = np.linalg.norm(track[:, b, :2] - track[:, a, :2], axis=1)
        reach = np.sqrt(np.clip(length**2 - drawn**2, 0.0, None))
        dz = track[:, b, 2] - track[:, a, 2]
        out[:, b, 2] = out[:, a, 2] + np.clip(dz, -reach, reach)
    # Hands and feet move with the wrist or ankle they hang from.
    for end, carried in ((15, (17, 19, 21)), (16, (18, 20, 22)), (27, (29, 31)), (28, (30, 32))):
        shift = out[:, end, 2] - track[:, end, 2]
        for k in carried:
            out[:, k, 2] = track[:, k, 2] + shift
    return out


# MediaPipe's left/right pairs, split into the upper body (face, shoulders,
# arms, hands) and the lower body (hips, legs, feet), which it can swap apart.
UPPER_PAIRS = (
    (1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16),
    (17, 18), (19, 20), (21, 22),
)  # fmt: skip
LOWER_PAIRS = ((23, 24), (25, 26), (27, 28), (29, 30), (31, 32))


def _swapped(points: np.ndarray, pairs: tuple[tuple[int, int], ...]) -> np.ndarray:
    out = np.array(points, copy=True)
    for a, b in pairs:
        out[[a, b]] = out[[b, a]]
    return out


def fix_swaps(
    world: np.ndarray, image: np.ndarray | None = None
) -> tuple[np.ndarray, np.ndarray | None, int]:
    """Undoes frames where the estimator swapped the subject's left and right.

    A face-less body gives little cue to which way it faces, so the estimator
    sometimes labels the left limbs right for a few frames. Each frame, the
    upper and the lower body separately, is compared with the previous
    (already corrected) frame as is and with left and right exchanged; the
    closer one wins. Positions in the picture (``image``, frames x 33 x 2)
    decide when given, since they do not depend on the depth guess; otherwise
    the world positions. Returns both arrays corrected and the number of body
    halves swapped back. Frames without a pose (NaN) are skipped.
    """
    world_out = np.array(world, dtype=float, copy=True)
    image_out = None if image is None else np.array(image, dtype=float, copy=True)
    probe = world_out if image_out is None else image_out
    previous: np.ndarray | None = None
    fixes = 0
    for i in range(len(probe)):
        if np.isnan(probe[i]).any():
            continue
        if previous is not None:
            halves = 0
            for pairs in (UPPER_PAIRS, LOWER_PAIRS):
                index = [k for pair in pairs for k in pair]
                keep = float(np.linalg.norm(probe[i][index] - previous[index]))
                flip = float(np.linalg.norm(_swapped(probe[i], pairs)[index] - previous[index]))
                if flip < keep:
                    world_out[i] = _swapped(world_out[i], pairs)
                    if image_out is not None:
                        image_out[i] = _swapped(image_out[i], pairs)
                    fixes += 1
                    halves += 1
            if halves == 2 and image_out is not None:
                # The whole body was labelled the other way round: the estimate
                # had the subject facing away, which looks the same in the
                # picture. Facing the camera again mirrors the depth.
                world_out[i][:, 2] = -world_out[i][:, 2]
        previous = probe[i]
    return world_out, image_out, fixes
