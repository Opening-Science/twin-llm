"""
Mesh cleanup for a body surface: merge, fill holes, make normals consistent,
smooth, optionally voxel-remesh, decimate to LODs, export glTF. Blender 5.2.x, headless.

Meant for body scans later. It is only ever run here on the synthetic ANNY
demo body, damaged on purpose (`--demo-damage`), never on a person's scan.

Inputs (after `--`):
  --in <glb> --out-dir <dir> [--name <stem>] [--lods 0.5,0.25] [--voxel <metres>]
     [--smooth <Taubin passes, default 5>] [--report <json>]
  --demo-damage [--seed 7]  first punch holes, add 2 mm noise and flip patches of
                            faces, then clean, and compare with the undamaged mesh
  --self-check              runs on a damaged icosphere and checks the result
Outputs: <stem>.lod0.glb (the cleaned mesh) and one GLB per LOD ratio, plus a JSON
report of triangles, open edges, holes, non-manifold and inconsistently wound
edges, and outward volume, before and after. Seeds are fixed, so runs repeat.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

from twinblend.geometry import taubin_smooth  # noqa: E402
from twinblend.blender_env import (  # noqa: E402
    coords,
    empty_scene,
    export_glb,
    import_glb,
    option,
    require_blender,
    script_args,
    set_coords,
    sha256,
    write_json,
)


def measure(obj: bpy.types.Object) -> dict:
    """Topology counts from bmesh; a closed, consistently wound surface has zeros in all but triangles."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    boundary = [e for e in bm.edges if len(e.link_faces) == 1]
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
    inconsistent = sum(1 for e in bm.edges if e.is_manifold and not e.is_contiguous)
    # Holes: loops of boundary edges, counted as connected groups.
    seen: set[int] = set()
    holes = 0
    for edge in boundary:
        if edge.index in seen:
            continue
        holes += 1
        stack = [edge]
        while stack:
            e = stack.pop()
            if e.index in seen:
                continue
            seen.add(e.index)
            for v in e.verts:
                stack.extend(x for x in v.link_edges if len(x.link_faces) == 1 and x.index not in seen)
    tris = bm.calc_loop_triangles()
    volume = sum(t[0].vert.co.dot(t[1].vert.co.cross(t[2].vert.co)) for t in tris) / 6.0
    result = {
        "triangles": len(tris),
        "vertices": len(bm.verts),
        "openEdges": len(boundary),
        "holes": holes,
        "nonManifoldEdges": non_manifold,
        "inconsistentEdges": inconsistent,
        "manifold": non_manifold == 0 and inconsistent == 0,
        "outwardVolumeM3": round(volume, 6),
    }
    bm.free()
    return result


def surface_error(obj: bpy.types.Object, reference: BVHTree) -> dict:
    """Distance from each vertex to the reference surface, millimetres."""
    d = np.array([reference.find_nearest(p)[3] for p in coords(obj)]) * 1000
    return {"meanMm": round(float(d.mean()), 3), "p95Mm": round(float(np.percentile(d, 95)), 3), "maxMm": round(float(d.max()), 3)}


def edit(obj: bpy.types.Object, ops) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    ops()
    bpy.ops.object.mode_set(mode="OBJECT")


def apply_modifier(obj: bpy.types.Object, kind: str, **settings) -> None:
    mod = obj.modifiers.new(kind.lower(), kind)
    for key, value in settings.items():
        setattr(mod, key, value)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def clean(obj: bpy.types.Object, smooth: int, voxel: float | None) -> None:
    def repair():
        bpy.ops.mesh.remove_doubles(threshold=1e-6)
        bpy.ops.mesh.delete_loose()
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.fill_holes(sides=0)
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.quads_convert_to_tris(quad_method="BEAUTY", ngon_method="BEAUTY")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)

    edit(obj, repair)
    if smooth > 0:
        edges = np.empty(len(obj.data.edges) * 2, dtype=np.int64)
        obj.data.edges.foreach_get("vertices", edges)
        set_coords(obj, taubin_smooth(coords(obj), edges.reshape(-1, 2), smooth))
    if voxel:
        obj.data.remesh_voxel_size = voxel
        obj.data.use_remesh_preserve_volume = True
        obj.data.use_remesh_preserve_attributes = True
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.voxel_remesh()
        edit(obj, lambda: (bpy.ops.mesh.quads_convert_to_tris(), bpy.ops.mesh.normals_make_consistent(inside=False)))


def lod(obj: bpy.types.Object, ratio: float) -> bpy.types.Object:
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = f"{obj.name}.lod{ratio}"
    bpy.context.scene.collection.objects.link(copy)
    apply_modifier(copy, "DECIMATE", decimate_type="COLLAPSE", ratio=ratio, use_collapse_triangulate=True)
    edit(copy, lambda: bpy.ops.mesh.normals_make_consistent(inside=False))
    return copy


