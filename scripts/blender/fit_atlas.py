"""
Per-limb fit of a reference atlas to a rigged ANNY demo body. Blender 5.2.x, headless.

Inputs (after `--`):
  --atlas <glb> --scheme bodyparts3d|hra   a pinned atlas from data/anatomy
  --body <glb>                             a pinned rigged ANNY body (its bind pose and bones)
  --out <glb>                              the fitted atlas (meshopt, node names and extras kept)
  --report <json>                          joints before and after, segment stretch, notes
  [--render-dir <dir> --render-name <stem> --render-show bone,vessel,muscle,skin]
                                           front renders before and after (1440x1080 PNG):
                                           ANNY's joints green, the atlas's magenta
  [--stretch]                              also stretch limb segments along their axes so knee
                                           and ankle meet ANNY's (off by default: bones keep length)
  --self-check                             runs on a tiny synthetic atlas and body instead

Steps: scale the atlas to the body's height with the feet on its floor and the
boxes centred (the app's demo fit), find the atlas's joints from its bones
(twinblend/atlas_rig.py), build an armature on them, weight every vertex
(bones rigid to their segment, organs rigid to the trunk, soft tissue blended
by distance to the nearest bones), then pose: the trunk moves sideways and
forwards so the hip midpoints meet, each thigh and shin turns toward ANNY's
knee and ankle and keeps its length (with `--stretch` it also stretches along
its own axis so they land exactly), and with arm bones the upper arm and
forearm do the same for elbow and wrist. Each foot follows its ankle and,
with foot bones, turns about the vertical until it points at ANNY's second
toe, the sole staying level; each hand follows its wrist and, with hand
bones, turns to point at ANNY's middle fingertip and rolls until its palm
faces like ANNY's, the forearm and upper arm taking part of that roll.
The pose is applied and the joints are found
again on the result, so the report measures the output itself.
No randomness; the same inputs give the same file.
"""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402
from mathutils.kdtree import KDTree  # noqa: E402

from twinblend import atlas_rig, geometry  # noqa: E402
from twinblend.blender_env import (  # noqa: E402
    bake_world,
    coords,
    empty_scene,
    export_glb,
    import_glb,
    option,
    require_blender,
    rounded,
    script_args,
    set_coords,
    sha256,
    triangles,
    write_json,
)

ANNY_JOINTS = {
    "hip": "upperleg01",
    "knee": "lowerleg01",
    "ankle": "foot",
    "shoulder": "upperarm01",
    "elbow": "lowerarm01",
    "wrist": "wrist",
}
# Ends of the feet and hands, as tails of ANNY's bones: the second toe's tip
# (the foot's long axis) and the middle fingertip.
ANNY_TIPS = {"toe": "toe2-3", "finger": "finger3-3"}
# The palm: the middle metacarpal's z axis, signed with the index and little
# fingers' knuckles (index on the thumb's side).
ANNY_PALM, ANNY_INDEX, ANNY_LITTLE = "metacarpal2", "finger2-1", "finger5-1"
# Of the hand's roll about the forearm, the forearm takes this share and the
# upper arm this, so the skin between them twists in steps, not all at the wrist.
FOREARM_ROLL = 0.5
UPPERARM_ROLL = 0.15
FLOOR_UP = np.array([0.0, 0.0, 1.0])
TAU = 0.010  # softmin blend width, metres
FAR = 0.15  # soft tissue further than this from every allowed bone keeps its main segment
SHARE = 0.03  # a segment joins a soft part's blend when it is nearest for this share of its vertices
SKIN_DIFFUSION = 20  # passes of weight smoothing over the skin's edges
KD_POINTS = 40_000  # bone points kept per segment for distance queries

# HRA group keys (normalised like packages/anatomy/hra-groups.ts).
HRA_BONE = {"knee", "pelvis", "vertebrae", "intervertebraldisk", "sternum", "manubrium"}
HRA_SOFT = {"bloodvasculature", "musclesknee", "kneeligaments", "ligamentsknee", "adipose"}
HRA_HIDDEN = {"placenta", "placentafullterm"}
LIVER_SEGMENT = re.compile(
    r"^VH_[FM]_(left|right)_(antero|postero|infero|supero|superio)(lateral|medial|superior|inferior)_segment\d*$", re.I
)
BP3D_SOFT = {"musculoskeletal/muscle", "musculoskeletal/connective", "cardiovascular/organ", "nervous/organ"}


def hra_group(obj: bpy.types.Object) -> str:
    raw = obj.get("anatomical_structure_of")
    raw = raw if isinstance(raw, str) and raw not in ("", "-") else obj.name
    key = re.sub(r"^#+", "", raw)
    key = re.sub(r"^VH[FM]", "", key, flags=re.I)
    key = re.sub(r"V\d+(\.\d+)*$", "", key, flags=re.I)
    key = re.sub(r"(Left|Right)", "", key, flags=re.I)
    return key.lower()


def classify(obj: bpy.types.Object, scheme: str) -> str:
    """bone, skin, soft, rigid or hidden (rigid, and left out of the box like the app does)."""
    if scheme == "bodyparts3d":
        name = obj.name.split(".")[0]
        if name == "musculoskeletal/bone":
            return "bone"
        if name == "integumentary/organ":
            return "skin"
        return "soft" if name in BP3D_SOFT else "rigid"
    if LIVER_SEGMENT.match(obj.name):
        return "hidden"
    group = hra_group(obj)
    if group in HRA_HIDDEN:
        return "hidden"
    if group == "skin":
        return "skin"
    if group in HRA_BONE:
        return "bone"
    return "soft" if group in HRA_SOFT else "rigid"


