"""Front-view renders for checking a fit or a cleanup by eye. Needs Blender 5.2.x.

Orthographic camera on the subject's front (-Y), Eevee, a flat grey world and
a sun, so a render shows positions, not lighting. Nothing here is measured.
"""
from __future__ import annotations

import math
from pathlib import Path

import bpy
import numpy as np


def material(name: str, rgba: tuple[float, float, float, float]) -> bpy.types.Material:
    found = bpy.data.materials.get(name)
    if found is not None:
        return found
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = 0.8
    bsdf.inputs["Alpha"].default_value = rgba[3]
    if rgba[3] < 1:
        mat.surface_render_method = "BLENDED"
        mat.use_transparency_overlap = False
    mat.diffuse_color = rgba
    return mat


def paint(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    # Baked colour attributes would multiply in through the material; a check render ignores them.
    for poly in obj.data.polygons:
        poly.material_index = 0


def markers(points: dict[str, np.ndarray], rgba, radius: float, prefix: str) -> list[bpy.types.Object]:
    mat = material(f"{prefix}-marker", rgba)
    made = []
    for name, p in sorted(points.items()):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=tuple(float(v) for v in p), segments=16, ring_count=8)
        obj = bpy.context.active_object
        obj.name = f"{prefix}:{name}"
        paint(obj, mat)
        made.append(obj)
    return made


def render_front(path: str, centre_x: float, floor_z: float, height: float, width_px=1440, height_px=1080) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width_px
    scene.render.resolution_y = height_px
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    world = scene.world or bpy.data.worlds.new("check-world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.16, 0.17, 0.19, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    cam = bpy.data.objects.get("check-camera")
    if cam is None:
        cam = bpy.data.objects.new("check-camera", bpy.data.cameras.new("check-camera"))
        scene.collection.objects.link(cam)
        sun = bpy.data.objects.new("check-sun", bpy.data.lights.new("check-sun", "SUN"))
        sun.data.energy = 2.5
        sun.rotation_euler = (math.radians(50), 0, math.radians(-20))
        scene.collection.objects.link(sun)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = height * 1.08 * width_px / height_px
    cam.location = (centre_x, -10.0, floor_z + height / 2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    cam.data.clip_end = 30
    scene.camera = cam
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
