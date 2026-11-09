"""Blender session helpers: the version pin, arguments, glTF in and out, vertex arrays.

Every script calls `require_blender()` first. The pipeline is pinned to
Blender 5.2.x LTS: the glTF importer's meshopt support, the exporter's
options and the operators used here were checked on 5.2.3, and another
series may move a vertex or a byte.
"""
from __future__ import annotations

import hashlib
import json
import random
import sys
from pathlib import Path

import bpy
import numpy as np

REQUIRED_SERIES = (5, 2)


def require_blender() -> None:
    version = tuple(bpy.app.version[:2])
    if version != REQUIRED_SERIES:
        sys.stderr.write(
            f"These scripts need Blender {REQUIRED_SERIES[0]}.{REQUIRED_SERIES[1]}.x LTS; "
            f"this is Blender {bpy.app.version_string}. Set BLENDER_BIN to a 5.2 binary.\n"
        )
        sys.exit(2)
    random.seed(0)
    np.random.seed(0)


def script_args() -> list[str]:
    """The arguments after Blender's `--`."""
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def option(args: list[str], name: str, default: str | None = None) -> str | None:
    if name in args:
        i = args.index(name)
        if i + 1 < len(args):
            return args[i + 1]
    return default


def empty_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: str) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return sorted((o for o in bpy.data.objects if o not in before), key=lambda o: o.name)


def bake_world(objects: list[bpy.types.Object]) -> None:
    """Move each mesh's world transform into its vertices, so world space is mesh space."""
    for obj in objects:
        if obj.type != "MESH":
            continue
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.data.transform(world)
        obj.matrix_world.identity()


def coords(obj: bpy.types.Object) -> np.ndarray:
    """Vertex positions as float64 (n, 3); after `bake_world` these are world positions."""
    flat = np.empty(len(obj.data.vertices) * 3, dtype=np.float64)
    obj.data.vertices.foreach_get("co", flat)
    return flat.reshape(-1, 3)


def set_coords(obj: bpy.types.Object, points: np.ndarray) -> None:
    obj.data.vertices.foreach_set("co", points.astype(np.float32).ravel())
    obj.data.update()


def triangles(obj: bpy.types.Object) -> int:
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def export_glb(objects: list[bpy.types.Object], path: str, meshopt: bool = True) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_apply=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_texcoords=True,
        # The pinned atlases carry no normals and no materials; the viewer makes both.
        # Exported normals would also split every vertex at its faces' edges.
        export_normals=False,
        export_materials="NONE",
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_meshopt_compression_enable=meshopt,
    )


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: str, data: object) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def rounded(values, places: int = 4) -> list[float]:
    return [round(float(v), places) for v in values]
