# Vitronic BodyLoop

Host connector for BodyLoop scan measurements and a hashed `.glb` avatar. TwinLLM
owns HTTP. `@open-twin/provider-vitronic` owns FHIR mapping
(`buildBundleFromVitronicResponse`), but the host **does not persist** that
bundle. `properties` and height/distance/circumference/angle **lists** are SI
(m, m2, m3, kg, kg/m2, rad) as received from the BodyLoop 0.13.7 API. The
BodyLoop UI shows cm/deg; TwinLLM stores the API payloads and converts only for
display and chat. `VitronicSnapshot.fhirBundle` stays null in this change. The
password-grant client (`createBodyLoopClient`) is never called.

This is a research connector. It is not a clinic workflow and does not request
Proband demographics. Viatars are selected by integer `proband_id` on a consented
`VitronicSubject` (label is operator-chosen free text — not a name). Exactly one
subject is `isSelf` per actor. Existing scanner connections migrate into
`{ label: "Self", isSelf: true }` using the stored scan key. `key_external` is
not queryable.

## File ingest first

`POST /api/vitronic/subjects/:id/files` accepts a `.glb` alone or with
measurements JSON (optional `glbBase64`) under 100 MiB, same mapper and
`data/vitronic/<userId>/<sha256>.glb` path. Live sync is `POST /api/vitronic/subjects/:id/sync` with `{ viatarId }`, or
empty `POST /api/vitronic/sync` for the isSelf subject's newest matching scan.
The host GET `/api/v2/viatars/` always filters on that subject's listed
`probandId` and never calls `/probands`. GET `/models` picks `avatar_3d.glb` then
`mesh_3d.glb` then `view.glb` (`.glb` only; log the chosen name). Sync also GETs
allowlisted `markers/`, `heights/`, `distances/`, `crosssections/`, and `angles/`.

## Auth

