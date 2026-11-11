"""Joint centres and segments from an atlas's bone meshes. Plain numpy, no bpy.

A bone mesh arrives as loose parts (one per bone, as BodyParts3D and HRA's
knee meshes do). Long bones are found by shape and place: long, near
vertical, at the right height and side. Joints come from their ends:

- hip, shoulder: a sphere fitted to the medial cap of the femoral or humeral head
- knee: midpoint of the femur's lowest band and the tibia's highest band
- ankle: midpoint of the lowest bands of tibia and fibula (between the malleoli)
- elbow: midpoint of the humerus's lowest band and the forearm bones' highest
- wrist: midpoint of the lowest bands of radius and ulna
- toe: the far end of the foot bones' main axis (the band of points within
  1 cm of it, about the second toe's tip)
- finger: the far end of the hand bones' main axis (the middle fingertip)
- palm: the hand bones' thinnest axis, signed by the hand's handedness
  from the thumb's side: the radius is the shorter forearm bone, and it
  carries the thumb

Every other bone part goes to the foot, the hand, the shin (patella,
menisci) or the trunk by where its centroid lies. Lengths are scaled to the
atlas height (`k`, 1 for a 1.70 m atlas), so the rules hold after a uniform
scale. Coordinates: Blender world, metres, +Z up, +X the subject's left.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .geometry import band_centroid, fit_sphere, pca

SIDES = ("L", "R")
LEG = ("thigh", "shin", "foot")
ARM = ("upperarm", "forearm", "hand")
SEGMENTS = ("trunk",) + tuple(f"{s}.{side}" for side in SIDES for s in LEG + ARM)

# Which segments may blend with which: along a chain, and the chain roots with the trunk.
NEIGHBOURS: dict[str, tuple[str, ...]] = {"trunk": tuple(f"{s}.{side}" for side in SIDES for s in ("thigh", "upperarm"))}
for _side in SIDES:
    for _chain in (LEG, ARM):
        for _i, _seg in enumerate(_chain):
            _links = (["trunk"] if _i == 0 else [f"{_chain[_i - 1]}.{_side}"]) + (
                [f"{_chain[_i + 1]}.{_side}"] if _i + 1 < len(_chain) else []
            )
            NEIGHBOURS[f"{_seg}.{_side}"] = tuple(_links)


@dataclass(frozen=True)
class PartShape:
    centroid: np.ndarray
    axis: np.ndarray
    length: float
    linearity: float
    zmin: float
    zmax: float


@dataclass
class AtlasRig:
    joints: dict[str, np.ndarray] = field(default_factory=dict)
    part_segment: list[str] = field(default_factory=list)
    has_arms: bool = False
    notes: list[str] = field(default_factory=list)
    # Palm normal per side ("L", "R"), only where the hand was found.
    palm: dict[str, np.ndarray] = field(default_factory=dict)


# Fewer bone parts than this in a foot or hand: too few to give its direction.
MIN_END_PARTS = 3
# A bone part below the ankle and this far from it (scaled to a 1.70 m atlas)
# belongs to the foot: the toe tips stand about 0.2 m in front of the ankle.
FOOT_REACH = 0.25


def tip_point(points: np.ndarray, base: np.ndarray, depth: float) -> np.ndarray:
    """The far end of the points' main axis from `base`: the mean of the band within `depth` of it."""
    centroid, axes, _ = pca(points)
    axis = axes[0] if (centroid - base) @ axes[0] >= 0 else -axes[0]
    along = (points - base) @ axis
    return points[along >= along.max() - depth].mean(axis=0)


def palm_side(normal: np.ndarray, pointing: np.ndarray, thumb_side: np.ndarray) -> np.ndarray:
    """
    A palm-plane normal signed by the hand's own handedness: along
    pointing × thumb_side (the palm's side on a left hand, the back's on a
    right). The atlas and the body are signed by the same rule, so the two
    normals of one side always face the same way on the hand.
    """
    n = normal / np.linalg.norm(normal)
    return n if n @ np.cross(pointing, thumb_side) >= 0 else -n


