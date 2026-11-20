# Glucose vessel animation - #861

## Review revision - 19 November 2026

Particles are now **25% larger in radius/diameter**, with a requester-approved maximum of **180 particles**. The exported paths, cycle timing and 12-second loop are unchanged. The requester replaced speed-based comparison with **programmatic density control at fixed 1x playback**. This supersedes the earlier glucose-to-speed recommendation; the GitHub ticket has not been edited.

## Deliverables

- Integration asset: `data/anatomy/glucose-particles/glucose-particles.glb` after `bun run anatomy:fetch` (release `anatomy-effects-v1`), particles only, **1,749,892 bytes**. Load alongside the original atlas; do not load a second anatomy into the application.
- [Optional Three.js density adapter](../features/digital-twin/glucose-density-control.ts).
- This handoff.

The GLB is not committed. Like the atlases, `bun run anatomy:fetch` downloads it from the `anatomy-effects-v1` release of this repository into the gitignored `data/anatomy/glucose-particles/` and installs it only when its bytes match the pin in `packages/anatomy/effects.ts`. No API route or Digital Twin runtime integration is included here.

Integration GLB SHA-256:
`000834e73f4b008eb81a753a50d924ce52a8564b1cdec10bdb3911f90429d169`.

Supporting files remain local and are **not included in this commit**: the editable `glucose-vessels.blend`, self-contained `glucose-vessels-preview.glb`, current preview PNGs, route data, authoring/verification scripts, and detailed JSON validation reports. Obtain those separately from the asset author if future geometry edits or reproduction are needed. The review GLB contains duplicate vessels and skeleton and is not the production payload.

## Reference and scope

Authored from the supplied `initial.blend`, SHA-256:
`34ebe915562f79c5012553c24cf6b7f62f0dfc0162e109dd3351c83728b930ac`.
The original file was not modified.

The scene identifies its anatomy as the merged BodyParts3D systems. The repository's corresponding atlas pin is `bodyparts3d.ao.glb`, SHA-256 `a65116b5ac9e33f37794e0f364bbf1375e29af3212a458caace107a983274855`. The supplied Blender file is the authoritative geometric reference for this deliverable; this is not a fitted-ANNY asset.

**Standing-reference scope was explicitly approved by the requester.** There is no armature in the supplied scene. Walking/running deformation and fitted-atlas compatibility remain dependencies for #865; this asset must not be presented as already supporting them.

Routes were derived from cross-sections of actual connected vessel geometry, with interior and wall-clearance checks, not drawn across a body screenshot. Coverage includes torso, neck, arms and legs, with bends and branch regions. It is not a complete vascular network or a physiological branching/circulation model. Artist/integration-owner acceptance of the route coverage and appearance is still required.

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
| Blender frame      | +Z up, -Y front; original transforms preserved                        |
| Dependencies       | Core glTF 2.0; no required extensions, simulations, caches or scripts |

Set the action to repeat indefinitely at **1x**; glTF itself does not store a playback-loop flag. All track endpoints match. Individual particles smoothly shrink at route exits and reset only while zero-sized, avoiding visible return paths.

### Programmatic density in any renderer

The GLB contains a bounded pool of 180 independently addressable, animated mesh nodes. Each has standard glTF `extras`:

```json
{ "glucoseDensityRank": 0, "glucoseDensityCount": 180, "glucoseDensityVersion": 1 }
```

Ranks are unique from 0 through 179. Stable node names `GlucoseParticle_000` through `GlucoseParticle_179` provide a fallback for importers that discard extras. Preserve either the names or metadata through your import/optimization pipeline.

For density `d` in `[0, 1]`, compute `count = floor(d * 180 + 0.5)` and render only particle nodes with `rank < count`. Thus 0%, 25%, 50%, and 100% enable 0, 45, 90, and 180 particles. This is a fraction of the authored pool, not particles per physical volume. More than 180 requires authoring a larger pool, not increasing speed. The default unmodified GLB shows all 180.

Toggle the host renderer's **node/mesh visibility**, not the animated translation/scale, material opacity, action time or playback rate. Visibility is not keyed, so the animation cannot overwrite it. Hidden particles can continue their baked motion and reappear at the current phase without a restart. The ranks distribute particles across routes and around each route's cycle; 25% already covers all 21 routes. A few enabled particles may be temporarily zero-sized during their normal hidden reset.

GLB does not contain executable controller code or a universal density-slider property. Any host can implement this naming/metadata contract with its visibility API; a generic viewer without scripting will show the full pool. The included adapter is optional, not a runtime dependency embedded in the GLB.

Three.js example:

```ts
import { createGlucoseDensityController } from "@/features/digital-twin/glucose-density-control";

const gltf = await loader.loadAsync("glucose-particles.glb");
scene.add(gltf.scene);
const mixer = new THREE.AnimationMixer(gltf.scene);
const clip = gltf.animations.find((clip) => clip.name === "GlucoseFlow");
if (!clip) throw new Error("Missing GlucoseFlow animation.");
const action = mixer.clipAction(clip);
action.timeScale = 1;
action.play();
const particles = createGlucoseDensityController(gltf.scene);
particles.setDensity(0.5); // 90 enabled particles; clip time and speed unchanged.
// Later, without restarting playback:
particles.setDensity(0.25); // 45 enabled particles.
```