def loose_parts(obj: bpy.types.Object) -> np.ndarray:
    """Part id per vertex (connected pieces), numbered by their lowest vertex index."""
    count = len(obj.data.vertices)
    dup = obj.copy()
    dup.data = obj.data.copy()
    bpy.context.scene.collection.objects.link(dup)
    attr = dup.data.attributes.new("twin_index", "INT", "POINT")
    attr.data.foreach_set("value", np.arange(count, dtype=np.int32))
    before = set(bpy.data.objects)
    bpy.ops.object.select_all(action="DESELECT")
    dup.select_set(True)
    bpy.context.view_layer.objects.active = dup
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    pieces = [dup] + [o for o in bpy.data.objects if o not in before]
    indices = []
    for piece in pieces:
        values = np.empty(len(piece.data.vertices), dtype=np.int32)
        piece.data.attributes["twin_index"].data.foreach_get("value", values)
        indices.append(values)
    part = np.empty(count, dtype=np.int64)
    for pid, values in enumerate(sorted(indices, key=lambda v: int(v.min()))):
        part[values] = pid
    for piece in pieces:
        mesh = piece.data
        bpy.data.objects.remove(piece)
        bpy.data.meshes.remove(mesh)
    return part


def body_targets(
    objects: list[bpy.types.Object],
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray], np.ndarray, bpy.types.Object]:
    """ANNY's joints (bone heads at the bind pose), toe and fingertips, palm normals and its mesh's points."""
    arm = next(o for o in objects if o.type == "ARMATURE")
    mesh = next(o for o in objects if o.type == "MESH" and o.parent == arm)
    world = np.array(arm.matrix_world)

    def at(local) -> np.ndarray:
        return world[:3, :3] @ np.array(local[:]) + world[:3, 3]

    bones = arm.data.bones
    joints: dict[str, np.ndarray] = {}
    palm: dict[str, np.ndarray] = {}
    for side in atlas_rig.SIDES:
        for name, bone in ANNY_JOINTS.items():
            joints[f"{name}.{side}"] = at(bones[f"{bone}.{side}"].head_local)
        for name, bone in ANNY_TIPS.items():
            joints[f"{name}.{side}"] = at(bones[f"{bone}.{side}"].tail_local)
        z_axis = world[:3, :3] @ np.array(bones[f"{ANNY_PALM}.{side}"].matrix_local)[:3, 2]
        thumb_side = at(bones[f"{ANNY_INDEX}.{side}"].head_local) - at(bones[f"{ANNY_LITTLE}.{side}"].head_local)
        palm[side] = atlas_rig.palm_side(z_axis, joints[f"finger.{side}"] - joints[f"wrist.{side}"], thumb_side)
    points = coords(mesh) @ np.array(mesh.matrix_world)[:3, :3].T + np.array(mesh.matrix_world)[:3, 3]
    return joints, palm, points, mesh


def frame(points: np.ndarray) -> dict[str, float]:
    lo, hi = points.min(axis=0), points.max(axis=0)
    return {"floor": float(lo[2]), "height": float(hi[2] - lo[2]), "cx": float((lo[0] + hi[0]) / 2), "cy": float((lo[1] + hi[1]) / 2)}


def global_fit(atlas: list[bpy.types.Object], kinds: dict[str, str], body: dict[str, float]) -> float:
    """The app's demo fit: height to height, feet on the floor, box centres together."""
    all_points = np.vstack([coords(o) for o in atlas])
    kept = np.vstack([coords(o) for o in atlas if kinds[o.name] not in ("skin", "hidden")])
    zmin, zmax = all_points[:, 2].min(), all_points[:, 2].max()
    lo, hi = kept.min(axis=0), kept.max(axis=0)
    scale = body["height"] / (zmax - zmin)
    offset = np.array(
        [body["cx"] - scale * (lo[0] + hi[0]) / 2, body["cy"] - scale * (lo[1] + hi[1]) / 2, body["floor"] - scale * zmin]
    )
    for obj in atlas:
        set_coords(obj, coords(obj) * scale + offset)
    return float(scale)


