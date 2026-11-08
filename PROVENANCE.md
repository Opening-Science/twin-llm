# PROVENANCE

## TwinLLM product

- Repository: https://github.com/Opening-Science/twin-llm
- License: Apache-2.0 for TwinLLM original work — see `LICENSE` and `NOTICE`

## Interaction patterns

The ui-kit's `StepTrace`, `UndoButton`, `HoldToConfirm`, `StatusLattice` and `Rating` were written from scratch in this repository. No third-party UI component code is included.

## open-twin pins

Synced (not vendored) at SHA:

- `c37d8004d93d5accb9b91bebcbd89376837776bd`

See `docs/open-twin-pins.md` and `scripts/sync-open-twin.sh`. Checkout lives in gitignored `.open-twin/`.

| Package                              | Path                                          | Pin                                        |
| ------------------------------------ | --------------------------------------------- | ------------------------------------------ |
| `@open-twin/fhir-core`               | `.open-twin/packages/fhir-core`               | `c37d8004d93d5accb9b91bebcbd89376837776bd` |
| `@open-twin/fhir-r4`                 | `.open-twin/packages/fhir-r4`                 | `c37d8004d93d5accb9b91bebcbd89376837776bd` |
| `@open-twin/aggregate`               | `.open-twin/packages/aggregate`               | `c37d8004d93d5accb9b91bebcbd89376837776bd` |
| `@open-twin/interpretation-contract` | `.open-twin/packages/interpretation-contract` | `c37d8004d93d5accb9b91bebcbd89376837776bd` |
| `@open-twin/provider-oura`           | `.open-twin/packages/provider-oura`           | `c37d8004d93d5accb9b91bebcbd89376837776bd` |
| `@open-twin/provider-google-health`  | `.open-twin/packages/provider-google-health`  | `c37d8004d93d5accb9b91bebcbd89376837776bd` |
| `@open-twin/provider-whoop`          | `.open-twin/packages/provider-whoop`          | `c37d8004d93d5accb9b91bebcbd89376837776bd` |
| `@open-twin/provider-vitronic`       | `.open-twin/packages/provider-vitronic`       | `c37d8004d93d5accb9b91bebcbd89376837776bd` |
| `@open-twin/anchor-layer`            | `.open-twin/packages/anchor-layer`            | `c37d8004d93d5accb9b91bebcbd89376837776bd` |

`@open-twin/anchor-layer` is used for its data only (`data/anchor-layer.v1.json`, sha256 `7adc42afaa03ee568a9f8eea5b451a8b51c9851e116f90951009d1b31894682e`, checked against its sidecar by `bun run sync:verify`). Upstream compiled it from the Anchor workbook `2026_07_28_OpenTwin_AnchorLayer_v3_Consolidated.xlsx` (source sha256 `42c027317bad0511ae3faed46f3ae49c2fb86f175fe8c58982d403c32d8f987e`). What TwinLLM adds on top is listed in `docs/biomarkers.md`.

### TwinLLM-only host adapters (contribute upstream when possible)

- `infrastructure/open-twin-adapters/oura.ts` — `HostOuraTokenHandler.lastTokens()` (renamed from `getTokens()` because upstream now has its own); `getAuthorizationUrl` via `.open-twin` src path
- `infrastructure/open-twin-adapters/whoop.ts` — `fetchWhoopWindow` / `buildWhoopFhirBundle` over the public barrel (`getWhoopData`, `buildWhoopBundleFromPayload`)
- `infrastructure/open-twin-adapters/google-health.ts` — restore/persist credential helpers
- `infrastructure/open-twin-adapters/aggregate.ts` — `aggregateWearableBundles` over `aggregate` from the public barrel; not read by any screen yet
- Sync packaging only (no upstream `*.ts` edits): `workspace:*` → `file:../fhir-core`, then peer-pin for host install; flatten nested bun redirects
- Upgrade: `bash scripts/sync-open-twin.sh <sha>` then `bun install` (see `docs/open-twin-pins.md`)

## Reference anatomy atlases (fetched, not committed)

Downloaded by `bun run anatomy:fetch` from `https://opentwin.opening.science/models/` into gitignored `data/anatomy/`; every byte is checked against the pin in `packages/anatomy/manifest.ts`. The build commit behind these files is not published upstream, and the HRA source release is not recorded upstream.