Per-user API token stored AES-256-GCM (`VITRONIC_TOKEN_ENCRYPTION_KEY`, 64 hex
characters), sealed again with the vault key in personal mode (#341). Minting happens off-app (`bun scripts/vitronic/mint-token.ts`).
The BodyLoop password is never stored by the app. Host sends
`Authorization: Bearer` on GET only. There is no resource-owner password grant
in the app and no call to `/api/v2/authentification/token` from host trees.

`POST /api/vitronic/connect` stores `baseUrl`, token, integer scan key, optional
`apiTokenName`, and a SHA-256 TLS certificate fingerprint (TOFU on first
connect via `GET /api/v2/system/tls/certificate`). That first contact sends no
`Authorization` header; the token only goes out once the certificate is pinned.

Every later request is pinned in two steps (`packages/vitronic/tls.ts`): a bare
TLS handshake reads the scanner certificate and compares its SHA-256 with the
pin before any request bytes are written, then the request itself runs with that
exact certificate as its only trusted CA and the fingerprint is checked again.
A different certificate fails before headers are sent (`TlsPinMismatchError`);
there is no unpinned fallback.

The base URL is reduced to a bare origin before it is stored or dialled
(`packages/vitronic/base-url.ts`):

- `https` only; no credentials, path, query or fragment.
- Port 443, or an explicit port from 1024 to 65535.
- LAN and other private addresses are allowed. Loopback, link-local,
  unspecified, multicast and broadcast addresses are refused.
- Optional `VITRONIC_SCANNER_HOSTS` (comma separated): when set, only the listed
  hosts are accepted, and a loopback or link-local host is accepted only if it is
  listed.
  The connectors BodyLoop card already has a configure form: **Connectors →
  BodyLoop → scanner URL, API token, integer scan key, upload secret → Save
  connection → Sync scan**. `scripts/vitronic/connect.ts` is the host-only CLI
  equivalent (TOFU pin + upsert). Digital Twin is two sections: Genome twin and
  Body twin, each with its own empty state.

cloud_connect push auth (username/password) is not shipped yet (VUSE XR 29 Sep).
`POST /api/vitronic/upload/[connectionId]` still returns 501 after secret/size checks.

## Units

Properties (from a real scanner export, 29 Sep 2026) are SI. TwinLLM stores the
numbers as received and never converts or recomputes BMI.

| Summary key                      | Stored unit |
| -------------------------------- | ----------- |
| `vitronic.property.body.height`  | m           |
| `vitronic.property.body.surface` | m2          |
| `vitronic.property.body.volume`  | m3          |
| `vitronic.property.body.mass`    | kg          |
| `vitronic.property.body.bmi`     | kg/m2       |
| `vitronic.height.*`              | m           |
| `vitronic.distance.*`            | m           |
| `vitronic.circumference.*`       | m           |
| `vitronic.angle.*`               | rad         |

List units were verified against **stored API payloads**, not the BodyLoop UI:
every stored height/distance/crosssection/angle value, including all 30 angles,
sat in metre/radian scale (at most ~3.2). Ingest copies numbers and does not
multiply. OpenAPI 0.13.7 (`Height.height` and peers) has no unit field. The
BodyLoop UI labels the same numbers cm/deg; that is presentation, not storage.
Chat and the body-twin lists convert m→cm (×100) and rad→deg (×180/π) in
`packages/vitronic/present-measure.ts` so the model and the screen agree.
Properties are not converted.

Every summary key carries a `unit` string. Chat gets **numeric** keys only
(`vitronic.property.*` and `vitronic.<kind>.<path>` with a unit). The chat
narrative is a fixed sentence; stored snapshot copy does not enter the prompt.
Marker positions, measure positions, contours, and the mesh never enter the
prompt.

### Chat review checklist

- Confirm the chat prompt receives only numeric vitronic.* keys with units and a fixed narrative — no stored snapshot narrative, positions, contours, markers or mesh.
- Model receives numeric summary keys with units only.
- Never positions, contours, vertices, or glb bytes.
- Geometry lives on `VitronicSnapshot.markers` / `measures` and in the viewer.

## API reference

The integration was written against BodyLoop API 0.13.7, whose OpenAPI document VUSE
XR supplied on 29 Sep 2026. That document is not in this repository; ask VUSE XR for
it. The endpoints TwinLLM actually calls, and what it reads from each, are listed in
[`docs/vitronic-endpoints.md`](vitronic-endpoints.md).

On 0.13.7 the models response is a flat map, contrary to the vendor's schema; this was
reported to VUSE XR.

## Routes

- `GET /api/vitronic/status` — configured / connected / last sync / hasAvatar / TLS pin prefix
- `POST /api/vitronic/connect` — store encrypted credentials and pin the scanner cert; upserts Self subject
- `GET/POST /api/vitronic/subjects` — list; create requires `label`, `source`, and non-empty `consentRecordedAt`, `consentBy`, `consentNote` (400 otherwise). Label hint in the UI: "not a name"
- `GET /api/vitronic/subjects/:id/scans` — all viatars for that subject's `probandId`: `{ viatarId, crtime, synced, incomplete, presetName }[]`. `synced` is true only for a **complete** snapshot (scanner: glb + markers column present; file: glb or measurements). Incomplete rows (legacy sync with no mesh / null markers) set `incomplete`. Stored file-only snapshots are included when they are not on the live list. Scanner scans expose Sync / Sync again / Re-sync; Re-sync upserts `(subjectId, viatarId)`. The live listing is best-effort: if the scanner is unreachable or does not answer within 4 s (`LIVE_SCAN_LIST_TIMEOUT_MS`), the route returns the stored snapshots only, so stored scans open with the scanner off the network.
- `GET /api/vitronic/subjects/:id/snapshots` — stored snapshots for the viewer
- `PUT /api/vitronic/subjects/:id/default` — `{ viatarId }` pins the scan the viewer opens first; `{ viatarId: null }` clears it. Only a stored snapshot of the actor's own subject can be pinned (404 otherwise). Audited as `vitronic.subjects.default` (subject id and scan number only) before the write, so a failed append changes nothing
- `POST /api/vitronic/subjects/:id/sync` — live GET per (subject, viatar); 404 when the subject is not the actor's own
- `POST /api/vitronic/subjects/:id/files` — file ingest for that subject (glb-only allowed)
- `POST /api/vitronic/sync` — empty body: isSelf newest scan; measurements JSON requires `subjectId`
- `POST /api/vitronic/upload/[connectionId]` — cloud_connect push; auth tuple vs `uploadSecretEnc`;
  401 wrong secret; 413 over 100 MiB; parser is `shape pending VUSE XR answer 3`
- `GET /api/vitronic/avatar/:snapshotId` — signed-in actor only; snapshot must belong to the actor;
  `model/gltf-binary` from disk; 401 anonymous; 404 missing / other user

## What is stored

- `VitronicConnection` — `baseUrl`, encrypted API token, encrypted upload secret,
  `probandId`, `tlsFingerprintSha256`, optional `apiTokenName`, `lastSyncAt`
- `VitronicSubject` — `label` (not a name), `source`, `isSelf`, optional `probandId`,
  consent fields, optional `defaultViatarId` (viewer preference). Unique Self via `selfForUserId`
- `VitronicSnapshot` — keyed by `(subjectId, viatarId)`; `summary` (numeric keys
  with units), `markers` / `measures` (viewer geometry), `presetName`,
  `fhirBundle` null, `glbSha256`, `glbModelName`
- Disk: gitignored `data/vitronic/<userId>/<sha256>.glb` (override with
  `VITRONIC_DATA_DIR`)

## Chat vs Digital Twin

Chat receives numeric summary keys only (`vitronic.property.*` and
`vitronic.<kind>.<path>` with a unit), and only from the **isSelf** subject's
newest snapshot. Other subjects never reach the prompt. Positions, contours, and
the mesh are never attached to a chat turn or ResponseDocument. Digital Twin: subject dropdown → scan dropdown (date, scan number, synced,
preset) → viewer. The scan list shows synced scans first, newest first, then
incomplete and unsynced ones. The viewer opens the subject's pinned default scan
(**Set as default** / **Clear default**, marked `default` in the list) while it
is still synced, otherwise the newest synced scan. The pin is a viewer
preference only: chat still reads the isSelf subject's newest snapshot. `GLTFLoader` draws the Z-up scan mesh; `OrbitControls` (three
examples, damping on, slow auto-rotate) target the bounding-box centre; marker
and measure overlays; RoomEnvironment + ACES. Scanner and file reads audit
`subject_ref` = subject id. Local Prisma reads that feed the UI or chat append
one event each (`vitronic.subjects.list`, `vitronic.snapshots.list` with
`subject_ref` = subject id, `vitronic.chat.summary` for chat,
`vitronic.wearables.summary` for the wearables page,
`vitronic.connection.status` for GET `/api/vitronic/status`); args are ids and counts. A snapshot write that names a subject the actor does not own writes nothing and appends `vitronic.write.refused` (subject id and tool only)
only (hashed), never measure values, units lists, geometry, or narrative.
Rows written before this change carry `vitronic.chat.summary` for both callers
and are never rewritten (the hash chain forbids it).

