# BodyLoop endpoints used by TwinLLM

TwinLLM talks to a VITRONIC BodyLoop scanner through a small, fixed set of HTTP
endpoints. This page lists only those, with what we send and what we read back. It is
not a copy of the vendor's API description; ask VUSE XR for that.

All paths sit under `/api/v2` on the scanner's base URL and go over HTTPS with the
scanner's certificate pinned (see `docs/vitronic.md`). Any path not listed here is
refused in code before a request is made.

## Read by the app

The app sends the user's own API token as a Bearer token and only ever uses `GET`. The
allowed paths are in `packages/vitronic/paths.ts`; the calls are in
`packages/vitronic/client.ts`.

| Method | Path                                  | What we read                                                                                                                                                    |
| ------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v2/system/tls/certificate`      | The scanner certificate, to record its SHA-256 fingerprint on first connect.                                                                                    |
| GET    | `/api/v2/viatars/`                    | The list of scans. We keep rows whose `proband_id` equals the connected subject's proband id and read each row's `viatar_id` and preset name.                   |
| GET    | `/api/v2/viatars/{id}`                | One scan: `viatar_id`, `proband_id` and its preset name. The `targets` map is read only by the cycle CLI (below).                                               |
| GET    | `/api/v2/viatars/{id}/heights/`       | Height measurements. Values arrive in metres.                                                                                                                   |
| GET    | `/api/v2/viatars/{id}/distances/`     | Distance measurements, in metres.                                                                                                                               |
| GET    | `/api/v2/viatars/{id}/crosssections/` | Circumferences, in metres.                                                                                                                                      |
| GET    | `/api/v2/viatars/{id}/angles/`        | Angles, in radians.                                                                                                                                             |
| GET    | `/api/v2/viatars/{id}/axes/`          | Body axes, for the viewer.                                                                                                                                      |
| GET    | `/api/v2/viatars/{id}/markers/`       | Marker positions, for the viewer only. Never sent to a model.                                                                                                   |
| GET    | `/api/v2/viatars/{id}/properties/`    | Whole-body properties such as volume, mass and BMI.                                                                                                             |
| GET    | `/api/v2/viatars/{id}/models`         | The names of the 3D files available for the scan. Version 0.13.7 returns a flat name map; a map grouped by `photogrammetry` / `dataprocessor` is also accepted. |
| GET    | `/api/v2/viatars/{id}/models/{name}`  | The mesh as binary glTF. We ask for `avatar_3d.glb`, `mesh_3d.glb` or `view.glb`, in that order of preference, and store it on disk with its SHA-256.           |

A `404` on a measurement collection or a model counts as "not available" rather
than as an error. The app never calls any `/api/v2/probands` path.

## Called by the host-only CLIs

These run only from `scripts/vitronic/` on the operator's machine, never from the app.
Writes are limited to the paths in `packages/vitronic/write-paths.ts`, which the app
must not import. Credentials come from `BODYLOOP_*` variables in `.env.local`.

| Method | Path                                                  | Script                      | What we send / read                                                                                                                                |
| ------ | ----------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v2/authentification/token`                      | `mint-token.ts`, `cycle.ts` | Form-encoded password login (`grant_type=password`, `scope=admin`). We read `access_token` and keep it in memory for the run only.                 |
| POST   | `/api/v2/authentification/users/{username}/api_token` | `mint-token.ts`             | `{ expires_in, apitoken_name }`. We read the new API token, which `vitronic:connect` then stores encrypted.                                        |
| POST   | `/api/v2/probands/`                                   | `cycle.ts`                  | `{ key_external }` with a pseudonym, nothing else. We read and print `proband_id` only.                                                            |
| POST   | `/api/v2/viatars/`                                    | `cycle.ts`                  | `{ proband_id, parameters }` with the default scan parameters in `DEFAULT_VIATAR_PARAMETERS`. We read `viatar_id`.                                 |
| POST   | `/api/v2/viatars/{id}/targets/`                       | `cycle.ts`                  | `{ target_kind: "analyzed_avatar_3d" }` to start processing after the operator confirms.                                                           |
| GET    | `/api/v2/viatars/{id}`                                | `cycle.ts`                  | Polled every 5 s. We read `targets.analyzed_avatar_3d.state` (and progress when present): `Ready` ends the run, `Failed` or `Aborted` is an error. |

Write calls are logged as method and path only, never with their bodies.

## Pushed to TwinLLM

The scanner's cloud_connect export is meant to push scan archives to TwinLLM's own
`POST /api/vitronic/upload/[connectionId]`, checked against the stored shared secret.
That is an endpoint TwinLLM serves, not one it calls, and it does not ingest anything
yet; `docs/vitronic.md` describes it.
