# /// script
# requires-python = "==3.12.*"
# dependencies = [
#   "anny==0.6.2",
#   "torch==2.14.1+cpu",
# ]
#
# [tool.uv]
# index-strategy = "unsafe-best-match"
#
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
#
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# ///
"""
Bakes a rigged ANNY demo body: the same adult shape as the pinned static demo
bodies (gender 0 or 1, age 2/3 "young", every other phenotype 0.5; 1.914 m and
1.772 m), with ANNY's own 104-bone skeleton and skin weights kept.

Run through `bun run anatomy:bake-rigged`, which checks the bytes against the
pins in packages/anatomy/rigged-bodies.ts before installing them. Direct use:

    uv run --script scripts/anatomy/bake-anny-rigged.py <male|female> <out.glb>

Bind pose: ANNY's rest pose with the upper arms lowered 30 degrees and the
forearms opened to hang about 15 degrees in front of the upper arm, so the arms
hang at the sides like the static demo bodies. Frame: metres, +Y up, faces +Z,
feet at y=0, +X the subject's left (the atlas frame, docs/anatomy.md).

Output is plain glTF 2.0 (no extensions): POSITION, JOINTS_0 and WEIGHTS_0
(four strongest influences, UNSIGNED_BYTE), 16-bit indices, one skin. Values
are rounded before they are written (positions to 10 micrometres, weights to
1/255) so the bytes do not depend on the last bits of float math.
"""

import json
import math
import struct
import sys
import warnings

warnings.filterwarnings("ignore")

import roma  # noqa: E402  (installed with anny)
import torch  # noqa: E402

import anny  # noqa: E402

PHENOTYPES = {
    "male": {"gender": 0.0, "age": 2 / 3},
    "female": {"gender": 1.0, "age": 2 / 3},
}
ARM_DROP_DEG = 30.0
ELBOW_FLEX_DEG = 15.0
INFLUENCES = 4


