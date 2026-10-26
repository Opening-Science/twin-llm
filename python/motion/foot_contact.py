"""When each foot is on the floor, from the picture.

The clip plays in place, so the app needs to be told when a foot is planted:
it then holds that foot on the floor where it landed (two-bone IK in
``features/digital-twin/motion/foot-contact.ts``) instead of letting it lift
or slide with the rest of the leg.

A foot counts as planted when its lowest point (ankle, heel or toe) is near
the floor and it is barely moving sideways. Heights are read in the picture,
where the body's own up and down is visible (the world landmarks are centred
on the hips and lose it):

- the floor under a foot is the lowest that foot reached within a second
  either side, but no higher than 12 cm above the lowest either foot reached
  (a foot held up for long does not make its own floor);
- contact starts below 4 cm and 0.35 m/s, and ends above 7 cm or 0.6 m/s
  (hysteresis, so noise at the edge does not flicker);
- a contact shorter than 0.1 s is dropped, and a break shorter than 0.1 s
  between two contacts is closed.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from landmark_filter import savgol, window_frames
from retarget import ANKLE, HEEL, TOE


@dataclass(frozen=True)
class ContactRule:
    enter_height: float = 0.04
    exit_height: float = 0.07
    enter_speed: float = 0.35
    exit_speed: float = 0.6
    floor_window_s: float = 1.0
    own_floor_allowance: float = 0.12
    min_contact_s: float = 0.1
    min_break_s: float = 0.1


def _rolling_max(values: np.ndarray, half: int) -> np.ndarray:
    return np.array(
        [values[max(0, i - half) : i + half + 1].max() for i in range(len(values))]
    )


def _runs(flags: np.ndarray, value: bool) -> list[tuple[int, int]]:
    """(start, end exclusive) of each run of ``value``."""
    out, i = [], 0
    while i < len(flags):
        if flags[i] != value:
            i += 1
            continue
        start = i
        while i < len(flags) and flags[i] == value:
            i += 1
        out.append((start, i))
    return out


def hysteresis(height: np.ndarray, speed: np.ndarray, rule: ContactRule) -> np.ndarray:
    flags = np.zeros(len(height), dtype=bool)
    on = False
    for i, (h, v) in enumerate(zip(height, speed, strict=True)):
        if on:
            on = not (h > rule.exit_height or v > rule.exit_speed)
        else:
            on = h < rule.enter_height and v < rule.enter_speed
        flags[i] = on
    return flags


def tidy(flags: np.ndarray, min_contact: int, min_break: int) -> np.ndarray:
    """Closes short breaks between contacts, then drops short contacts."""
    out = flags.copy()
    for start, end in _runs(out, False):
        if start > 0 and end < len(out) and end - start < min_break:
            out[start:end] = True
    for start, end in _runs(out, True):
        if end - start < min_contact:
            out[start:end] = False
    return out


def foot_contacts(
    picture: np.ndarray, metres_per_pixel: float, fps: float, rule: ContactRule = ContactRule()
) -> dict[str, list[int]]:
    """Per foot ("footL", "footR"), 1 for each frame the foot is planted.

    ``picture`` is frames x 33 x 2 in pixels (x right, y down), already free of
    left/right swaps and gaps.
    """
    smooth = savgol(np.asarray(picture, dtype=float), window_frames(0.2, fps), 2)
    low = {
        side: np.max(smooth[:, [ANKLE[side], HEEL[side], TOE[side]], 1], axis=1)
        for side in ("L", "R")
    }
    half = max(1, int(round(rule.floor_window_s * fps)))
    both = _rolling_max(np.maximum(low["L"], low["R"]), half)
    out: dict[str, list[int]] = {}
    for side in ("L", "R"):
        own = _rolling_max(low[side], half)
        floor = np.maximum(own, both - rule.own_floor_allowance / metres_per_pixel)
        height = (floor - low[side]) * metres_per_pixel
        x = np.mean(smooth[:, [HEEL[side], TOE[side]], 0], axis=1)
        speed = np.abs(np.gradient(x)) * fps * metres_per_pixel
        flags = hysteresis(height, speed, rule)
        flags = tidy(
            flags,
            max(1, int(round(rule.min_contact_s * fps))),
            max(1, int(round(rule.min_break_s * fps))),
        )
        out[f"foot{side}"] = [int(f) for f in flags]
    return out
