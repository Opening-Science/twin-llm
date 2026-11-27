# Glucose vessel particles - #861

## Asset

- `glucose-particles.glb`: particles only, **1,749,892 bytes**, SHA-256
  `000834e73f4b008eb81a753a50d924ce52a8564b1cdec10bdb3911f90429d169`, pinned in `packages/anatomy/effects.ts`. It contains no anatomy and is loaded beside the original atlas.
- [Optional Three.js density adapter](../features/digital-twin/glucose-density-control.ts).

Like the atlases, the GLB is never committed. `bun run anatomy:fetch` downloads it from the `anatomy-effects-v1` release into gitignored `data/anatomy/glucose-particles/` (or `$ANATOMY_DATA_DIR`) and installs it only when its bytes match the pin; provenance is in `PROVENANCE.md`. The editable Blender source, route data, authoring scripts and detailed validation reports are not in the repository; reauthoring needs them, playing the GLB does not.

## Reference and scope

Authored from a BodyParts3D Blender scene, SHA-256
`34ebe915562f79c5012553c24cf6b7f62f0dfc0162e109dd3351c83728b930ac`. The repository's matching atlas pin is `bodyparts3d.ao.glb`, SHA-256 `a65116b5ac9e33f37794e0f364bbf1375e29af3212a458caace107a983274855`. This is not a fitted-ANNY asset.

Standing pose only: the scene has no armature, so walking/running deformation and fitted-atlas compatibility remain dependencies for #865.

Routes were derived from cross-sections of connected vessel geometry, with interior and wall-clearance checks. They cover torso, neck, arms and legs, with bends and branch regions. This is not a complete vascular network or a physiological circulation model.

## Animation contract

| Property           | Value                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| Embedded clip      | `GlucoseFlow`                                                         |
| Duration           | Exactly 12 seconds, starting at time 0                                |
| Tracks             | 360 LINEAR translation/scale channels                                 |
| Particle count     | 180 nodes; one shared mesh and material                               |
| Geometry           | 80 triangles per particle; 14,400 rendered particle triangles         |
| Authoring sampling | 60 Hz, then redundant-key reduction at 0.000001 tolerance             |
| Units              | Metres                                                                |
| Export frame       | glTF +Y up, +Z front, +X subject's left; original atlas origin        |
| Dependencies       | Core glTF 2.0; no required extensions, simulations, caches or scripts |

Repeat the action indefinitely at **1x**; glTF does not store a loop flag. All track endpoints match. Particles shrink at route exits and reset only while zero-sized, so no return path is visible.

### Density

Each of the 180 animated mesh nodes carries glTF `extras`:

```json
{ "glucoseDensityRank": 0, "glucoseDensityCount": 180, "glucoseDensityVersion": 1 }
```

Ranks are unique from 0 to 179. Node names `GlucoseParticle_000` to `GlucoseParticle_179` are the fallback for importers that drop extras; keep either through any optimisation step.

For density `d` in `[0, 1]`, show only nodes with `rank < floor(d * 180 + 0.5)`: 0%, 25%, 50% and 100% give 0, 45, 90 and 180 particles. This is a fraction of the authored pool, not particles per volume. Toggle node visibility only, never the animated transforms, opacity, clip time or playback rate. Visibility is not keyed, so hidden particles keep moving and reappear in phase. At 25% all 21 routes are already covered.

In **Your Day** replay, the current reading from the selected blood or sensor glucose series controls density: `clamp(glucose in mg/dL / 300, 0, 1)`. This is a fixed visual scale, not a clinical threshold. If the replay cursor has no current reading, the effect is hidden; it does not switch specimens to fill gaps. The clip runs at 1x during playback and stops while paused or with reduced motion. Heart rate and timeline speed do not change the clip's rate. This mapping does not change the manual density control in Your Twin.

The full-body replay draws larger gold markers over the anatomy so they remain visible at overview scale. The overlay changes display size and occlusion only, not the authored vessel paths, timing, or particle count. Your Twin retains the authored appearance.

Explanation shown to users: **"Illustrative particles, not measured glucose particles or blood velocity."**

### Attachment

Positions are baked in the original atlas frame. Put the root under the same atlas-level fit/placement transform as the anatomy, as a sibling, not under a vessel mesh. There are no skin weights; rigidly parenting the asset to a moving body is not enough.

Particles use an opaque warm-gold emissive material.

## Checks

- Khronos glTF Validator 2.0.0-dev.3.10: zero errors and zero warnings.
- Wall clearance at the pinned particle size, sampled at 240 Hz: 474,924 visible samples, zero outside a vessel, minimum particle-to-wall margin **0.177 mm**. Interior tests use a majority vote over three oblique rays; this is a sampled geometric check, not a medical validation.
- Density at all 101 settings: exact, monotonic counts; all 21 routes covered at 25%; clip time, rate and visibility kept through mixer updates; invalid input rejected without changing visibility.
- The clip loads and plays with the stock Three.js `GLTFLoader` and `AnimationMixer`.

## Attribution

Your Day links to these credits below the replay rather than displaying them inside the viewer.

BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution 4.0 International: https://creativecommons.org/licenses/by/4.0/

Derivative changes: measured illustrative particle routes and baked animation, particle mesh and material. Retain the source attribution on redistributed anatomy and derivatives. The repository records a pending upstream licence-confirmation caveat about the former CC BY-SA 2.1 JP licence; this asset does not resolve it. See [the anatomy licence notes](anatomy.md).
