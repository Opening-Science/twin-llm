# Reference anatomy layers

The Body twin viewer can slide from the BodyLoop scan into stacked reference anatomy: **Scan → Muscle → Skeleton → Organs**. The anatomy is a donor atlas fitted to the scan's height and hips. It is not the scanned person's anatomy, and the viewer says so next to the slider.

## Atlases

| Atlas       | File                 | Donor                           | Licence     | Bytes      | SHA-256                                                            |
| ----------- | -------------------- | ------------------------------- | ----------- | ---------- | ------------------------------------------------------------------ |
| BodyParts3D | `bodyparts3d.ao.glb` | TARO (adult male voxel phantom) | CC BY 4.0 ⚠ | 10,333,316 | `a65116b5ac9e33f37794e0f364bbf1375e29af3212a458caace107a983274855` |
| HuBMAP HRA  | `hra.ao.glb`         | Visible Human Female            | CC BY 4.0   | 15,388,344 | `37468cf1180b0367a698d40eefd962df0b12a53c1ce74a29d8b70a8af5dc0eb1` |
| HuBMAP HRA  | `hra-m.ao.glb`       | Visible Human Male              | CC BY 4.0   | 8,489,716  | `5d820f289a529ef6ee6d2a1158c867d33f25dceaf269eebbbcd46f85b602addc` |

- The files are open-twin-xr's built assets, served from `https://opentwin.opening.science/models/` (Last-Modified 18 Aug 2026). open-twin-xr merged the source meshes per system and layer, simplified them, compressed them with meshopt and baked ambient occlusion into `COLOR_0`. TwinLLM positions them; it does not change the bytes.
- ⚠ BodyParts3D: DBCLS relicensed it from CC BY-SA 2.1 JP to CC BY 4.0 on 2025-02-27. Written confirmation from DBCLS is still pending (open-twin-xr decision D2). Under either reading redistribution with attribution is allowed; the worst case is share-alike on the model file, never on this code.
- The HRA source release behind the HRA files is not recorded upstream.
- Credits are shown in the viewer whenever an atlas is loading or visible, with the licence link and a note on the changes. The pins live in `packages/anatomy/manifest.ts`.

## Atlas and body sex