The viewer's reference-anatomy layers (muscle, skeleton, organs from donor
atlases fitted to the scan) are viewer-only: the fit, the depth and the layer
state never reach chat. See [anatomy.md](anatomy.md).

## Allowlist (GET only)

`/api/v2/viatars/`, `/api/v2/viatars/{id}`, `{heights,distances,angles,crosssections,markers,axes,properties}/`,
`/models`, `/models/{name}`, `/api/v2/system/tls/certificate` (first-connect pin).
Host source must not contain `/probands`.

## Cycle CLI (host-only, not imported by the app)

`bun run vitronic:cycle` drives scanner **writes** off-app. Default is dry-run
(prints `METHOD path` and the JSON key shape; no network write; no audit rows).
`--execute` logs in with `BODYLOOP_BASE_URL`, `BODYLOOP_USERNAME`,
`BODYLOOP_PASSWORD` using the pinned-TLS client, admin scope.
`--execute` requires `BODYLOOP_TLS_FINGERPRINT` (same source as `pinModeFromEnv`)
set to the **full SHA-256**, never the 12-char prefix `bun run vitronic:connect`
prints (`connected, fingerprint <prefix>`). Read
`VitronicConnection.tlsFingerprintSha256` yourself and paste it into
`.env.local` as `BODYLOOP_TLS_FINGERPRINT`:

```bash
docker exec twinllm-dev psql -U postgres -d postgres -t -A -c 'SELECT "tlsFingerprintSha256" FROM "vitronic_connections" WHERE "tlsFingerprintSha256" IS NOT NULL LIMIT 1;'
```