def segment_trees(
    bone_points: dict[str, np.ndarray],
) -> tuple[dict[str, KDTree], KDTree, list[str]]:
    trees: dict[str, KDTree] = {}
    labels: list[str] = []
    everything = []
    for seg in sorted(bone_points):
        pts = bone_points[seg]
        stride = max(1, len(pts) // KD_POINTS)
        pts = pts[::stride]
        tree = KDTree(len(pts))
        for i, p in enumerate(pts):
            tree.insert(p, i)
        tree.balance()
        trees[seg] = tree
        everything.append(pts)
        labels.extend([seg] * len(pts))
    stacked = np.vstack(everything)
    whole = KDTree(len(stacked))
    for i, p in enumerate(stacked):
        whole.insert(p, i)
    whole.balance()
    return trees, whole, labels


def soft_weights(
    points: np.ndarray,
    part: np.ndarray,
    trees: dict[str, KDTree],
    whole: KDTree,
    labels: list[str],
    k: float,
    share: float = SHARE,
    surface: BVHTree | None = None,
) -> np.ndarray:
    """
    Blend weights for soft tissue. Each connected piece (a muscle, a vessel
    tree) blends only between the segments it mostly lies along, so a thigh
    muscle never follows a hand that hangs beside it. The skin is one piece
    over every segment, so it is weighted with `share` 0: every segment,
    with a visibility test against its own `surface`: a bone counts for a
    skin vertex only when the straight line to it does not cross the skin
    again, so a hand beside the thigh leaves the thigh's skin alone.
    """
    segs = atlas_rig.SEGMENTS
    col = {s: i for i, s in enumerate(segs)}
    nearest = np.empty(len(points), dtype=np.int64)
    for i, p in enumerate(points):
        nearest[i] = col[labels[whole.find(p)[1]]]
    weights = np.zeros((len(points), len(segs)))
    for pid in np.unique(part):
        rows = np.flatnonzero(part == pid)
        shares = np.bincount(nearest[rows], minlength=len(segs)) / len(rows)
        main = segs[int(np.argmax(shares))]
        allowed, queue = [main], [main]
        while queue:
            for nb in atlas_rig.NEIGHBOURS[queue.pop(0)]:
                if nb in trees and nb not in allowed and shares[col[nb]] >= share and shares[col[nb]] > 0:
                    allowed.append(nb)
                    queue.append(nb)
        if len(allowed) == 1:
            weights[rows, col[main]] = 1.0
            continue
        allowed.sort(key=lambda s: col[s])
        dist = np.empty((len(rows), len(allowed)))
        for a, r in enumerate(rows):
            for b, s in enumerate(allowed):
                co, _, d = trees[s].find(points[r])
                dist[a, b] = d if surface is None or sees(surface, points[r], np.array(co), k) else np.inf
        none_inside = np.isinf(dist).all(axis=1)
        if none_inside.any():
            dist[none_inside] = [[trees[s].find(points[r])[2] for s in allowed] for r in rows[none_inside]]
        blend = geometry.softmin_weights(dist, TAU * k)
        far = dist.min(axis=1) > FAR * k
        blend[far] = 0.0
        blend[far, allowed.index(main)] = 1.0
        for j, s in enumerate(allowed):
            weights[rows, col[s]] = blend[:, j]
    return weights


def sees(surface: BVHTree, start: np.ndarray, end: np.ndarray, k: float) -> bool:
    """True when the segment start→end does not cross `surface` (past a small offset from start)."""
    direction = end - start
    length = float(np.linalg.norm(direction))
    offset = 0.003 * k
    if length <= 2 * offset:
        return True
    unit = direction / length
    hit = surface.ray_cast(Vector(start + unit * offset), Vector(unit), length - 2 * offset)
    return hit[0] is None


def synthetic_foot(ankle: np.ndarray, floor: float, k: float) -> np.ndarray:
    """Points standing in for foot bones where the atlas has none: ankle to toes and to heel."""
    toe = np.array([ankle[0], ankle[1] - 0.13 * k, floor + 0.02 * k])
    heel = np.array([ankle[0], ankle[1] + 0.04 * k, floor + 0.02 * k])
    t = np.linspace(0, 1, 40)[:, None]
    return np.vstack([ankle + t * (toe - ankle), ankle + t * (heel - ankle)])


def about(point: np.ndarray, turn: np.ndarray) -> np.ndarray:
    """The 4x4 turning by `turn` (3x3) about `point`."""
    return geometry.translation(point) @ geometry.linear(turn) @ geometry.translation(-point)


def deforms(
    rig: atlas_rig.AtlasRig,
    target: dict[str, np.ndarray],
    stretch_limbs: bool = False,
    palm: dict[str, np.ndarray] | None = None,
) -> tuple[dict[str, np.ndarray], dict[str, float], np.ndarray, dict[str, float]]:
    """
    One 4x4 per segment, mapping the atlas at rest onto its fitted place.
    By default each segment only turns toward the body's next joint and keeps
    its length, so the joint lands short or long of it; `stretch_limbs` also
    scales it along its own axis so the joint lands on the body's.

    The ends: a foot with a toe point turns about the vertical through its
    new ankle until its toe points at the body's (yaw only, so the sole stays
    level). A hand with a fingertip and a palm normal turns at its new wrist
    to point at the body's fingertip, then rolls until the palms face the
    same way; the forearm takes FOREARM_ROLL of that roll about its own axis
    and the upper arm UPPERARM_ROLL, so the skin between them does not twist
    all at the wrist. Without those points the foot only follows its ankle
    and the hand keeps its angle to the forearm. Also returns each end's
    turn in degrees (the foot's yaw, the hand's roll about the forearm).
    """
    j = rig.joints
    hips = (j["hip.L"] + j["hip.R"]) / 2
    shift = (target["hip.L"] + target["hip.R"]) / 2 - hips
    shift[2] = 0.0
    trunk = geometry.translation(shift)
    mats = {"trunk": trunk}
    stretch: dict[str, float] = {}
    turns: dict[str, float] = {}
    chains = [("thigh", "shin", "foot", "hip", "knee", "ankle", False)]
    if rig.has_arms:
        chains.append(("upperarm", "forearm", "hand", "shoulder", "elbow", "wrist", True))
    for upper, lower, end, root, mid, tip, end_turns in chains:
        for side in atlas_rig.SIDES:
            r = j[f"{root}.{side}"] + shift
            m = j[f"{mid}.{side}"] + shift
            t = j[f"{tip}.{side}"] + shift
            m_up, k_up = geometry.segment_deform(r, m, r, target[f"{mid}.{side}"], stretch_limbs)
            new_mid = target[f"{mid}.{side}"] if stretch_limbs else geometry.transform_points(m_up, m[None])[0]
            m_lo, k_lo = geometry.segment_deform(m, t, new_mid, target[f"{tip}.{side}"], stretch_limbs)
            new_tip = target[f"{tip}.{side}"] if stretch_limbs else geometry.transform_points(m_lo, t[None])[0]
            stretch[f"{upper}.{side}"] = k_up
            stretch[f"{lower}.{side}"] = k_lo
            point = f"{'finger' if end_turns else 'toe'}.{side}"
            aimed = point in j and point in target
            if end_turns and aimed and palm is not None and side in rig.palm and side in palm:
                turn = geometry.aim_twist(j[point] + shift - t, rig.palm[side], target[point] - new_tip, palm[side])
                axis = new_tip - new_mid
                roll = geometry.roll_angle(axis, m_lo[:3, :3] @ rig.palm[side], turn @ rig.palm[side])
                m_lo = about(new_mid, geometry.axis_angle(axis, FOREARM_ROLL * roll)) @ m_lo
                m_up = about(r, geometry.axis_angle(new_mid - r, UPPERARM_ROLL * roll)) @ m_up
                turns[f"{end}.{side}"] = round(float(np.degrees(roll)), 1)
            elif end_turns:
                # The hand keeps its angle to the forearm (rotation only, no stretch).
                turn = geometry.rotation_between(t - m, new_tip - new_mid)
            elif aimed:
                a_dir = geometry.flat(j[point] + shift - t, FLOOR_UP)
                b_dir = geometry.flat(target[point] - new_tip, FLOOR_UP)
                turn = geometry.aim_twist(a_dir, FLOOR_UP, b_dir, FLOOR_UP)
                turns[f"{end}.{side}"] = round(float(np.degrees(geometry.roll_angle(FLOOR_UP, a_dir, b_dir))), 1)
            else:
                # No foot bones: the foot keeps its orientation, so the sole stays level.
                turn = np.eye(3)
            mats[f"{upper}.{side}"] = m_up @ trunk
            mats[f"{lower}.{side}"] = m_lo @ trunk
            mats[f"{end}.{side}"] = about(new_tip, turn) @ geometry.translation(new_tip - t) @ trunk
    return mats, stretch, shift, turns


def rest_bones(rig: atlas_rig.AtlasRig, k: float) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    j = rig.joints
    hips = (j["hip.L"] + j["hip.R"]) / 2
    bones = {"trunk": (hips, hips + np.array([0, 0, 0.3 * k]))}
    for side in atlas_rig.SIDES:
        bones[f"thigh.{side}"] = (j[f"hip.{side}"], j[f"knee.{side}"])
        bones[f"shin.{side}"] = (j[f"knee.{side}"], j[f"ankle.{side}"])
        bones[f"foot.{side}"] = (j[f"ankle.{side}"], j[f"ankle.{side}"] + np.array([0, -0.1 * k, -0.04 * k]))
        if rig.has_arms:
            bones[f"upperarm.{side}"] = (j[f"shoulder.{side}"], j[f"elbow.{side}"])
            bones[f"forearm.{side}"] = (j[f"elbow.{side}"], j[f"wrist.{side}"])
            w, e = j[f"wrist.{side}"], j[f"elbow.{side}"]
            bones[f"hand.{side}"] = (w, w + 0.4 * (w - e))
    return bones


def build_armature(bones: dict[str, tuple[np.ndarray, np.ndarray]], mats: dict[str, np.ndarray]) -> bpy.types.Object:
    data = bpy.data.armatures.new("atlas-fit")
    arm = bpy.data.objects.new("atlas-fit", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (head, tail) in bones.items():
        eb = data.edit_bones.new(name)
        eb.head = head.tolist()
        eb.tail = tail.tolist()
        eb.use_deform = True
    bpy.ops.object.mode_set(mode="POSE")
    for name in bones:
        rest = np.array(data.bones[name].matrix_local)
        basis = np.linalg.inv(rest) @ mats[name] @ rest
        arm.pose.bones[name].matrix_basis = Matrix(basis.tolist())
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def write_groups(obj: bpy.types.Object, weights: np.ndarray, arm: bpy.types.Object, bones: list[str]) -> None:
    q = geometry.quantise_weights(weights)
    for col, seg in enumerate(atlas_rig.SEGMENTS):
        values = q[:, col]
        if seg not in bones:
            if values.any():
                raise ValueError(f"{obj.name}: weight on {seg}, which has no bone")
            continue
        group = obj.vertex_groups.new(name=seg)
        for value in np.unique(values[values > 0]):
            group.add(np.flatnonzero(values == value).tolist(), float(value), "REPLACE")
    mod = obj.modifiers.new("atlas-fit", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    mod.use_deform_preserve_volume = False


def apply_armature(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="atlas-fit")
    obj.vertex_groups.clear()


def joint_table(before: dict, after: dict, target: dict) -> list[dict]:
    rows = []
    for name in sorted(target):
        if name not in before or name not in after:
            continue
        b, a, t = before[name], after[name], target[name]
        sign = 1.0 if name.endswith(".L") else -1.0
        rows.append(
            {
                "joint": name,
                "body": rounded(t),
                "before": rounded(b),
                "after": rounded(a),
                # Outward is positive: the atlas joint stands outside the body's.
                "beforeOutwardM": round(float(sign * (b[0] - t[0])), 4),
                "beforeVerticalM": round(float(b[2] - t[2]), 4),
                "beforeDistanceM": round(float(np.linalg.norm(b - t)), 4),
                "afterOutwardM": round(float(sign * (a[0] - t[0])), 4),
                "afterVerticalM": round(float(a[2] - t[2]), 4),
                "afterDistanceM": round(float(np.linalg.norm(a - t)), 4),
            }
        )
    return rows


def degrees_between(a: np.ndarray, b: np.ndarray) -> float:
    cos = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))
    return round(float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0)))), 1)