def damage(obj: bpy.types.Object, seed: int, noise_m: float, holes: int, flips: int) -> dict:
    """Holes, noise and flipped faces, the same every time for one seed."""
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()

    def patch(start, rings):
        region = {start}
        for _ in range(rings):
            region |= {f for g in list(region) for e in g.edges for f in e.link_faces}
        return region

    seeds = rng.choice(len(bm.faces), size=holes + flips, replace=False)
    flip_faces = set().union(*(patch(bm.faces[int(i)], 2) for i in seeds[holes:])) if flips else set()
    gone = set().union(*(patch(bm.faces[int(i)], 1) for i in seeds[:holes])) if holes else set()
    for face in flip_faces - gone:
        face.normal_flip()
    bmesh.ops.delete(bm, geom=list(gone), context="FACES_ONLY")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    points = coords(obj)
    set_coords(obj, points + rng.normal(scale=noise_m, size=points.shape))
    return {"seed": seed, "holes": holes, "flippedPatches": flips, "noiseSigmaMm": noise_m * 1000, "facesRemoved": len(gone)}


def run_one(obj: bpy.types.Object, out_dir: str, name: str, lods: list[float], smooth: int, voxel: float | None, reference: BVHTree | None) -> dict:
    before = measure(obj)
    before_error = surface_error(obj, reference) if reference else None
    clean(obj, smooth, voxel)
    after = measure(obj)
    outputs = []
    base = Path(out_dir) / f"{name}.lod0.glb"
    export_glb([obj], str(base))
    outputs.append({"lod": 0, "ratio": 1.0, "file": base.name, "sha256": sha256(str(base)), **measure(obj)})
    for i, ratio in enumerate(lods, start=1):
        copy = lod(obj, ratio)
        path = Path(out_dir) / f"{name}.lod{i}.glb"
        export_glb([copy], str(path))
        outputs.append({"lod": i, "ratio": ratio, "file": path.name, "sha256": sha256(str(path)), **measure(copy)})
    result = {"before": before, "after": after, "outputs": outputs, "voxelM": voxel, "smoothIterations": smooth}
    if reference:
        result["surfaceErrorBefore"] = before_error
        result["surfaceErrorAfter"] = surface_error(obj, reference)
    return result


def bvh_of(obj: bpy.types.Object) -> BVHTree:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def run(args: list[str]) -> None:
    source, out_dir = option(args, "--in"), option(args, "--out-dir")
    if not source or not out_dir:
        sys.stderr.write("cleanup_mesh.py needs --in <glb> and --out-dir <dir>.\n")
        sys.exit(2)
    lods = [float(x) for x in (option(args, "--lods", "0.5,0.25") or "").split(",") if x]
    smooth = int(option(args, "--smooth", "5") or 0)
    voxel_arg = option(args, "--voxel")
    voxel = float(voxel_arg) if voxel_arg else None
    name = option(args, "--name", Path(source).stem.split(".")[0])
    empty_scene()
    meshes = [o for o in import_glb(source) if o.type == "MESH"]
    if len(meshes) != 1:
        sys.stderr.write(f"cleanup_mesh.py expects one mesh in {source}; found {len(meshes)}.\n")
        sys.exit(2)
    obj = meshes[0]
    obj.parent = None
    obj.data.transform(obj.matrix_world)
    obj.matrix_world.identity()
    report: dict = {"input": Path(source).name, "inputSha256": sha256(source), "blender": bpy.app.version_string}
    reference = None
    if "--demo-damage" in args:
        reference = bvh_of(obj)
        report["original"] = measure(obj)
        report["damage"] = damage(obj, int(option(args, "--seed", "7") or 7), 0.002, holes=8, flips=6)
    report.update(run_one(obj, out_dir, name, lods, smooth, voxel, reference))
    report_path = option(args, "--report", str(Path(out_dir) / f"{name}.cleanup.json"))
    write_json(report_path, report)
    print(f"cleanup_mesh: wrote {out_dir} and {report_path}")


def self_check() -> int:
    empty_scene()
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=0.1)
    obj = bpy.context.active_object
    obj.data.transform(obj.matrix_world)
    obj.matrix_world.identity()
    reference = bvh_of(obj)
    damage(obj, 3, 0.001, holes=3, flips=2)
    damaged = measure(obj)
    out_dir = str(Path(bpy.app.tempdir or "/tmp") / "twin-cleanup-self-check")
    result = run_one(obj, out_dir, "ico", [0.5, 0.25], 5, None, reference)
    failures = []
    if damaged["holes"] != 3 or damaged["inconsistentEdges"] == 0:
        failures.append(f"damage not as made: {damaged}")
    after = result["after"]
    if after["openEdges"] or after["nonManifoldEdges"] or after["inconsistentEdges"] or after["outwardVolumeM3"] <= 0:
        failures.append(f"not a closed outward surface after cleanup: {after}")
    tris = [o["triangles"] for o in result["outputs"]]
    if not all(a > b for a, b in zip(tris, tris[1:])):
        failures.append(f"LOD triangles do not fall: {tris}")
    if result["surfaceErrorAfter"]["meanMm"] >= result["surfaceErrorBefore"]["meanMm"]:
        failures.append(f"smoothing did not bring the surface closer: {result['surfaceErrorBefore']} -> {result['surfaceErrorAfter']}")
    for line in failures:
        print(f"SELF-CHECK FAIL {line}")
    print("cleanup_mesh self-check: " + ("ok" if not failures else f"{len(failures)} failed"))
    return 1 if failures else 0


if __name__ == "__main__":
    require_blender()
    argv = script_args()
    if "--self-check" in argv:
        sys.exit(self_check())
    run(argv)