The adapter rejects non-finite/out-of-range density and missing/incomplete pools. For Babylon.js, Unity or another host, use the same ranks and its mesh-render visibility API; no specific engine extension is required.

No glucose-to-density clinical rule is prescribed here. #865 owns any eventual mapping, missing-data behavior, reduced motion and off-screen suspension. Historical timeline speed and heartbeat cadence must not multiply this clip's rate.

Explanation: **"Illustrative particles, not measured glucose particles or blood velocity."**

## Attachment and materials

The particle positions are baked in the original atlas frame. Put the companion root under the **same atlas-level fit/placement transform** as the original anatomy. Do not parent directly beneath a vessel mesh's local transform without compensating for that transform; that would apply placement twice.

No automatic body-fit, skin weights or pose deformation is included. When the atlas deforms, particles need the same deformation at their changing positions, or separately authored matching clips. Rigidly parenting this asset to a moving body is not enough.

The review GLB uses a cyan vessel material with `alphaMode: BLEND`, alpha 0.17, roughness 0.48 and restrained emission; skeleton alpha is 0.055. Particles use an opaque warm-gold emissive material. Preview materials are applied to independent copies; original anatomy geometry/materials remain intact in the Blender source.

The application has custom layer fading and depth prepasses. #865 must agree and demonstrate how this material treatment fits those passes and layer/depth selection. Visibility in the standalone viewer does not prove that integration. No organ rings, flashing, or heartbeat animation was added.

## Validation and remaining acceptance

- Both optimized GLBs: **Khronos glTF Validator 2.0.0-dev.3.10, zero errors and zero warnings**.
- Optimized enlarged particle export checked against its source vessels at **240 samples/second**: 474,924 visible samples, zero outside-vessel samples, minimum sampled particle-to-wall margin **0.177 mm**.
- Density tested at 101 settings in both exports; selected counts are exact and monotonic, all 21 routes are covered at 25%, and animation time/rate and visibility are preserved through mixer updates. Invalid inputs are rejected without changing the prior visibility.
- Comparison with the previous 120-particle GLB at 240 Hz found **zero position error** for the retained phase-zero trajectory on each of the 21 routes, zero radius error, and unchanged duration. Particles retain their 25% enlargement over the original v1 asset. Additional particles share those paths at staggered phases.
- Interior classification uses majority voting over three oblique rays to handle mesh-edge intersection degeneracies; 592 samples had disagreeing ray votes. This is a sampled geometric check, not a medical validation.
- The exported clip loads and runs with the stock Three.js `GLTFLoader` / `AnimationMixer`, without Blender.
- An exploratory desktop run on Apple M2 Max / macOS 26.6.2 reported about 60 fps for the three-panel viewer. A stricter follow-up requiring continuous clip advancement was interrupted when the embedded browser became hidden; this is **not a certified animated-performance result**.
- Moving-pose support, mobile/full-application 30 fps, final material treatment, and an agreed integration budget are **not signed off**. The particle-only budget is a proposal, not an agreement with the integration owner.

At full density, the review scene renders 1,034,355 triangles and approximately 182 mesh draw calls. Its anatomy cost is not the incremental integration cost: the production companion adds only the 180 particles.

## Review and future integration

The particle-only GLB can be opened in a glTF animation viewer, but it contains no anatomy. Load it beside the original BodyParts3D atlas with the same atlas-level transform for an alignment review. Use the density adapter example above for programmatic control.

The obsolete recordings, standalone HTML viewer and local preview server were removed during handoff cleanup. The supporting authoring files and detailed validation reports are local-only; the validation summary above records the checks performed on this export, not tooling delivered in this commit.

For later application integration, serve the fetched asset through a dedicated, versioned anatomy-effects route; load it separately from anatomy preprocessing; attach it to the atlas-level fit group; advance its mixer at fixed 1x speed; and connect density to application state. Respect anatomy visibility/depth, reduced motion and off-screen suspension, and dispose of the owned resources on cleanup. Keep unsupported atlas/fitted/moving-pose states explicit.

Reauthoring requires the original Blender source, route data and local authoring scripts. Editing guide curves alone does not automatically rebake actions. None of those authoring dependencies is required to play the GLB.

## Attribution

BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International: https://creativecommons.org/licenses/by/4.0/ (DBCLS's written confirmation of the 2025 relicence from CC BY-SA 2.1 JP is still pending; until then the worst case is share-alike under CC BY-SA 2.1 JP on this model file, never on this code; see NOTICE).

Derivative changes: measured illustrative particle routes and baked animation; independent preview materials and lighting. Retain the source attribution on redistributed anatomy and derivatives. See [the anatomy licence notes](anatomy.md).