def shape(points: np.ndarray) -> PartShape:
    centroid, axes, sigmas = pca(points)
    along = (points - centroid) @ axes[0]
    return PartShape(
        centroid=centroid,
        axis=axes[0],
        length=float(along.max() - along.min()),
        linearity=float(sigmas[0] / max(sigmas[1], 1e-9)),
        zmin=float(points[:, 2].min()),
        zmax=float(points[:, 2].max()),
    )


def side_of(x: float, mid_x: float) -> str:
    return "L" if x >= mid_x else "R"


def head_centre(points: np.ndarray, side_sign: float, k: float) -> np.ndarray:
    """Centre of a femoral or humeral head: sphere through the medial cap of the bone's top."""
    top = points[points[:, 2] >= points[:, 2].max() - 0.10 * k]
    medial = top[np.argmin(side_sign * top[:, 0])]
    cap = top[np.linalg.norm(top - medial, axis=1) <= 0.035 * k]
    if len(cap) >= 12:
        centre, radius = fit_sphere(cap)
        if 0.012 * k <= radius <= 0.04 * k and np.linalg.norm(centre - cap.mean(axis=0)) <= 0.05 * k:
            return centre
    return cap.mean(axis=0)


def _is_long(s: PartShape, k: float) -> bool:
    return s.length > 0.17 * k and abs(s.axis[2]) > 0.85 and s.linearity > 3.0