def orientation_rows(
    before: atlas_rig.AtlasRig, after: atlas_rig.AtlasRig, target: dict[str, np.ndarray], palm: dict[str, np.ndarray]
) -> list[dict]:
    """
    Angles in degrees between the atlas's ends and the body's, before and
    after: where each foot points (ankle to toe, seen from above), where each
    hand points (wrist to middle fingertip) and which way its palm faces.
    """

    def pointing(j: dict[str, np.ndarray], base: str, tip: str, top_view: bool) -> np.ndarray:
        v = j[tip] - j[base]
        return geometry.flat(v, FLOOR_UP) if top_view else v

    rows = []
    for side in atlas_rig.SIDES:
        for end, base, tip, top_view in (("foot", "ankle", "toe", True), ("hand", "wrist", "finger", False)):
            keys = (f"{base}.{side}", f"{tip}.{side}")
            if not all(key in r.joints for r in (before, after) for key in keys) or not all(k in target for k in keys):
                continue
            body = pointing(target, *keys, top_view)
            rows.append(
                {
                    "part": f"{end}.{side}",
                    "measure": "pointing",
                    "beforeDeg": degrees_between(pointing(before.joints, *keys, top_view), body),
                    "afterDeg": degrees_between(pointing(after.joints, *keys, top_view), body),
                }
            )
            if end == "hand" and side in before.palm and side in after.palm and side in palm:
                rows.append(
                    {
                        "part": f"{end}.{side}",
                        "measure": "palm",
                        "beforeDeg": degrees_between(before.palm[side], palm[side]),
                        "afterDeg": degrees_between(after.palm[side], palm[side]),
                    }
                )
    return rows