| Atlas               | File                 | Bytes      | SHA-256                                                            | ETag                  | Last-Modified |
| ------------------- | -------------------- | ---------- | ------------------------------------------------------------------ | --------------------- | ------------- |
| BodyParts3D         | `bodyparts3d.ao.glb` | 10,333,316 | `a65116b5ac9e33f37794e0f364bbf1375e29af3212a458caace107a983274855` | `"dkscw4cycge865h8k"` | 2026-08-18    |
| HuBMAP HRA (female) | `hra.ao.glb`         | 15,388,344 | `37468cf1180b0367a698d40eefd962df0b12a53c1ce74a29d8b70a8af5dc0eb1` | `"dksd31cn5gxs95tq0"` | 2026-08-18    |
| HuBMAP HRA (male)   | `hra-m.ao.glb`       | 8,489,716  | `5d820f289a529ef6ee6d2a1158c867d33f25dceaf269eebbbcd46f85b602addc` | `"dksd31t6ixvk51ypg"` | 2026-08-18    |

## Synthetic demo bodies (fetched, not committed)

Downloaded by `bun run anatomy:fetch` from `https://opentwin.opening.science/models/` into gitignored `data/anatomy/`; every byte is checked against the pin in `packages/anatomy/demo-bodies.ts`. ANNY (NAVER LABS Europe / NAVER Corporation, arXiv:2511.03589), baked by open-twin-xr `scripts/anny/bake.py` and posed to BodyParts3D; Apache-2.0 code over CC0-1.0 shape assets; no scan of any person. The build commit behind these files is not published upstream.

| Body                | File                                | Bytes   | SHA-256                                                            | ETag                 | Last-Modified |
| ------------------- | ----------------------------------- | ------- | ------------------------------------------------------------------ | -------------------- | ------------- |
| ANNY adult (male)   | `anny-adult-m.pose-bodyparts3d.glb` | 108,908 | `c1723196c2075a7cfb26e4ca6311119c098e031d88ba5c2ba05b5f40cfe9de2b` | `"dkscw4cycge82c18"` | 2026-08-18    |
| ANNY adult (female) | `anny-adult-f.pose-bodyparts3d.glb` | 110,004 | `72947c1fdcfc8df272f511989d587f04a2fd2d9a3a35d675a3e8bc0aaf75e190` | `"dkscw4cycge82cvo"` | 2026-08-18    |

## Rigged demo bodies (release download or local bake, not committed)