- BodyParts3D (TARO) and HRA male have male donors; HRA female (`hra.ao.glb`, Visible Human Female) is the only female set. There is no female BodyParts3D.
- The atlas follows the body's sex where it is known. A Demo body's sex follows the stored sex (`subjects.sex`, #135) of the synthetic person whose labs it shows, unless a body is picked by hand; the person select shows that sex. A female body gets HRA female; a male body keeps a male atlas (BodyParts3D by default). A BodyLoop scan carries no sex, so its atlas is chosen in the picker (`features/digital-twin/anatomy/atlas-sex.ts`).
- An atlas picked by hand stays until the body changes. When the donor and the body differ, the Anatomy panel says so: "Male reference anatomy shown on a female body…", or, where HRA female is not installed, "Male reference anatomy shown: the female atlas is not available here." Nothing is shown silently.
- To add the female set on a machine without it: `bun run anatomy:fetch --atlas hra-f` (15,388,344 bytes, CC BY 4.0, pinned above). HRA female has almost no muscle and a partial skeleton (no skull, ribs, arms or hands), so the Muscle stop shows little on a female body.

## Install

```bash
bun run anatomy:fetch
```

The script downloads each file with a size cap, checks its pinned SHA-256 and only then writes it (`.partial`, then rename). A mismatch writes nothing. Files land in `ANATOMY_DATA_DIR` (default `data/anatomy/`, gitignored). With no flags it fetches every atlas, both demo bodies and both rigged demo bodies. `bun run anatomy:fetch --check` reports without downloading; `--atlas <id>` fetches one atlas (`bodyparts3d`, `hra-f`, `hra-m`), `--demo <id>` one demo body and `--rigged <id>` one rigged demo body (`anny-adult-m`, `anny-adult-f`); `--skip-rigged` leaves the rigged bodies out.

Without these files the Digital Twin page says "Reference anatomy is not available here." or "Could not load the demo body." and names no command; the API responses (`/api/anatomy/...`) still name `bun run anatomy:fetch`.

To bump a pin: download the new file, record its bytes and SHA-256 in `packages/anatomy/manifest.ts`, re-measure the frame facts below, and update this table.

## Routes

- `GET /api/anatomy/status`: `{ atlases: [{ id, installed }] }`, `no-store`. Installed means present at exactly the pinned size.
- `GET /api/anatomy/demo/:bodyId`: a demo body GLB, same caching, ETag and 404 rules as the atlas route.
- `GET /api/anatomy/atlas/:atlasId`: the GLB. With `?v=<first 16 hex of the SHA-256>` it is `public, max-age=31536000, immutable`; otherwise `public, max-age=0, must-revalidate`. ETag is the SHA-256; a matching `If-None-Match` returns 304. A missing or partial file is a JSON 404 that says how to install it. Unknown ids are 404 and never reach the file system.

Atlases are public CC BY files from a closed list, not personal data, so the routes need no audit row. They are not served from `public/`, which Next serves with `max-age=0`.

## Frames and fit

Measured on the pinned files (2026-10-13):

- Every atlas is +Y up, faces +Z (BodyParts3D first metatarsal z=+0.160 in front of the calcaneus z=+0.065; HRA eyes in front of the brain) and has +X on the subject's left (all "left …" structures at x>0; HRA liver and gallbladder at x<0). BodyParts3D stands with feet at y=0 and is 1.700 m tall; HRA is centred on the origin (1.658 m female, 1.824 m male).
- The BodyLoop scan is metres, +Z up, faces −Y, +X the subject's left, floor at z=0.
- `Rx(+90°)` maps the atlas frame onto the scan frame with no mirror (`packages/anatomy/fit.ts`).
- Fit: one uniform scale from height (the scan's measured `body.height` when present and within 0.85–1.02 of its box height, else the box, which includes hair), feet on the scan's floor, hips aligned horizontally. Scan hips are the midpoint of the `LeftUpLeg` and `RightUpLeg` joints of the scan's skeleton. Atlas hips: BodyParts3D midpoint of the left and right hip-bone centroids (x=0, z=0.0715); HRA pelvis node centre (female x=−0.009, z=−0.091; male x=0.005, z=−0.032). Without hip joints the fit centres the two bounding boxes instead (the atlas box takes its height from the whole atlas and its x/z from the parts that are kept, so the hidden placenta does not pull it forward), and the note under the slider changes to say so.
- Scan 28's upper arms hang about 15° from vertical; BodyParts3D's about 10°. Limb pose is not matched, and the copy says pose and organ positions are typical, not measured.

## Layers

| Depth | Scan  | Muscle | Skeleton           | Organs |
| ----- | ----- | ------ | ------------------ | ------ |
| 0     | solid | –      | –                  | –      |
| 1     | glass | solid  | solid (fills gaps) | –      |
| 2     | glass | glass  | solid              | –      |
| 3     | glass | –      | glass              | solid  |

- BodyParts3D nodes are classified by `extras.system` / `extras.layer` (bone and connective tissue count as skeleton). HRA nodes are classified by their organ-group key with a port of open-twin-xr's `hraGroups.ts` (MIT, `third_party/open-twin-xr/LICENSE`); the full-term placenta and the liver's duplicate Couinaud segments are hidden (HRA male spells one of them `left_superiomedial_segment`; it is hidden too).
- The atlas skin is dropped: the scan is the envelope.
- "Glass" is a Fresnel fade: faces turned towards the camera go nearly transparent, the silhouette stays. Atlas layers use alpha-hash dithering so nested layers keep correct depth; the scan uses real alpha blending.
- Per-layer toggles only hide; the slider alone decides solid versus glass. Organ-system chips filter the organ layer by system.
- `prefers-reduced-motion` makes depth changes instant.

## Highlight

- Each kept part remembers its HRA organ-group key (normalised, e.g. `liver`), the tagged node's name and its `ontologyid` extra. An HRA mesh whose structure is the `-` placeholder (renal calyces, vas deferens, urethra, hyoid) gets a group key from its own node name (`VH_F_minor_calyx_R_c` → `minorcalyx`, "Minor calyx"), so every kept mesh can be picked, listed and lit; `selectable-parts.test.ts` checks this on the installed atlases. BodyParts3D parts have no group key unless their system is unknown.
- A highlight is `{ kind: "groups", ids }` (HRA group keys) or `{ kind: "system", ids }`. `partsFor` in `packages/anatomy/highlight.ts` resolves it; a system lights every layer it has, muscle and bone included.
- BodyParts3D is one mesh per system, so it can only light whole systems; the picker says so. Switching atlas clears a highlight picked here, since group keys belong to one atlas; a Biomarkers row's highlight is lit again on the new atlas.
- The highlight tints the part's colour toward a calm blue (not a warning colour) with a small glow; the baked AO still shades it. A glow alone clipped to white on pale bone. It is a uniform change (no recompile), restored exactly on clear, and fades with its layer. It never reveals a hidden layer or system and never moves the depth. When a toggle hides every lit part, the picker says "Highlighted parts are hidden by a toggle."
- Group names in the picker come from the HRA keys themselves (`#VHFSmallIntestine` → "Small intestine"), not a hand table. Left and right are dropped as whole words, whatever their case, a two-word name that starts with the tissue reads organ first (`#VHMDuctsLiver` and `#VHFLiverDucts` are both "Liver ducts"), and groups with the same name are one option. Glands (thyroid, parathyroid, pituitary, adrenal) and marrow are not in either HRA atlas, so they cannot be picked.
- Rows of the body panel's Biomarkers tab drive the same highlight through `packages/biomarkers/marker-highlight.ts`: HRA lights the row's organ groups, BodyParts3D their systems (see `docs/biomarkers.md`). The highlight remembers which row set it, so the row stays pressed until another highlight replaces it, and an atlas switch lights the same row on the new atlas. The picker then shows that row as its own option ("From biomarker: Gamma-GT (GGT)", "From vital: Heart rate"), so a highlight spanning several groups does not read as None.

## Focus from chat

A `twin.body` view in the chat (`docs/chat-platform.md`, #48) starts the viewer
on a focus from `packages/anatomy/twin-focus.ts`: one of the nine systems or one
of heart, lung, brain, liver, kidney, pancreas and blood vessels. `focusHighlights`
gives what it lights per atlas kind (HRA the organ group or the whole system,
BodyParts3D the system), set like a Biomarkers-tab row ("From chat: Liver"), so an
atlas switch lights it again. `focusDepth` starts the depth at organs, at muscle
for the musculoskeletal system and at the scan for the skin; after that the
viewer is the person's. A tap on a part in the chat's viewers reports its group
and system, and `focusOfPick` turns that into the organ (or its system) the next
turn's UI context names.

## Environment

- **Enter environment** in the view toolbar opens the viewer full screen (Fullscreen API on the viewer container). Where the browser has no element full screen (iPhone Safari) or refuses, the same container covers the window as a fixed overlay and the page behind it stops scrolling. The same button reads **Exit environment** inside; Escape also exits, except inside a text field such as the panel search (in real full screen the browser handles Escape itself, text field or not). Focus returns to the button. Tab cycles inside the environment, also after a drag on the canvas, and the research-use line stays visible in the bar. Unmounting the viewer while open closes the environment.
- Nothing is remounted on the way in or out: the canvas, toolbar and rail stay the same elements and only change class. There is still one WebGL context, and the body panel keeps its tab and search.
- The world is a sky dome and a ground disc (24 m), both unlit shaders in `features/digital-twin/environment/`. The existing floor pool is the contact shadow. The fog is a fade inside those two shaders, not `scene.fog`, so the body, its layers and the depth slider look exactly as they do inline and no material recompiles. The world switches only colours and intensities, never the number of lights. The sky and ground skip tone mapping on purpose, so their hex colours show as written instead of shifting under ACES.
- Presets: **Studio** is a seamless floor that follows the site theme, with the inline viewer's lights. **Outdoors, abstract** adds a faint 1 m ground grid, and its sky and light follow the device's local time by default (re-read once a minute, never sent anywhere). With "Follow local time" off it stays at midday. The key light keeps its front-top direction at every hour, so the body stays readable at night. The bar says "An abstract space, not a real place."
- Anatomy and Details float over the canvas as collapsible panels: open on entry from 1024 px up, closed below.
- Every viewer panel folds under its title, inline and here: View controls (the toolbar), Scene, Anatomy, Details, the "What moves" box of live-vitals and motion lines, a scan's overlays and the page's Sources list. It is one shared component, `infrastructure/ui-kit/collapsible-panel.tsx`, styled by `.collapsible-panel` in `globals.css`; the title is a button with `aria-expanded`, so Tab, Enter and Space work. Each panel's choice is kept per viewer in this browser's localStorage (`twinllm.panel.*`; with storage blocked it holds for the page view only). Inside the environment Scene, Anatomy and Details still open by screen size on entry, as above.
- **Walking**: inline and here, while the pointer is over the 3D view or the view has focus (Tab to it), with no click first, W A S D or the arrow keys move the camera and the orbit target together along the ground at 1.4 m/s, so the view keeps its angle. The keys are heard on the window, so they do not depend on where focus was left. Keys typed into a field or a widget that uses them (the panel search, selects, the depth slider, tabs) never walk, nor do keys with Ctrl, Alt or ⌘; with the pointer elsewhere and focus outside the view the keys are the page's (`walkKeyApplies` in `walk.ts`). In the environment a right-drag or two-finger drag pans along the ground instead of the screen plane. The target stays within 8 m of the body; Reset view brings it back. Walking draws only while a key is held.
- **Picking**: a tap (under 6 px of travel and 500 ms, one finger) raycasts only the meshes that draw, nearest first. The first solid surface wins, so at the organ stop a click looks through the glass outline and skeleton to the organ behind; with only glass under the pointer it takes the nearest visible part, then the body outline. A drag, pan or pinch never picks. With the 3D view focused, Enter or Space picks what is in the middle of the canvas (the orbit target), so walking aims a keyboard pick. The choice uses the eased depth the frame loop draws with. Picking works inline too.
- A picked part lights through the same highlight as the picker: its HRA organ group, or its whole system on BodyParts3D, and the picker shows it as "Picked: Liver". A pick of the body outline or a tap on nothing clears a highlight that a pick set; a highlight from the picker or a Biomarkers row stays. After an HRA pick, BodyParts3D lights the part's whole system.
- **Info card**: beside the picked point on desktop (it follows the camera, flips left at the right edge), docked at the bottom below 640 px in the environment; inline it sits over the canvas beside the point. It shows the name, system, layer and the part's ontology id, says the part comes from a donor atlas, and lists the Anchor biomarkers whose Biomarkers-tab row would light this part (G2's rules read backwards). A marker there selects its row and opens Details. For an organ in the biomarker-to-organ map (`docs/biomarkers.md`) with a positioned value, one line names the marker furthest from its published range. On the HRA female atlas the liver links 10 markers; the heart and brain link none, since no Anchor region maps to them. The body outline's card points to the depth slider. Switching atlas, body or entering or leaving the environment closes the card, and so does hiding its part (a layer or system toggle, or the slider moved past its layer). Escape closes an open card before it closes the environment; × or Escape hands focus back to the 3D view. The card sits beside the 3D view, not inside its `role="application"`, so screen readers read it as text. In the lower half of the canvas it rises above the point, placed with its measured height, so it is never cut off at the bottom.
- Out of scope here: WPP processes on the card (G5), photo-real worlds (G6).

## Live vitals

- **Heartbeat:** the heart group (HRA) swells by up to 2% about its own centre with a short beat curve and a soft warm glow, at the measured heart rate. BodyParts3D has the heart inside one cardiovascular mesh, so the whole system glows, more softly (0.2 instead of 0.5), and does not swell; a line says so.
- **Breathing:** the HRA lungs swell by up to 2.5% with a slow cosine at the measured respiratory rate. BodyParts3D's respiratory mesh includes the nose and airways, so scaling it about the chest would move the nose; it glows softly instead (0.15), like the cardiovascular case, and a line says so. Without a rate there is no breathing.
- **HRV glow:** a steady soft blue glow on the brain (HRA) or the nervous system (BodyParts3D) when HRV is below this person's usual level (rule in `docs/biomarkers.md`).
- The glow is added on top of the highlight in `layer-material.ts` (emissive colour and intensity, no recompile) and both restore exactly in either order. Scaling sets the mesh's matrix by hand while it moves and restores its own transform after.
- Lines under the canvas (bottom left in the environment) say "Illustrative, not a physiological simulation." and which value drives what, that it is the last reading and how old it is, and from whom, only while something moves or glows. They sit beside the 3D view, not inside its `role="application"`. Below 640 px in the environment they stack above a bottom-docked pick card instead of overlapping it.
- **When:** on by default inside the environment; off in the inline viewer, where the toolbar's "Live vitals" toggle turns it on; always off with reduced motion. The toggle shows only when the subject has a rate or the HRV state. The heart and lungs are in the organ layer, so nothing moves before the organ stop.
- **Frames:** `frameloop="demand"` stays. While a moving part is drawn, a timer asks for about 30 fps (the auto-rotate pacing); off screen, in a hidden tab, or once nothing moving is drawn, it stops asking.

## Performance

- The atlas is fetched the first time someone moves past the scan, never on a plain page view. The meshopt decoder ships with three.js and is imported on demand.
- Triangles: BodyParts3D 2.61 M (2.51 M without skin, muscle alone 1.04 M), HRA female 4.03 M, HRA male 2.06 M. At most three atlas layers draw at once; faded layers are not drawn.
- The canvas renders on demand: with auto-rotate paused and nothing moving, no frames are drawn. Auto-rotate (on by default unless reduced motion is set) draws at about 30 fps and stops drawing while the canvas is off screen.
- The environment keeps `frameloop="demand"`: sky and ground draw only with the body, and the outdoor clock asks for one frame when its minute changes the look. The inline viewer does not read the clock at all.
- BodyLoop scan textures (8192² JPEG with a nearest-filter sampler) are downscaled to 4096² at load, or 2048² when the browser reports less than 8 GB of memory, and sampled linearly with mipmaps and up to 8× anisotropy. As RGBA8 that is 256 MiB per texture before (no mipmaps) and about 85 MiB after (21 MiB at 2048²). The resize runs before the scan joins the scene, so the 8K image is never uploaded.
- On an 8 GB MacBook Air the canvas lost its WebGL context once while two copies of the viewer were open. A likely contributor: the viewer probed WebGL availability with a new context on every render, and browsers drop the oldest context past their limit. The probe now runs once and releases its context. If a context is still lost, the viewer says "The 3D view stopped: the browser lost its graphics context." and offers a reload instead of going blank; a normal unmount no longer triggers that message.

## Demo bodies

The Body twin subject picker always offers **Demo (synthetic)** next to the BodyLoop subjects, with a male or female body. It works with no BodyLoop connection, no subjects and no scans, and it is what 3D and UX work is developed and screenshotted against. The viewer says "Synthetic demo body, not a person." and shows the ANNY credit whenever the demo is selected.

| Body         | File                                | Bytes   | SHA-256                                                            | Height  |
| ------------ | ----------------------------------- | ------- | ------------------------------------------------------------------ | ------- |
| ANNY adult m | `anny-adult-m.pose-bodyparts3d.glb` | 108,908 | `c1723196c2075a7cfb26e4ca6311119c098e031d88ba5c2ba05b5f40cfe9de2b` | 1.914 m |
| ANNY adult f | `anny-adult-f.pose-bodyparts3d.glb` | 110,004 | `72947c1fdcfc8df272f511989d587f04a2fd2d9a3a35d675a3e8bc0aaf75e190` | 1.772 m |

- Served from `https://opentwin.opening.science/models/` (Last-Modified 18 Aug 2026). open-twin-xr bakes ANNY (NAVER LABS Europe) to static geometry posed to match BodyParts3D; no scan of any person was used. Licence: Apache-2.0 (code) over CC0-1.0 (shape assets derived from MakeHuman); cite arXiv:2511.03589. The pins live in `packages/anatomy/demo-bodies.ts`.
- Measured on the pinned files (2026-10-15, decoded with three's meshopt decoder): one mesh, 13,718 vertices, 27,420 triangles, `POSITION` and `COLOR_0` only (no normals, no material, no skeleton), `EXT_meshopt_compression` and `KHR_mesh_quantization` required. Metres, +Y up, feet at y=0, faces +Z (nose at z=+0.137 m / +0.170 m, toes in front of heels). Left and right cannot be told apart from the geometry; the mesh is symmetric to within 7 mm, so a mirror would not show.
- The demo body is the envelope, like a scan: normals are computed at load, the material is made matte like a scan's, and it is wrapped in the same `Rx(+90°)` as the atlases to reach the scan frame. The glass fade and `fitAtlasToScan` then run unchanged. The fit always uses the bounding-box anchor (the static body has no skeleton, and the rigged body's ANNY joint names are not the scan's hip joints), and the note under the slider says the hips are not aligned.
- The atlas follows the demo body's sex (see "Atlas and body sex").

### Rigged demo bodies

```bash
bun run anatomy:fetch --rigged anny-adult-m   # the normal route: download from the release (plain bun run anatomy:fetch fetches both)
bun run anatomy:bake-rigged                   # fallback: bake locally (needs uv); --demo <id> for one, --check to report
```

The rigged bodies are assets of this repository's [`anatomy-rigged-v1`](https://github.com/Opening-Science/twin-llm/releases/tag/anatomy-rigged-v1) release. `anatomy:fetch` downloads them on every platform with no Python, follows GitHub's redirect only to `github.com`, `release-assets.githubusercontent.com` or `objects.githubusercontent.com` over https, and installs a file only when its bytes and SHA-256 match the pin in `packages/anatomy/rigged-bodies.ts`. `bun run setup:local` downloads them when one is missing and bakes them only when the download fails and uv is on PATH. Until they are installed, the motion clips are disabled and say "Run bun run anatomy:fetch."

- The release files are the output of the bake below on Linux x86_64 (2026-10-26). The bake reproduces them byte for byte there.
- Bake: needs [uv](https://docs.astral.sh/uv/). `scripts/anatomy/bake-anny-rigged.py` runs with `uv run --script` against `scripts/anatomy/bake-anny-rigged.py.lock` (anny 0.6.2 and every transitive dependency pinned; about 7 s per body once the environment is cached). torch 2.14.1 comes from the PyTorch CPU index on Linux and Windows (`2.14.1+cpu`, no CUDA libraries) and from PyPI on macOS, which has no CPU-index wheels; PyPI's only macOS wheel is Apple Silicon, macOS 14 or later. uv does not accept `required-environments` in a script's metadata, so `scripts/anatomy/bake-lock.test.ts` checks that the universal lock has a Python 3.12 wheel for every package on macOS arm64, Linux x86_64 and aarch64, and Windows x86_64. After changing the script's dependencies, run `uv lock --script scripts/anatomy/bake-anny-rigged.py`.
- The bake writes to a scratch file; `scripts/anatomy/bake-rigged.ts` installs it into `data/anatomy/` only when its bytes match the pin, and otherwise prints the SHA-256 it got and writes nothing.
- Same bytes across machines: rounding hides most float differences but not all. The pinned files hold 39 vertices with a position of `-0.0` and a few `-0.0` bone translations and quaternion parts: midline values whose sign is float noise and can come out `+0.0` on another CPU or BLAS, and a renormalised quaternion can differ in its last bit. Neither changes the body, but either changes the bytes, so a bake on macOS may not match the pin. When it does not, `bake-rigged` also compares a content digest (`scripts/anatomy/rigged-content-digest.ts`: positions, joints, weights, triangles and skeleton on their rounding grids as integers, so the sign of zero and the last bits drop out) with the pinned `contentSha256`, and says whether the body itself differs or only its encoding; either way it writes nothing and points to `anatomy:fetch`. A trial bake with those values made sign-free and every step after the rounding done in fixed-order IEEE arithmetic gave other bytes (`c730a8d4…` and `a7259702…`) with the same content digests as the pins, which is the evidence that the digest separates encoding from content. Making the bake itself platform-independent would change the pinned bytes and needs a new release.
- The static bodies are ANNY at gender 0 (male) or 1 (female), age 2/3 ("young"), every other phenotype 0.5: those reproduce their heights exactly (1.914 m, 1.772 m). The bake uses the same values and keeps ANNY's own 104-bone skeleton (`rig="anny"`) and skin weights (the four strongest per vertex). Bind pose: ANNY's rest pose with the upper arms lowered 30° (10° from vertical) and the forearms hanging 15° in front of the upper arm. The static files' exact pose could not be recovered (their vertex order differs from ANNY's), so the limbs differ a little; the fit uses the box either way.
- Plain glTF 2.0, no extensions: 13,718 vertices, 27,420 triangles, `POSITION`, `JOINTS_0`, `WEIGHTS_0` (normalised bytes summing to 255), one skin, no normals and no `COLOR_0` (so no baked shading). Atlas frame like the static bodies. Positions are rounded to 10 µm and joint transforms to 1e-6 before writing, so the bytes do not depend on the last bits of float maths.

| Body         | File                      | Bytes   | SHA-256                                                            |
| ------------ | ------------------------- | ------- | ------------------------------------------------------------------ |
| ANNY adult m | `anny-adult-m.rigged.glb` | 464,852 | `16d101090af7719069cd78d0a091d7d9c4975bc45df44201f23761ea89553589` |
| ANNY adult f | `anny-adult-f.rigged.glb` | 464,816 | `9032bfeb29ba4be8aeb0eb38a81e72c5dd5420a38005913d907c83c4f87fdbe1` |

Content digests (`contentSha256`): male `5231a8dbb70cb5ca679cfc963fba8407f829b6c8f73093f52b0c5a5b452f859c`, female `808a7ffa5afe7d900359c3fc6dd8b3e90a396d7e883ec58ab8e581b2a19f0b28`.

To publish a new set (a maintainer, after bumping the pins; the files must be the ones the pins name):

```bash
gh release create anatomy-rigged-v2 data/anatomy/anny-adult-m.rigged.glb data/anatomy/anny-adult-f.rigged.glb \
  --repo Opening-Science/twin-llm --title "Rigged ANNY demo bodies v2" \
  --notes "ANNY demo bodies with skeleton and skin weights for Walk, Idle and Dance, baked by scripts/anatomy/bake-anny-rigged.py (pins in packages/anatomy/rigged-bodies.ts). ANNY by NAVER LABS Europe / NAVER Corporation: Apache-2.0 code over CC0 shape assets derived from MakeHuman, arXiv:2511.03589. No scan of any person was used."
```

and set `RIGGED_RELEASE_TAG` to the new tag.

- `GET /api/anatomy/status` also lists `riggedBodies: [{ id, installed }]`; `GET /api/anatomy/rigged/:bodyId` serves them under the same caching rules as the demo route. The viewer waits for the status before loading a demo body, then loads the rigged one when installed and the static one otherwise, so it never loads twice. The credit then says the body was baked with its skeleton by this repository.

## Motion

- **Walk**, **Run**, **Idle** and **Dance loop** sit in the toolbar's Show group after Live vitals, and **Dance (video)** after them when a clip made from a video is installed on this machine (below). One clip plays at a time; pressing the playing one stops it. Each blends in and out over 0.4 s and starts at its beginning. While the dance loop plays a small Tempo select (90, 110 or 128 BPM) follows the buttons; a new tempo carries on from the beat reached.
- The computed clips are pure functions of time in `features/digital-twin/motion/gait.ts` and `motion/dance.ts`, with no motion-capture data. Walk: about 105 steps a minute, 1.3 m strides (both parameters), smooth curves shaped like textbook sagittal gait (hip 28° flexion at heel strike to 12° extension, knee up to 58° in swing, a short ankle push-off, arm swing opposite the leg, pelvis rotation and list, trunk counter-rotation). The ankle is shaped so the sole never points more than 35° below level (it dorsiflexes up to 20° in swing to hold that); without it the trailing foot pointed about 63° down at toe off. Idle: 12 breaths a minute in the chest and shoulders and a slow sway. The line beside the view says the walk is generic and not this person's gait.
- Run: about 170 steps a minute, toe off at 38% of the cycle, hip from 12° extension to 44° flexion late in swing, knee about 40° in loading and 100° in swing, a push-off of about 20°, the elbows bent about 90° with a wider arm swing, about 9° of forward lean from the hips and the head kept level. In the two flight phases (from one foot's toe off to the other's strike) the body rises up to 5 cm: a pose's `pelvisLift` lifts it after the lowest foot is put on the floor. Up to toe off the sole points at most 50° down; in mid swing, with the foot behind and off the ground, it reaches about 62°.
- Dance loop: a 40-count phrase of five 8-count moves, looping: step-touch with arm swing, side sway with alternating arm raise, hip roll, twist and point, bounce with claps. Default 110 BPM (clamped to 80–140). Each move is a smooth periodic function of the beat, with a nod of the upper spine on the beat, and moves crossfade over a beat either side of each boundary. The legs keep the feet planted: they lean against the hip sway and counter-turn the twist, and the leg on the lowered hip or with a pointed foot bends enough to stay off the floor. Tests check continuity across boundaries and the loop, per-joint limits, and that one foot is always flat and in place. The line beside the view says it is a computed loop, not motion capture and not this person's movement.
- Dance (video): a keyframe clip (`motion/keyframe-clip.ts`) made on this machine from a video by `python/motion/video_to_clip.py` (`docs/motion-from-video.md`). It is data, so it is checked against a zod schema before it plays: per frame and joint a quaternion relative to the parent in the body frame, and the hips' sideways offset over the feet. Between frames the player slerps; at the end it crossfades the last 0.5 s into the start, so the loop has no seam. It plays in place like the walk. When the clip has contact flags, a planted foot is laid flat and held where its footfall began with two-bone IK on the thigh and shin, blended over 0.1 s (`motion/foot-contact.ts`); with both feet planted the pelvis is placed so the higher foot touches the floor, and the IK bends the other leg up to it. The clip lives in gitignored `data/motion/video-dance.json`, because one made from someone else's footage carries that footage's rights; `GET /api/motion/status` says whether it is there and `GET /api/motion/clip/video-dance` serves it (404 when absent, a plain 500 when the file is not a valid clip), both uncached. The browser asks for the clip only when the status says it is installed. The line beside the view says it was traced from a video by pose estimation, is approximate and is not this person's movement.
- The joint vocabulary has a `head` joint (ANNY's and Mixamo's `head` bone); the computed clips keep it at rest except the run.
- `motion/rig-map.ts` maps the clips onto two rigs by joint name: ANNY's (`root`, `spine05`, `upperleg01.L`, `lowerleg01.L`, `foot.L`, `upperarm01.L`, `lowerarm01.L`, …) and the scans' Mixamo-style names (`Hips`, `Spine`, `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftArm`, `LeftForeArm`, …, any prefix). Required joints missing or ambiguous: no binding, the buttons are disabled and a line says why. The body frame is measured on the rig at rest (hips to shoulders, right hip to left hip), so bone axis conventions do not matter.
- Walking is in place: after posing, the pelvis moves along the body's up axis so the lowest ankle or toe stays at its rest height.
- Bones are set in the existing frame loop (`motion/body-motion.tsx`), not with an `AnimationMixer`, since the clips are functions rather than keyframes. Frames stay on demand: about 60 fps while the body moves (a run at 170 steps a minute had only ten frames a step at 30 fps), none off screen or in a hidden tab. Posing costs under 0.1 ms a frame on the rigged male demo body (run, cycle and sleep, measured in Bun, 2,000 frames each). Stopping, switching bodies or unmounting restores the bind pose.
- The atlas layers cannot follow the bones, so while a clip plays the depth eases to the scan (the slider keeps its value and comes back when motion stops), and a line says so. Live vitals' organs are hidden with them.
- With `prefers-reduced-motion` the clip buttons are disabled and a line says why.

### Motion from a wearable day

**Follow day**, under the inline view, makes the body follow one day of wearable data (#52). It is a visual cue, not a physiological simulation, and the first line beside the view says so. The mapping is pure and tested (`motion/day-motion.ts`):

- **Clip:** the day's longest workout picks it by sport: run (run, jog, treadmill), walk (walk, hike) or cycle (cycling, biking, spinning). Strength, swimming and any other sport have no clip, so the body stands at rest (Idle), as on a day without a workout; a line says which.
- **Rate:** the cadence sets the clip's speed, as steps a minute for walk and run and crank turns a minute for the cycle. The playback rate is that cadence over the clip's own (walk 105, run 170, cycle 80), and the line gives both. A recorded cadence (60 to 150 walking, 120 to 220 running, 30 to 140 cycling) is used as it is; no export in the app has one yet. Next, a recorded distance and duration (Oura and Whoop workouts) give the pace, and the pace a cadence by a rough straight-line fit to typical adult values, not the person's own: running 135 + 3 × km/h (165 at 10 km/h), clamped to 150 to 195; walking 47 + 13 × km/h (112 at 5 km/h), clamped to 80 to 135. Cycling cadence does not follow speed, so a ride keeps the generic rate. Synthetic workouts record only minutes, so for them alone a pace is assumed from the length, a shorter session being taken as a faster one: running 12 km/h at 20 minutes down to 9 km/h at 90, walking 5.5 to 4.5 km/h, cycling 90 to 80 turns a minute, clamped at both ends. A person's own workout never gets an assumed pace; without cadence or pace it plays at the generic rate and the line says so.
- **Night:** Day or Night beside the day select. Night lies the body on its back and breathes at the respiratory rate of the night that ended on that day's morning (Oura and the synthetic series date a night by the day it ends); a missing or implausible rate (outside 3 to 60 a minute) lies still. There is no lying clip, so the whole rig is turned at the pelvis (pitched back 90°, then turned 90° to lie across the view) with a resting pose, raised 3 cm so the hips, chest and head joints sit 9 to 13 cm above the floor (`motion/sleep-pose.ts`); the chest and shoulders rise with each breath.
- **Cycle clip:** `motion/cycle-pose.ts` pedals in place with no bike drawn: the ankles follow a 17 cm crank circle 18 cm in front of and 66 cm below the hips, the leg angles come from two-bone geometry on a 44 cm thigh and shin (knee about 107° at the top of the stroke, 30° at the bottom), the trunk leans about 40° with the hands forward, and the body is raised between strokes so the hips stay level.
- **Data:** the Demo reads its synthetic person's series through `GET /api/motion/days/:subjectRef` (synthetic display scope, one audit row `motion.days`): `workout-<sport>` minutes, the night's sleep (`93832-4`) and respiratory rate (`9279-1`), counted only on a day the series has a night, since Synthea's clinic vitals share the code. Self reads its own Oura and Whoop workouts (duration and distance) and the daily respiratory rate from the wearable summaries the Biomarkers tab reads, in the browser. Other subjects have no days. Only the 28 days ending on the newest day are listed, newest first. The development database holds no synthetic wearable series (`docs/warehouse.md`), so there the Demo says "This synthetic person has no synthetic wearable series in the warehouse."; the screenshots for #52 came from a throwaway database with the series ingested.
- Pressing a toolbar clip stops following; following again starts from the chosen day. The heartbeat and breathing of Live vitals are unchanged: they move the atlas organs, which hide while the body moves, as for every clip.

## Privacy

Atlases are downloaded once from the org's deployment; nothing about the user is sent. The scan, its fit and the layers never reach the chat prompt (see `docs/vitronic.md`).
