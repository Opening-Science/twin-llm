# PROVENANCE

## TwinLLM product

- Repository: https://github.com/Opening-Science/twin-llm
- License: Apache-2.0 for TwinLLM original work — see `LICENSE` and `NOTICE`

## open-twin pins

Synced (not vendored) at SHA:

- `a9e126c952c91e19e064a962dda7d815a43564e5`

See `docs/open-twin-pins.md` and `scripts/sync-open-twin.sh`. Checkout lives in gitignored `.open-twin/`.

| Package                              | Path                                          | Pin                                        |
| ------------------------------------ | --------------------------------------------- | ------------------------------------------ |
| `@open-twin/fhir-core`               | `.open-twin/packages/fhir-core`               | `a9e126c952c91e19e064a962dda7d815a43564e5` |
| `@open-twin/fhir-r4`                 | `.open-twin/packages/fhir-r4`                 | `a9e126c952c91e19e064a962dda7d815a43564e5` |
| `@open-twin/interpretation-contract` | `.open-twin/packages/interpretation-contract` | `a9e126c952c91e19e064a962dda7d815a43564e5` |
| `@open-twin/provider-oura`           | `.open-twin/packages/provider-oura`           | `a9e126c952c91e19e064a962dda7d815a43564e5` |
| `@open-twin/provider-google-health`  | `.open-twin/packages/provider-google-health`  | `a9e126c952c91e19e064a962dda7d815a43564e5` |
| `@open-twin/provider-whoop`          | `.open-twin/packages/provider-whoop`          | `a9e126c952c91e19e064a962dda7d815a43564e5` |
| `@open-twin/provider-vitronic`       | `.open-twin/packages/provider-vitronic`       | `a9e126c952c91e19e064a962dda7d815a43564e5` |
| `@open-twin/anchor-layer`            | `.open-twin/packages/anchor-layer`            | `a9e126c952c91e19e064a962dda7d815a43564e5` |

`@open-twin/anchor-layer` is used for its data only (`data/anchor-layer.v1.json`, sha256 `7adc42afaa03ee568a9f8eea5b451a8b51c9851e116f90951009d1b31894682e`, checked against its sidecar by `bun run sync:verify`). Upstream compiled it from the Anchor workbook `2026_07_28_OpenTwin_AnchorLayer_v3_Consolidated.xlsx` (source sha256 `42c027317bad0511ae3faed46f3ae49c2fb86f175fe8c58982d403c32d8f987e`). What TwinLLM adds on top is listed in `docs/biomarkers.md`.

### TwinLLM-only host adapters (contribute upstream when possible)

- `infrastructure/open-twin-adapters/oura.ts` — `HostOuraTokenHandler.lastTokens()` (renamed from `getTokens()` because upstream now has its own); `getAuthorizationUrl` via `.open-twin` src path
- `infrastructure/open-twin-adapters/whoop.ts` — `fetchWhoopWindow` / `buildWhoopFhirBundle` over the public barrel (`getWhoopData`, `buildWhoopBundleFromPayload`)
- `infrastructure/open-twin-adapters/google-health.ts` — restore/persist credential helpers
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