def inside_share(points: np.ndarray, skin: BVHTree) -> float:
    """Share of the points inside the body's skin (behind the nearest face)."""
    inside = 0
    for p in points:
        co, normal, _, _ = skin.find_nearest(Vector(p))
        inside += co is not None and (Vector(p) - co).dot(normal) < 0
    return round(inside / max(len(points), 1), 3)


def fit(
    atlas: list[bpy.types.Object],
    kinds: dict[str, str],
    target: dict[str, np.ndarray],
    body_points: np.ndarray,
    render: tuple[str, str, list[bpy.types.Object]] | None = None,
    stretch_limbs: bool = False,
    palm: dict[str, np.ndarray] | None = None,
    skin: BVHTree | None = None,
) -> dict:
    started = time.monotonic()
    body = frame(body_points)
    scale = global_fit(atlas, kinds, body)
    k = body["height"] / 1.70
    bone_objs = [o for o in atlas if kinds[o.name] == "bone"]
    bone_parts: list[tuple[bpy.types.Object, np.ndarray]] = []
    for obj in bone_objs:
        part = loose_parts(obj)
        for pid in range(int(part.max()) + 1):
            bone_parts.append((obj, np.flatnonzero(part == pid)))
    point_sets = [coords(o)[idx] for o, idx in bone_parts]
    rig = atlas_rig.build_rig(point_sets, body["floor"], body["height"], body["cx"])
    before = dict(rig.joints)
    if render:
        render_state(render, "before", before, target, body)

    mats, stretch, shift, turns = deforms(rig, target, stretch_limbs, palm)
    ends = [f"{e}.{side}" for side in atlas_rig.SIDES for e in ("foot", "hand")]

    def end_points(seg: str) -> np.ndarray | None:
        found = [coords(o)[idx] for (o, idx), s in zip(bone_parts, rig.part_segment) if s == seg]
        return np.vstack(found) if found else None

    inside_before = {seg: inside_share(p, skin) for seg in ends if skin and (p := end_points(seg)) is not None}
    bones = rest_bones(rig, k)
    by_segment: dict[str, list[np.ndarray]] = {}
    for (obj, idx), seg in zip(bone_parts, rig.part_segment):
        by_segment.setdefault(seg, []).append(coords(obj)[idx])
    seg_points = {s: np.vstack(v) for s, v in by_segment.items()}
    for side in atlas_rig.SIDES:
        if f"foot.{side}" not in seg_points:
            seg_points[f"foot.{side}"] = synthetic_foot(rig.joints[f"ankle.{side}"], body["floor"], k)
    trees, whole, labels = segment_trees(seg_points)

    arm = build_armature(bones, mats)
    col = {s: i for i, s in enumerate(atlas_rig.SEGMENTS)}
    counts = {"bone": 0, "soft": 0, "skin": 0, "rigid": 0, "hidden": 0}
    for obj in atlas:
        kind = kinds[obj.name]
        n = len(obj.data.vertices)
        counts[kind] += n
        weights = np.zeros((n, len(atlas_rig.SEGMENTS)))
        if kind == "bone":
            for (owner, idx), seg in zip(bone_parts, rig.part_segment):
                if owner == obj:
                    weights[idx, col[seg]] = 1.0
        elif kind in ("soft", "skin"):
            if kind == "soft":
                weights = soft_weights(coords(obj), loose_parts(obj), trees, whole, labels, k)
            else:
                surface = BVHTree.FromObject(obj, bpy.context.evaluated_depsgraph_get())
                weights = soft_weights(coords(obj), np.zeros(n, dtype=np.int64), trees, whole, labels, k, 0.0, surface)
                # Visibility flips from one vertex to the next; spread it like heat would.
                edges = np.empty(len(obj.data.edges) * 2, dtype=np.int64)
                obj.data.edges.foreach_get("vertices", edges)
                weights = geometry.diffuse(weights, edges.reshape(-1, 2), SKIN_DIFFUSION)
        else:
            weights[:, col["trunk"]] = 1.0
        write_groups(obj, weights, arm, list(bones))
    for obj in atlas:
        apply_armature(obj)

    moved = [coords(o)[idx] for o, idx in bone_parts]
    after_rig = atlas_rig.build_rig(moved, body["floor"], body["height"], body["cx"])
    inside = [
        {"part": seg, "beforeShare": share, "afterShare": inside_share(end_points(seg), skin)}
        for seg, share in inside_before.items()
    ]
    if render:
        render_state(render, "after", after_rig.joints, target, body)
    bpy.data.objects.remove(arm)
    return {
        "scale": round(scale, 6),
        "stretchLimbs": stretch_limbs,
        "trunkShiftM": rounded(shift),
        "stretch": {s: round(v, 4) for s, v in sorted(stretch.items())},
        "hasArms": rig.has_arms,
        "notes": rig.notes,
        "segmentsAssigned": sorted({s for s in rig.part_segment}),
        "vertices": counts,
        "joints": joint_table(before, after_rig.joints, target),
        "endTurnsDeg": dict(sorted(turns.items())),
        "orientation": orientation_rows(rig, after_rig, target, palm or {}),
        "bonesInsideSkin": inside,
        "seconds": round(time.monotonic() - started, 1),
    }