def build_rig(parts: list[np.ndarray], floor_z: float, height: float, mid_x: float) -> AtlasRig:
    """Joints and a segment per bone part. `parts` are the bone parts' world points."""
    k = height / 1.70
    shapes = [shape(p) for p in parts]
    rel = [(s.centroid[2] - floor_z) / height for s in shapes]
    rig = AtlasRig(part_segment=["trunk"] * len(parts))
    taken: set[int] = set()

    def pick(side: str, test, count: int) -> list[int]:
        found = [
            i
            for i, s in enumerate(shapes)
            if i not in taken and _is_long(s, k) and side_of(s.centroid[0], mid_x) == side and test(i, s)
        ]
        found.sort(key=lambda i: -shapes[i].length)
        return found[:count]

    arms_found = 0
    thumb_side: dict[str, np.ndarray] = {}
    for side in SIDES:
        sign = 1.0 if side == "L" else -1.0
        femur = pick(side, lambda i, s: 0.3 <= rel[i] <= 0.6 and s.zmax - floor_z > 0.45 * height, 1)
        if not femur:
            raise ValueError(f"no femur found on side {side}")
        taken.update(femur)
        f = femur[0]
        lower = pick(side, lambda i, s: rel[i] < 0.3 and s.zmax <= shapes[f].zmin + 0.05 * height, 2)
        if len(lower) < 2:
            raise ValueError(f"no tibia and fibula found on side {side}")
        taken.update(lower)
        tibia, fibula = sorted(lower, key=lambda i: sign * shapes[i].centroid[0])
        fp, tp, bp = parts[f], parts[tibia], parts[fibula]
        rig.joints[f"hip.{side}"] = head_centre(fp, sign, k)
        rig.joints[f"knee.{side}"] = (
            band_centroid(fp, 2, "min", 0.02 * k) + band_centroid(tp, 2, "max", 0.02 * k)
        ) / 2
        rig.joints[f"ankle.{side}"] = (
            band_centroid(tp, 2, "min", 0.015 * k) + band_centroid(bp, 2, "min", 0.015 * k)
        ) / 2
        rig.part_segment[f] = f"thigh.{side}"
        rig.part_segment[tibia] = f"shin.{side}"
        rig.part_segment[fibula] = f"shin.{side}"

        humerus = pick(side, lambda i, s: 0.6 <= rel[i] <= 0.85 and abs(s.centroid[0] - mid_x) > 0.06 * k, 1)
        if humerus:
            h = humerus[0]
            forearm = pick(
                side,
                lambda i, s: i != h and 0.45 <= rel[i] <= 0.72 and s.zmax <= shapes[h].zmin + 0.06 * height,
                2,
            )
            if len(forearm) == 2:
                taken.update(humerus + forearm)
                hp = parts[h]
                # The ulna is the longer forearm bone (its olecranon reaches above the elbow).
                ra, ul = (parts[i] for i in sorted(forearm, key=lambda i: shapes[i].length))
                rig.joints[f"shoulder.{side}"] = head_centre(hp, sign, k)
                rig.joints[f"elbow.{side}"] = (
                    band_centroid(hp, 2, "min", 0.02 * k)
                    + (band_centroid(ra, 2, "max", 0.015 * k) + band_centroid(ul, 2, "max", 0.015 * k)) / 2
                ) / 2
                radial = band_centroid(ra, 2, "min", 0.015 * k)
                ulnar = band_centroid(ul, 2, "min", 0.015 * k)
                rig.joints[f"wrist.{side}"] = (radial + ulnar) / 2
                thumb_side[side] = radial - ulnar
                rig.part_segment[h] = f"upperarm.{side}"
                for i in forearm:
                    rig.part_segment[i] = f"forearm.{side}"
                arms_found += 1
    rig.has_arms = arms_found == 2
    if not rig.has_arms:
        rig.notes.append("No humerus, radius and ulna on both sides: the arms are not fitted and move with the trunk.")
        for side in SIDES:
            for name in ("shoulder", "elbow", "wrist"):
                rig.joints.pop(f"{name}.{side}", None)
            for i, seg in enumerate(rig.part_segment):
                if seg.endswith(f".{side}") and seg.split(".")[0] in ARM:
                    rig.part_segment[i] = "trunk"

    for i, s in enumerate(shapes):
        if i in taken:
            continue
        side = side_of(s.centroid[0], mid_x)
        ankle = rig.joints[f"ankle.{side}"]
        knee = rig.joints[f"knee.{side}"]
        if s.centroid[2] < ankle[2] and np.linalg.norm(s.centroid[:2] - ankle[:2]) < FOOT_REACH * k:
            rig.part_segment[i] = f"foot.{side}"
        elif np.linalg.norm(s.centroid - knee) < 0.07 * k:
            rig.part_segment[i] = f"shin.{side}"
        elif rig.has_arms:
            wrist = rig.joints[f"wrist.{side}"]
            down = wrist - rig.joints[f"elbow.{side}"]
            down /= np.linalg.norm(down)
            t = float((s.centroid - wrist) @ down)
            off = np.linalg.norm(s.centroid - wrist - t * down)
            if -0.01 * k < t < 0.25 * k and off < 0.08 * k:
                rig.part_segment[i] = f"hand.{side}"

    def end_points(seg: str) -> np.ndarray | None:
        found = [parts[i] for i, s in enumerate(rig.part_segment) if s == seg]
        return np.vstack(found) if len(found) >= MIN_END_PARTS else None

    for side in SIDES:
        foot = end_points(f"foot.{side}")
        if foot is not None:
            rig.joints[f"toe.{side}"] = tip_point(foot, rig.joints[f"ankle.{side}"], 0.01 * k)
        hand = end_points(f"hand.{side}") if rig.has_arms else None
        if hand is not None:
            wrist = rig.joints[f"wrist.{side}"]
            finger = tip_point(hand, wrist, 0.01 * k)
            rig.joints[f"finger.{side}"] = finger
            rig.palm[side] = palm_side(pca(hand)[1][2], finger - wrist, thumb_side[side])
    if not any(f"toe.{side}" in rig.joints for side in SIDES):
        rig.notes.append("No foot bones: each foot only follows its ankle and does not turn.")
    if rig.has_arms and not rig.palm:
        rig.notes.append("No hand bones: each hand turns with its forearm only.")
    return rig