def rotation_between(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    """The shortest rotation (3x3) taking direction a onto direction b."""
    a = a / a.norm()
    b = b / b.norm()
    axis = torch.linalg.cross(a, b)
    s = axis.norm()
    if s < 1e-12:
        return torch.eye(3, dtype=a.dtype)
    angle = torch.atan2(s, torch.dot(a, b))
    return roma.rotvec_to_rotmat(axis / s * angle)


def bind_pose(model, pheno):
    labels = model.bone_labels
    ix = {name: i for i, name in enumerate(labels)}
    delta = torch.eye(4, dtype=torch.float64)[None].repeat(len(labels), 1, 1)
    for side, sign in (("L", 1.0), ("R", -1.0)):
        rotvec = torch.tensor([0.0, sign * math.radians(ARM_DROP_DEG), 0.0], dtype=torch.float64)
        delta[ix[f"upperarm01.{side}"], :3, :3] = roma.rotvec_to_rotmat(rotvec)
    first = model(pose_parameters=delta[None], phenotype_kwargs=pheno)
    heads = first["bone_poses"][0][:, :3, 3]
    forward = torch.tensor([0.0, -1.0, 0.0], dtype=torch.float64)  # ANNY faces -Y
    for side in ("L", "R"):
        upper = heads[ix[f"lowerarm01.{side}"]] - heads[ix[f"upperarm01.{side}"]]
        fore = heads[ix[f"wrist.{side}"]] - heads[ix[f"lowerarm01.{side}"]]
        flex = math.radians(ELBOW_FLEX_DEG)
        target = upper / upper.norm() * math.cos(flex) + forward * math.sin(flex)
        delta[ix[f"lowerarm01.{side}"], :3, :3] = rotation_between(fore, target)
    return model(pose_parameters=delta[None], phenotype_kwargs=pheno)


def pad4(data: bytes, fill: bytes = b"\x00") -> bytes:
    return data + fill * ((4 - len(data) % 4) % 4)


def bake(sex: str) -> bytes:
    torch.set_default_dtype(torch.float64)
    model = anny.Anny(rig="anny").to(torch.float64)
    labels = model.bone_labels
    parents = model.bone_parents
    out = bind_pose(model, PHENOTYPES[sex])

    verts = out["vertices"][0]
    floor = float(verts[:, 2].min())
    # ANNY is +Z up and faces -Y; the atlas frame is +Y up and faces +Z.
    to_atlas = torch.tensor(
        [[1, 0, 0, 0], [0, 0, 1, -floor], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=torch.float64
    )
    positions = (verts @ to_atlas[:3, :3].T + to_atlas[:3, 3]).mul(1e5).round().div(1e5)
    globals_ = to_atlas @ out["bone_poses"][0]

    # Node transforms: local = parent^-1 * global, as translation + unit quaternion, rounded.
    translations, rotations, rebuilt = [], [], []
    for j, parent in enumerate(parents):
        local = globals_[j] if parent < 0 else torch.linalg.inv(globals_[parent]) @ globals_[j]
        t = local[:3, 3].mul(1e6).round().div(1e6)
        q = roma.rotmat_to_unitquat(local[:3, :3])  # x, y, z, w like glTF
        q = q if q[3] >= 0 else -q
        q = (q / q.norm()).mul(1e7).round().div(1e7)
        q = q / q.norm()
        translations.append(t)
        rotations.append(q)
        m = torch.eye(4, dtype=torch.float64)
        m[:3, :3] = roma.unitquat_to_rotmat(q)
        m[:3, 3] = t
        rebuilt.append(m if parent < 0 else rebuilt[parent] @ m)
    inverse_bind = [torch.linalg.inv(m) for m in rebuilt]

    weights = model.vertex_bone_weights
    indices = model.vertex_bone_indices
    top = torch.argsort(-weights, dim=1, stable=True)[:, :INFLUENCES]
    top_w = torch.gather(weights, 1, top)
    top_j = torch.gather(indices, 1, top)
    top_w = top_w / top_w.sum(dim=1, keepdim=True)
    q_w = (top_w * 255).round().to(torch.int64)
    # Each row sums to exactly 255: the rounding error goes to the strongest influence.
    q_w[:, 0] += 255 - q_w.sum(dim=1)
    top_j = torch.where(q_w > 0, top_j, torch.zeros_like(top_j))

    faces = model.get_triangular_faces()
    count = positions.shape[0]
    assert count < 65536 and len(labels) < 256

    blobs = [
        struct.pack(f"<{count * 3}f", *positions.flatten().tolist()),
        bytes(top_j.to(torch.uint8).flatten().tolist()),
        bytes(q_w.to(torch.uint8).flatten().tolist()),
        struct.pack(f"<{faces.numel()}H", *faces.flatten().tolist()),
        struct.pack(
            f"<{len(labels) * 16}f",
            *[x for m in inverse_bind for x in m.T.flatten().tolist()],
        ),
    ]
    views, offset, binary = [], 0, b""
    targets = [34962, 34962, 34962, 34963, None]
    for blob, target in zip(blobs, targets):
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(blob)}
        if target is not None:
            view["target"] = target
        views.append(view)
        padded = pad4(blob)
        binary += padded
        offset += len(padded)

    pmin = [round(float(x), 5) for x in positions.min(0).values]
    pmax = [round(float(x), 5) for x in positions.max(0).values]
    accessors = [
        {"bufferView": 0, "componentType": 5126, "count": count, "type": "VEC3", "min": pmin, "max": pmax},
        {"bufferView": 1, "componentType": 5121, "count": count, "type": "VEC4"},
        {"bufferView": 2, "componentType": 5121, "normalized": True, "count": count, "type": "VEC4"},
        {"bufferView": 3, "componentType": 5123, "count": faces.numel(), "type": "SCALAR"},
        {"bufferView": 4, "componentType": 5126, "count": len(labels), "type": "MAT4"},
    ]
    # Node 0 is the skinned mesh; bones follow, node 1 + j for bone j.
    nodes = [{"name": "AnnyBody", "mesh": 0, "skin": 0}]
    for j, name in enumerate(labels):
        node = {
            "name": name,
            "translation": [float(x) for x in translations[j]],
            "rotation": [float(x) for x in rotations[j]],
        }
        children = [1 + k for k, p in enumerate(parents) if p == j]
        if children:
            node["children"] = children
        nodes.append(node)
    roots = [1 + j for j, p in enumerate(parents) if p < 0]
    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "twin-llm scripts/anatomy/bake-anny-rigged.py",
            "copyright": "ANNY, NAVER LABS Europe / NAVER Corporation: Apache-2.0 code over CC0-1.0 shape assets derived from MakeHuman (arXiv:2511.03589). Synthetic; no scan of any person.",
        },
        "scene": 0,
        "scenes": [{"nodes": [0, *roots]}],
        "nodes": nodes,
        "meshes": [
            {
                "name": "AnnyBody",
                "primitives": [
                    {"attributes": {"POSITION": 0, "JOINTS_0": 1, "WEIGHTS_0": 2}, "indices": 3, "mode": 4}
                ],
            }
        ],
        "skins": [{"inverseBindMatrices": 4, "joints": [1 + j for j in range(len(labels))], "skeleton": roots[0]}],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    text = pad4(json.dumps(gltf, separators=(",", ":"), sort_keys=True).encode(), b" ")
    total = 12 + 8 + len(text) + 8 + len(binary)
    return (
        struct.pack("<III", 0x46546C67, 2, total)
        + struct.pack("<II", len(text), 0x4E4F534A)
        + text
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in PHENOTYPES:
        sys.stderr.write("Usage: bake-anny-rigged.py <male|female> <out.glb>\n")
        return 2
    with open(sys.argv[2], "wb") as handle:
        handle.write(bake(sys.argv[1]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