def render_state(render, stage: str, atlas_joints: dict, target: dict, body: dict) -> None:
    from twinblend import render as r

    out_dir, stem, _ = render
    made = r.markers(target, (0.05, 0.6, 0.25, 1), 0.016, "body") + r.markers(atlas_joints, (0.85, 0.1, 0.6, 1), 0.02, "atlas")
    r.render_front(str(Path(out_dir) / f"{stem}.{stage}.png"), body["cx"], body["floor"], body["height"])
    for obj in made:
        bpy.data.objects.remove(obj)


def style_for_render(
    atlas: list[bpy.types.Object], kinds: dict[str, str], body_mesh: bpy.types.Object, scheme: str, show: set[str]
) -> None:
    """Bones ivory, vessels red, muscle and skin when asked; the body as blue glass."""
    from twinblend import render as r

    looks = {
        "bone": r.material("check-bone", (0.86, 0.8, 0.66, 1)),
        "vessel": r.material("check-vessel", (0.72, 0.1, 0.1, 1)),
        "muscle": r.material("check-muscle", (0.62, 0.3, 0.28, 1)),
        "skin": r.material("check-skin", (0.85, 0.7, 0.6, 1)),
    }
    for obj in atlas:
        name = obj.name.split(".")[0]
        if kinds[obj.name] == "bone":
            look = "bone"
        elif kinds[obj.name] == "skin":
            look = "skin"
        elif (name == "cardiovascular/organ") if scheme == "bodyparts3d" else (hra_group(obj) == "bloodvasculature"):
            look = "vessel"
        elif kinds[obj.name] == "soft":
            look = "muscle"
        else:
            look = None
        if look in show:
            r.paint(obj, looks[look])
        else:
            obj.hide_render = True
    r.paint(body_mesh, r.material("check-body", (0.55, 0.72, 0.98, 0.22)))


def run(args: list[str]) -> None:
    atlas_path, body_path = option(args, "--atlas"), option(args, "--body")
    scheme, out, report_path = option(args, "--scheme"), option(args, "--out"), option(args, "--report")
    if not (atlas_path and body_path and scheme in ("bodyparts3d", "hra") and out and report_path):
        sys.stderr.write("fit_atlas.py needs --atlas, --body, --scheme bodyparts3d|hra, --out and --report.\n")
        sys.exit(2)
    empty_scene()
    body_objs = import_glb(body_path)
    target, palm, body_points, body_mesh = body_targets(body_objs)
    skin = BVHTree.FromPolygons(body_points.tolist(), [tuple(p.vertices) for p in body_mesh.data.polygons])
    atlas = [o for o in import_glb(atlas_path) if o.type == "MESH"]
    bake_world(atlas)
    kinds = {o.name: classify(o, scheme) for o in atlas}
    render_dir = option(args, "--render-dir")
    render = None
    if render_dir:
        show = set((option(args, "--render-show", "bone,vessel") or "").split(","))
        style_for_render(atlas, kinds, body_mesh, scheme, show)
        render = (render_dir, option(args, "--render-name", Path(out).stem), atlas)
    result = fit(atlas, kinds, target, body_points, render, "--stretch" in args, palm, skin)
    export_glb(atlas, out)
    result.update(
        {
            "atlas": Path(atlas_path).name,
            "atlasSha256": sha256(atlas_path),
            "body": Path(body_path).name,
            "bodySha256": sha256(body_path),
            "output": Path(out).name,
            "outputSha256": sha256(out),
            "outputBytes": Path(out).stat().st_size,
            "triangles": sum(triangles(o) for o in atlas),
            "blender": bpy.app.version_string,
        }
    )
    write_json(report_path, result)
    print(f"fit_atlas: wrote {out} and {report_path}")