def self_check() -> list[str]:
    """Synthetic legs and arms made of point cylinders with known joints."""
    failures: list[str] = []

    def rod(a, b, r=0.012, n=400):
        a, b = np.asarray(a, float), np.asarray(b, float)
        t = np.linspace(0, 1, n)
        ang = np.linspace(0, 2 * np.pi * 37, n)
        d = (b - a) / np.linalg.norm(b - a)
        u = np.cross(d, [0, 1, 0]) if abs(d[1]) < 0.9 else np.cross(d, [1, 0, 0])
        u /= np.linalg.norm(u)
        v = np.cross(d, u)
        return a + np.outer(t, b - a) + r * (np.outer(np.cos(ang), u) + np.outer(np.sin(ang), v))

    def ball(c, r=0.024, n=300):
        g = np.linspace(0, np.pi, 15)
        h = np.linspace(0, 2 * np.pi, 20, endpoint=False)
        gg, hh = np.meshgrid(g, h)
        return np.asarray(c) + r * np.stack([np.sin(gg) * np.cos(hh), np.sin(gg) * np.sin(hh), np.cos(gg)], -1).reshape(-1, 3)

    parts = []
    for sign in (1, -1):
        hip = np.array([0.09 * sign, 0.0, 0.88])
        parts.append(np.vstack([ball(hip), rod(hip + [0.03 * sign, 0, 0], [0.1 * sign, 0, 0.47])]))  # femur
        parts.append(rod([0.09 * sign, 0, 0.45], [0.09 * sign, 0, 0.07], 0.015))  # tibia
        parts.append(rod([0.12 * sign, 0, 0.44], [0.12 * sign, 0, 0.05], 0.008))  # fibula
        parts.append(rod([0.1 * sign, -0.05, 0.03], [0.1 * sign, -0.1, 0.02], 0.01, 50))  # foot bone
        shoulder = np.array([0.18 * sign, 0.0, 1.40])
        parts.append(np.vstack([ball(shoulder), rod(shoulder + [0.02 * sign, 0, -0.02], [0.2 * sign, 0, 1.1])]))
        parts.append(rod([0.2 * sign, 0, 1.10], [0.22 * sign, 0, 0.84], 0.01))  # ulna, the longer
        parts.append(rod([0.215 * sign, 0.01, 1.08], [0.235 * sign, 0.01, 0.84], 0.01))  # radius, lateral
    for sign in (1, -1):
        # Two more foot bones, the foot turned 20° outward; four fingers spread side to side.
        out = np.array([np.sin(np.radians(20)) * sign, -np.cos(np.radians(20)), 0.0])
        for dx in (-0.02, 0.02):
            start = np.array([(0.1 + dx) * sign, -0.04, 0.025])
            parts.append(rod(start, start + 0.12 * out, 0.006, 50))
        for dx, length in ((-0.015, 0.08), (0.0, 0.1), (0.015, 0.09), (0.03, 0.07)):
            top = np.array([(0.228 + dx) * sign, 0.005, 0.825])
            parts.append(rod(top, top - [0, 0, length], 0.005, 60))
    parts.append(rod([0, 0.05, 0.9], [0, 0.05, 1.5], 0.02))  # spine, vertical but at the midline
    rig = build_rig(parts, floor_z=0.0, height=1.70, mid_x=0.0)
    hip = rig.joints["hip.L"]
    if np.linalg.norm(hip - [0.09, 0, 0.88]) > 0.002:
        failures.append(f"hip.L at {hip}")
    if abs(rig.joints["knee.L"][2] - 0.46) > 0.01:
        failures.append(f"knee.L at {rig.joints['knee.L']}")
    if not rig.has_arms or abs(rig.joints["wrist.R"][2] - 0.84) > 0.01:
        failures.append("arms")
    toe = rig.joints.get("toe.L", np.zeros(3)) - rig.joints["ankle.L"]
    if not (toe[0] > 0.02 and toe[1] < -0.1):
        failures.append(f"toe.L {toe} is not forward and outward of the ankle")
    finger = rig.joints.get("finger.R", np.zeros(3))
    if np.linalg.norm(finger - [-0.228, 0.005, 0.725]) > 0.01:
        failures.append(f"finger.R at {finger}")
    # Thumb (radius) lateral and fingers down: the left palm faces forward, the right's back faces back.
    if rig.palm.get("L", np.zeros(3)) @ [0, -1, 0] < 0.99 or rig.palm.get("R", np.zeros(3)) @ [0, 1, 0] < 0.99:
        failures.append(f"palm {rig.palm}")
    expected = ["thigh.L", "shin.L", "shin.L", "foot.L", "upperarm.L", "forearm.L", "forearm.L"]
    if rig.part_segment[:7] != expected or rig.part_segment[-1] != "trunk":
        failures.append(f"segments {rig.part_segment}")
    return failures