Downloaded by `bun run anatomy:fetch` from the [`anatomy-rigged-v1`](https://github.com/Opening-Science/twin-llm/releases/tag/anatomy-rigged-v1) release of this repository, whose two assets are this repository's own bake (Linux x86_64) and match the pins byte for byte. Or baked by `bun run anatomy:bake-rigged` with `scripts/anatomy/bake-anny-rigged.py` from the `anny` 0.6.2 Python package (NAVER LABS Europe / NAVER Corporation, Apache-2.0 code over CC0-1.0 MakeHuman-derived assets; the package ships its assets) and torch 2.14.1 (the CPU build on Linux and Windows, PyPI's on macOS), both pinned with every other dependency in `scripts/anatomy/bake-anny-rigged.py.lock`. Same phenotypes as the static demo bodies, ANNY's own 104-bone skeleton and skin weights. A download or a bake is installed into gitignored `data/anatomy/` only when its bytes match the pin in `packages/anatomy/rigged-bodies.ts`. No motion-capture data ships with the app: the walk, run, idle and dance-loop clips are computed (`features/digital-twin/motion/gait.ts`, `motion/dance.ts`). A clip made from a video (below) stays on the machine that made it.

| Body                | File                      | Bytes   | SHA-256                                                            |
| ------------------- | ------------------------- | ------- | ------------------------------------------------------------------ |
| ANNY adult (male)   | `anny-adult-m.rigged.glb` | 464,852 | `16d101090af7719069cd78d0a091d7d9c4975bc45df44201f23761ea89553589` |
| ANNY adult (female) | `anny-adult-f.rigged.glb` | 464,816 | `9032bfeb29ba4be8aeb0eb38a81e72c5dd5420a38005913d907c83c4f87fdbe1` |

## Motion from video (local tool, nothing committed)

`python/motion/` turns a video into a keyframe clip on the user's own machine (`docs/motion-from-video.md`). It runs the MediaPipe Pose Landmarker heavy model (Google, Apache-2.0), downloaded once by `python/motion/fetch_model.py` from `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task` into gitignored `data/motion/models/` and checked against SHA-256 `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b` (30,664,242 bytes). The model, any video, its frames and any clip made from it are not part of this repository; clips go to gitignored `data/motion/`. The committed test fixtures (`python/motion/fixtures/`, `features/digital-twin/motion/fixtures/`) are synthetic, made by `python/motion/synthetic.py` from chosen joint angles.

## open-twin-xr port

- `packages/anatomy/hra-groups.ts` ← `src/scene/anatomy/hraGroups.ts` @ `7334c0bb0664e1f293f88971788520d64734466c` (MIT; `third_party/open-twin-xr/LICENSE`).

## Open Science Foundation logo (committed, not Apache-2.0)

Copied unchanged from [Opening-Science/Open-Science-Foundation-brand-guide](https://github.com/Opening-Science/Open-Science-Foundation-brand-guide) `assets/logo/` @ `0395ce4e33a175b118f3faa9bad7d0769c2ec689`. The hashes match that repository's `assets/logo/manifest.json`, and `features/shell/brand-attribution.test.ts` checks them. Licence: `LICENSES/LicenseRef-OSF-Brand-Assets.txt` (the foundation's Brand Assets Permission), with a `.license` file beside each asset. Scope and provenance upstream: `assets/logo/PROVENANCE.md`.

| File                                                              | SHA-256                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `public/brand/Open-Science-Foundation_logo_positive_original.svg` | `6a2813ca6de4b2c10f99948a1c1124cbc2a0c2a51c457d62cecdb1d5e86d5f8a` |
| `public/brand/Open-Science-Foundation_logo_negative_original.svg` | `a4effe8c61e077fa7881ed6e87412b2de1cc2ca11db8cbf00096727c48db4f2a` |

## Vendor logos (committed, trademarks, not Apache-2.0)

Copied unchanged from each company's brand assets for developers, checked against their brand guidelines on 8 Nov 2026 (the guideline documents are not committed). They identify a service a user has connected and nothing else. Licence note: `LICENSES/LicenseRef-Vendor-Trademarks.txt`, with a `.license` file beside each file; `infrastructure/charts/kit/vendor-logos.test.ts` checks the hashes.

- WHOOP: the outline circle ("Puck") in black for light backgrounds and white for dark ones, at 30px or more with clear space, always after an attribution word ("Data by"). Not recoloured, not placed on WHOOP's own charts.
- Google Health: the colour heart, which works on both themes, undistorted. Fitbit's name and logo are not used.
- Oura: no file. Oura's only official mark is the ŌURA wordmark, whose files sit behind Oura's brand portal; until then Oura is shown by its name in text.

| File                                                         | Source file                   | SHA-256                                                            |
| ------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------ |
| `public/brand/vendors/whoop/whoop-circle-black.svg`          | `WHOOP Circle Black.svg`      | `74cc38d55e786eaeacfdf6f6cc151c12ae560aa2b67d38872178e6bb032f3cda` |
| `public/brand/vendors/whoop/whoop-circle-white.svg`          | `WHOOP Circle White.svg`      | `393a9a82e69ea2d45a2a1894cd4c890119ef19cf514beb7a96048eaa49140007` |
| `public/brand/vendors/google-health/google-health-heart.png` | `Google_Health_Heart_RGB.png` | `6c37cb48899a1359df640db130b77215feb78aae52d6bf647ef5451f88269d6f` |

## Natural Earth boundaries (committed, public domain)

`public/geo/natural-earth/` and `infrastructure/charts/choropleth/location-index.json` are built by `scripts/geo/build-natural-earth.ts` from Natural Earth 5.1.1 (`ne_50m_admin_0_countries.zip`, SHA-256 `5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139`; `ne_10m_admin_1_states_provinces.zip`, SHA-256 `efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05`), simplified as `public/geo/natural-earth/README.md` describes. No code from another map library is used; the projection (Equal Earth) and the SVG paths are our own (`infrastructure/charts/choropleth/`).

## geoBoundaries boundaries (committed, CC BY 4.0)

`public/geo/geoboundaries/admin1/KEN.json` and Kenya's states in `infrastructure/charts/choropleth/location-index.json` are built by `scripts/geo/build-geoboundaries.ts` (#422) from geoBoundaries `geoBoundaries-KEN-ADM1.geojson` (gbOpen, boundary `KEN-ADM1-32016919`; repository `wmgeolab/geoBoundaries` at commit `8ce2700661a28ee944350e2b329bbabb58d2ff83`; SHA-256 `a3e073594494eb740e42fadec63acda982f6a745bb64ee4aa152453ccc46f94e`), simplified like the Natural Earth states as `public/geo/geoboundaries/README.md` describes. geoBoundaries is CC BY 4.0 (its source, the RCMRD GeoPortal counties, is public domain); the credit is in `NOTICE` and under every map drawn from the file.