def plan_check(legs: dict[str, np.ndarray], legs_target: dict[str, np.ndarray]) -> list[str]:
    """
    The ends' plan on exact values: an atlas foot turned 20° outward and a
    hand hanging straight down, palm forward (thumb outward), against a body
    whose feet point straight ahead and whose hands point forward and down
    with the palms inward. Returns failures.
    """
    failures: list[str] = []
    j, target = dict(legs), dict(legs_target)
    out = np.array([np.sin(np.radians(20)), -np.cos(np.radians(20)), 0.0])
    for s, side in ((1, "L"), (-1, "R")):
        x = np.array([s, 1.0, 1.0])
        j[f"toe.{side}"] = (legs["ankle.L"] + 0.15 * out - [0, 0, 0.04]) * x
        j |= {f"{n}.{side}": np.array(p) * x for n, p in (("shoulder", [0.18, 0, 1.4]), ("elbow", [0.2, 0, 1.1]), ("wrist", [0.22, 0, 0.84]), ("finger", [0.22, 0, 0.66]))}
        target[f"toe.{side}"] = np.array([0.15 * s, -0.2, 0.02])
        target |= {f"{n}.{side}": np.array(p) * x for n, p in (("shoulder", [0.18, 0, 1.4]), ("elbow", [0.21, -0.02, 1.11]), ("wrist", [0.23, -0.1, 0.85]), ("finger", [0.23, -0.2, 0.68]))}
    # Signed by handedness (atlas_rig.palm_side): the left palm's side, the right hand's back.
    rig = atlas_rig.AtlasRig(joints=j, has_arms=True, palm={"L": np.array([0.0, -1, 0]), "R": np.array([0.0, 1, 0])})
    body_palm = {"L": np.array([-1.0, 0, 0]), "R": np.array([-1.0, 0, 0])}
    mats, _, shift, turns = deforms(rig, target, palm=body_palm)

    def moved(seg: str, p: np.ndarray) -> np.ndarray:
        return geometry.transform_points(mats[seg], p[None])[0]

    for side in atlas_rig.SIDES:
        ankle = moved(f"shin.{side}", j[f"ankle.{side}"])
        toe = moved(f"foot.{side}", j[f"toe.{side}"])
        if np.linalg.norm(moved(f"foot.{side}", j[f"ankle.{side}"]) - ankle) > 1e-12:
            failures.append(f"foot.{side} left its ankle")
        if degrees_between(geometry.flat(toe - ankle, FLOOR_UP), geometry.flat(target[f"toe.{side}"] - ankle, FLOOR_UP)) > 1e-6:
            failures.append(f"foot.{side} does not point at the body's toe")
        if np.linalg.norm(mats[f"foot.{side}"][:3, :3] @ FLOOR_UP - FLOOR_UP) > 1e-12 or abs(abs(turns[f"foot.{side}"]) - 20) > 0.5:
            failures.append(f"foot.{side} tilted or turned {turns.get(f'foot.{side}')}°, not 20° about the vertical")
        elbow, wrist = moved(f"upperarm.{side}", j[f"elbow.{side}"]), moved(f"forearm.{side}", j[f"wrist.{side}"])
        if np.linalg.norm(moved(f"forearm.{side}", j[f"elbow.{side}"]) - elbow) > 1e-12 or np.linalg.norm(moved(f"hand.{side}", j[f"wrist.{side}"]) - wrist) > 1e-12:
            failures.append(f"the {side} arm's rolls moved a joint")
        hand = mats[f"hand.{side}"][:3, :3]
        if degrees_between(moved(f"hand.{side}", j[f"finger.{side}"]) - wrist, target[f"finger.{side}"] - wrist) > 1e-6:
            failures.append(f"hand.{side} does not point at the body's fingertip")
        if (hand @ rig.palm[side]) @ body_palm[side] < 0.999 or abs(abs(turns[f"hand.{side}"]) - 90) > 15:
            failures.append(f"hand.{side} palm {hand @ rig.palm[side]}, roll {turns.get(f'hand.{side}')}°")
        # The forearm takes about half the roll: the hand turns about half as far again from it.
        fore = mats[f"forearm.{side}"][:3, :3]
        axis = wrist - elbow
        left = np.degrees(geometry.roll_angle(axis, fore @ rig.palm[side], hand @ rig.palm[side]))
        if abs(abs(left) - (1 - FOREARM_ROLL) * abs(turns[f"hand.{side}"])) > 3.0:
            failures.append(f"forearm.{side} leaves {left}° of the roll to the wrist")
    if np.abs(shift[2]) > 1e-12:
        failures.append("the plan moved the trunk vertically")
    return failures