`twinllm-dev` must run `pgvector/pgvector:pg16` (same Postgres 16 on-disk format). Dump first, stop the container, start the new image on the same volume. Never delete the volume. See `docs/guidelines.md`.

If it is unset, the CLI exits before HTTP with `TLS_PIN_REQUIRED` and names
that variable. Dry-run does not require a pin.
The app read token and GET allowlist are unchanged. Never `GET /api/v2/probands*`.
Writes log as method + path only. `create-proband` sends `{ key_external }` only
and prints only `proband_id`. `create-scan` POSTs `proband_id` plus the default
parameters in `DEFAULT_VIATAR_PARAMETERS` (taken from the example scan request in the
vendor's API 0.13.7 description); shape is
`ViatarRequestSchema` in `.open-twin/packages/provider-vitronic/src/api/schemas/viatars.ts`
lines 50–106 (open-twin pin `130e3f64` has no `exampleViatarRequest`).
`start` requires `--viatar-id` ≥ 1, the typed line `yes, the person is in position`,
a 10 s countdown, then `POST /api/v2/viatars/{id}/targets/` for
`analyzed_avatar_3d`, and polls GET viatar every 5 s (target name + progress
only). Exit 0 Ready, 1 error, 2 after 10 minutes. CLI-only write allowlist:
`packages/vitronic/write-paths.ts` (app/features must not import it).

`--execute` constructs the audit port (Prisma `append` from `DATABASE_URL`, no
`server-only`) before any HTTP. If the port cannot be built, the CLI exits
non-zero before login. Scanner-read shape is
`features/vitronic/connection.ts:485-493` (tool, hashed args/results, `row_count`).
Dry-run writes no audit rows. Events (method + path template only; never
credentials, tokens, or request/response bodies):

- `vitronic.cycle.login`
- `vitronic.cycle.create_proband`
- `vitronic.cycle.create_scan`
- `vitronic.cycle.start` (targets POST)
- `vitronic.cycle.poll` (one event per poll session on every exit, including
  timeout and error: tick count, final state, exit code)

If an append fails after a scanner write succeeded, the CLI prints
`AUDIT_APPEND_FAILED` (scanner write succeeded; audit append failed) and exits
non-zero.

Typed stderr codes (no cause chains, no URLs with credentials, no tokens, no
response bodies): `TLS_PIN_MISMATCH` (`TlsPinMismatchError`), `TLS_PIN_REQUIRED`,
`LOGIN_FAILED`, `HTTP_FAILED`, `AUDIT_PORT_UNAVAILABLE`, `AUDIT_APPEND_FAILED`.

```bash
bun run vitronic:cycle create-proband --key-external <pseudonym>
bun run vitronic:cycle create-proband --key-external <pseudonym> --execute
bun run vitronic:cycle create-scan --proband-id <n>
bun run vitronic:cycle create-scan --proband-id <n> --execute
bun run vitronic:cycle start --viatar-id <n> --target analyzed_avatar_3d
bun run vitronic:cycle start --viatar-id <n> --target analyzed_avatar_3d --execute
```

Then Digital Twin → Sync on that scan (read connector).

## Env var names

App: `VITRONIC_TOKEN_ENCRYPTION_KEY`, optional `VITRONIC_DATA_DIR`, optional
`VITRONIC_SCANNER_HOSTS`.

Mint CLI (`.env.local`, never stored by the app): `BODYLOOP_BASE_URL`,
`BODYLOOP_USERNAME`, `BODYLOOP_PASSWORD`, optional `BODYLOOP_TOKEN_NAME`,
optional `BODYLOOP_TLS_FINGERPRINT` (required full SHA-256 for `vitronic:cycle --execute`; never the 12-char prefix).

Connect CLI: `VITRONIC_BASE_URL`, `VITRONIC_API_TOKEN`, `VITRONIC_PROBAND_ID`,
`LOCAL_USER_ID`.

Live scanner test (never CI): `RUN_LIVE=1`, `VITRONIC_BASE_URL`,
`VITRONIC_API_TOKEN`, `VITRONIC_PROBAND_ID`, optional `VITRONIC_TLS_FINGERPRINT`.

## Out of scope

App scanner writes, reports/PDF, `startScan` from the app, copying any real
`.glb` into git. Host-only cycle CLI is `bun run vitronic:cycle` (default dry-run).
