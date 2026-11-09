"""Shared helpers for the headless Blender scripts in scripts/blender/.

`geometry` and `atlas_rig` are plain numpy and never import bpy; `blender_env`
and `render` need Blender 5.2.x. Run through `bun run blender:<task>`.
"""