def self_check() -> int:
    """A tiny synthetic atlas (bone rods, one muscle, one organ) fitted to a synthetic rig."""
    failures = geometry.self_check() + atlas_rig.self_check()
    empty_scene()

    def mesh_from(name: str, pieces: list[tuple[np.ndarray, np.ndarray]]) -> bpy.types.Object:
        verts, faces, base = [], [], 0
        for v, f in pieces:
            verts.append(v)
            faces.append(f + base)
            base += len(v)
        me = bpy.data.meshes.new(name)
        me.from_pydata(np.vstack(verts).tolist(), [], np.vstack(faces).tolist())
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    def tube(a, b, r, n=10, rings=12):
        a, b = np.asarray(a, float), np.asarray(b, float)
        d = (b - a) / np.linalg.norm(b - a)
        u = np.cross(d, [0, 1, 0])
        u /= np.linalg.norm(u)
        v = np.cross(d, u)
        ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
        ring = r * (np.outer(np.cos(ang), u) + np.outer(np.sin(ang), v))
        verts = np.vstack([a + t * (b - a) + ring for t in np.linspace(0, 1, rings)])
        faces = [[i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j] for i in range(rings - 1) for j in range(n)]
        return verts, np.array(faces)

    def ball(c, r):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=c, segments=16, ring_count=10)
        obj = bpy.context.active_object
        v = np.array([obj.matrix_world @ x.co for x in obj.data.vertices])
        # Quads only: the pole triangles are left out, which a test bone does not need.
        f = np.array([list(p.vertices) for p in obj.data.polygons if len(p.vertices) == 4])
        bpy.data.objects.remove(obj)
        return v, f

    bone_pieces = []
    for s in (1, -1):
        hv, hf = ball((0.09 * s, 0, 0.88), 0.024)
        neck_v, neck_f = tube([0.11 * s, 0, 0.87], [0.10 * s, 0, 0.47], 0.012)
        bone_pieces.append((np.vstack([hv, neck_v]), np.vstack([hf, neck_f + len(hv)])))
        bone_pieces.append(tube([0.09 * s, 0, 0.45], [0.09 * s, 0, 0.07], 0.015))
        bone_pieces.append(tube([0.12 * s, 0, 0.44], [0.12 * s, 0, 0.05], 0.008))
    bone_pieces.append(tube([0, 0.05, 0.9], [0, 0.05, 1.6], 0.02))
    bone_pieces.append(tube([0, 0.05, 1.6], [0, 0.05, 1.7], 0.05))
    bones = mesh_from("musculoskeletal/bone", bone_pieces)
    muscle = mesh_from("musculoskeletal/muscle", [tube([0.1, 0, 0.8], [0.1, 0, 0.2], 0.05)])
    organ = mesh_from("digestive/organ", [tube([0.0, -0.02, 1.0], [0.0, -0.02, 1.2], 0.06)])
    atlas = [bones, muscle, organ]
    kinds = {o.name: classify(o, "bodyparts3d") for o in atlas}
    organ_before = coords(organ).copy()
    # The body: legs 4 cm wider at the ankle, knees 1 cm forward, 2 % taller.
    target = {}
    for s, side in ((1, "L"), (-1, "R")):
        target[f"hip.{side}"] = np.array([0.095 * s, 0.0, 0.90])
        target[f"knee.{side}"] = np.array([0.12 * s, -0.01, 0.47])
        target[f"ankle.{side}"] = np.array([0.15 * s, 0.0, 0.075])
    body_points = np.array([[-0.2, -0.1, 0.0], [0.2, 0.1, 1.734]])
    # The default keeps bone lengths: every segment's stretch is exactly 1.
    j = {}
    for s, side in ((1, "L"), (-1, "R")):
        j[f"hip.{side}"] = np.array([0.09 * s, 0.0, 0.88])
        j[f"knee.{side}"] = np.array([0.1 * s, 0.0, 0.46])
        j[f"ankle.{side}"] = np.array([0.1 * s, 0.0, 0.06])
    _, kept, _, _ = deforms(atlas_rig.AtlasRig(joints=j), target)
    if any(abs(v - 1.0) > 1e-12 for v in kept.values()):
        failures.append(f"the default stretched a segment: {kept}")
    failures += plan_check(j, target)
    result = fit(atlas, kinds, target, body_points, stretch_limbs=True)
    for row in result["joints"]:
        if row["joint"].split(".")[0] in ("knee", "ankle") and row["afterDistanceM"] > 0.004:
            failures.append(f"{row['joint']} off by {row['afterDistanceM']} m after the fit")
    shift = np.array(result["trunkShiftM"])
    scale = result["scale"]
    expected = organ_before * scale + (coords(organ) - organ_before * scale).mean(axis=0)
    if np.abs(coords(organ) - expected).max() > 1e-5:
        failures.append("the organ did not move rigidly")
    if abs(shift[2]) > 1e-12:
        failures.append("the trunk moved vertically")
    for line in failures:
        print(f"SELF-CHECK FAIL {line}")
    print("fit_atlas self-check: " + ("ok" if not failures else f"{len(failures)} failed"))
    return 1 if failures else 0


if __name__ == "__main__":
    require_blender()
    argv = script_args()
    if "--self-check" in argv:
        sys.exit(self_check())
    run(argv)
