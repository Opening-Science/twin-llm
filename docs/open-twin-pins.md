# open-twin pins

TwinLLM consumes `@open-twin/fhir-core`, `@open-twin/fhir-r4`, `@open-twin/aggregate`,
`@open-twin/interpretation-contract`, `provider-oura`,
`provider-google-health`, `provider-whoop`, `provider-vitronic`, and the data
of `@open-twin/anchor-layer` from a **gitignored** checkout at a pinned SHA. `@open-twin/interpreter` is not pinned
(no Anchor mapper yet).

## Pin

- Repo: https://github.com/Opening-Science/open-twin
- SHA: `4b42ef944db0b461ca414b8066a5f7aa2594a9ce` (open-twin `main`, 2026-11-08; was `c37d8004d93d5accb9b91bebcbd89376837776bd`). From the old pin to this one the synced packages' `src/` is unchanged: only `package.json` bumps (`@types/node` 26.6.6, vitest 5.1.0, and `googleapis` 189.0.0 in provider-google-health). The new upstream package `reader-core` is not synced. The host keeps the resolutions already in `bun.lock` (see Lockfile note), so the app runs on the same dependency versions as before.
- Local tree: `.open-twin/` (created by `scripts/sync-open-twin.sh`)
- App deps: `file:.open-twin/packages/<name>` in `package.json`
- `anchor-layer`: only `data/anchor-layer.v1.json` is imported (its loader uses `node:fs`); see `docs/biomarkers.md`

## Route (chosen)

**C — sync + build + `file:`** (not `github:` root, not `git+…#SHA&path:…`, not tsconfig `paths` → src).

1. Shallow clone open-twin at the pin into `.open-twin/`
2. Rewrite `workspace:*` → `file:../fhir-core`, build each package `dist/`
3. Peer-pin `@open-twin/fhir-core` on the Oura, Google Health and WHOOP providers; leave fhir-r4, provider-vitronic and aggregate on `file:../fhir-core` because `@open-twin/fhir-core` is unpublished on npm; strip package-local `node_modules`
4. Host `package.json` uses `file:.open-twin/packages/…`; `postinstall` flattens nested bun symlink redirects (Turbopack)

## Sync / upgrade

Default pin (matches the default SHA in `scripts/sync-open-twin.sh`):

```bash
bun run sync:open-twin
# equivalent:
bash scripts/sync-open-twin.sh
bun install
bun run sync:verify
```

Upgrade to a new upstream SHA (also updates the checkout; then bump the default in
`scripts/sync-open-twin.sh` and the tables in this file + `PROVENANCE.md`):

```bash
bash scripts/sync-open-twin.sh <sha>
bun install
bun run sync:verify
bun run typecheck && bun run lint && bun run test && bun run build
```

CI runs `bun run sync:open-twin` before `bun install` (github.com only).

Clone-only packaging adjustments (not upstream `*.ts` edits):

- `workspace:*` → `file:../fhir-core` for the sync-time build, then `@open-twin/fhir-core` moved to `peerDependencies` for the host install
- `interpretation-contract` `build` rewritten to `tsup` only (generate script is outside the sparse checkout; `src/generated` is already committed)
- Package-local `node_modules` / `bun.lock` removed after build
- `postinstall` runs `scripts/flatten-open-twin.sh` so Turbopack never sees bun symlink redirects under fhir-r4, interpretation-contract, or the providers

Missing package exports are reached from `infrastructure/open-twin-adapters/` via relative imports into `.open-twin/.../src/` (see host adapters). File upstream issues below rather than patching the clone.

## Host adapters

TwinLLM-only behaviour lives under `infrastructure/open-twin-adapters/`. Code outside the folder imports one entry per vendor (`oura.ts`, `whoop.ts`, `google-health.ts`, `aggregate.ts` under `@/infrastructure/open-twin-adapters/`), never a file behind them, so an Oura route does not load Google's auth library; lint (`twin-llm/wearable-entry` and the layer rules) enforces this, so replacing the adapters touches this folder only:

- `oura.ts` / `oura-authorize.ts` — `HostOuraTokenHandler.lastTokens()`; re-export `getAuthorizationUrl` from `.open-twin/packages/provider-oura/src/api/client`
- `oura-bundle.ts` — `buildOuraFhirBundle` over `buildOuraBundle` from `.open-twin/packages/provider-oura/src/fhir/bundleBuilder`, so a sync builds the bundle from the data it already fetched instead of calling every endpoint twice
- `whoop.ts` — `fetchWhoopWindow` / `buildWhoopFhirBundle` over the public barrel (`getWhoopData`, `buildWhoopBundleFromPayload`); no longer needs `fetchWhoopSyncPayload` or any `.open-twin/.../src` import
- `whoop-workout.ts` — workout schema, paginated `GET /v2/activity/workout` fetch and `mapWhoopWorkoutsToFHIR`, appended to the upstream bundle by `withWhoopWorkouts`; uses only the public `@open-twin/fhir-core` barrel. Belongs upstream (request 7)
- `google-health.ts` — `setGoogleHealthCredentials` / `getGoogleHealthCredentials` / `ensureGoogleHealthAccessToken`; re-exports `buildGoogleHealthFhirBundle`
- `google-health-bundle.ts` — `buildGoogleHealthFhirBundle` over `buildBundleFromResponses` from the public barrel, with the person's shared subject (`person-subject.ts`) and the Patient it points at; the sync fetches with `getDataTypes` and builds from those responses
- `aggregate.ts` — `aggregateWearableBundles` over `aggregate` from `@open-twin/aggregate`: one subject's Oura, WHOOP and Google Health bundles as one, overlaps reconciled on published evidence. No screen reads it yet: the screens combine the sources only as summary keys, by the fixed order in `VITAL_ANATOMY` (Oura, then WHOOP, then Google Health; first source with data wins, sources never mixed), and aggregate takes no caller order. At this pin it also finds no overlap between the three connectors (request 8). Aggregate refuses Observations under more than one subject, so the person's Patient is carried once, with each connector's identifier (`mergePersonPatients`)
- `person-subject.ts` — one subject per person (#476). Upstream keeps the connector in its patient id (`patientUuid(connector, subjectKey)`), so the host passes the Oura, WHOOP and Google Health builders their `subject` option: `urn:uuid:` UUIDv5 of the host's subject key under the host namespace `uuidv5("twin-llm/person")`, never a connector or vendor id. `withPersonPatient` adds the Patient it points at, with the connector's identifier, and links a Patient the connector built itself (Oura `personal_info`, still under its per-connector id); Observation ids and bundle tags still carry the connector
- BodyLoop — host Bearer client in `packages/vitronic/` plus `buildBundleFromVitronicResponse` from the public barrel. The mapper now binds D15 SI units (`m` / `m2` / `m3` / `kg` / `kg/m2`); TwinLLM still does not persist `fhirBundle` and does not call `createBodyLoopClient` (password grant + `/probands`).

## Upstream issues to file

### 1. provider-oura: export TokenHandler.getTokens() for durable host persistence ([open-twin#169](https://github.com/Opening-Science/open-twin/issues/169))

- **In scope:** Add a getter returning the current access/refresh token pair after auth/refresh.
- **Out of scope:** Encryption, database storage, host session management.
- **Minimal diff:** ~10 lines on `packages/provider-oura/src/utils/tokenUtils.ts` + unit test.
- **Status:** landed in this pin (`getTokens()` returns the pair plus an absolute `expiresAt`; `setTokens(tokens, expiresAt?)`). Its name clashed with the host method, so the host one is now `lastTokens()` with unchanged behaviour. Switching the host to upstream `getTokens()` / `expiresAt` is a follow-up.

### 2. provider-google-health: public restore/persist credential helpers ([open-twin#171](https://github.com/Opening-Science/open-twin/issues/171))

- **In scope:** Public `setCredentials` / `getCredentials` / `ensureAccessToken` (or equivalent) on `GoogleHealthClient`.
- **Out of scope:** Host DB encryption, multi-tenant token stores.
- **Minimal diff:** ~40 lines on `packages/provider-google-health/src/api/client.ts` + tests.

### 3. provider-oura: export getAuthorizationUrl via package exports + build ([open-twin#170](https://github.com/Opening-Science/open-twin/issues/170))

- **In scope:** Add `./api/client` to `exports` and the tsup build entry (or re-export from the barrel) so hosts can import `getAuthorizationUrl` without reaching into `src/`.
- **Out of scope:** OAuth UX / redirect URI policy.
- **Minimal diff:** `package.json` exports + build script; optional barrel re-export.
- **Status:** landed in this pin (`getAuthorizationUrl(config, state?)` on the public barrel). The host adapter still imports `.open-twin/packages/provider-oura/src/api/client` and appends `state`; switching to the barrel is a follow-up.

### 4. provider-whoop: export fetchWhoopSyncPayload from package barrel ([open-twin#172](https://github.com/Opening-Science/open-twin/issues/172))

- **In scope:** Re-export `fetchWhoopSyncPayload` from `packages/provider-whoop/src/index.ts` (symbol already exists in `utils/fetchWhoopData.ts`).
- **Out of scope:** FHIR mapping / pagination changes.
- **Minimal diff:** one export line.
- **Status:** host uses the public `getWhoopData` (`index.ts`) instead; this becomes a documentation request — state that `getWhoopData` is the supported entry point. The Whoop README at this pin says so, and the Whoop `TokenHandler` gained the same `getTokens()` (unused by the host).

### 5. provider-vitronic: BodyLoop properties and lists are SI

- **Status:** landed in this pin (open-twin #181). Exact `property_path` keys emit UCUM `m` / `m2` / `m3` / `kg` / `kg/m2`; unknown paths stay unitless. Host HTTP, TLS pinning, and display conversion stay on TwinLLM. TwinLLM still does not persist `fhirBundle` for Vitronic snapshots.

### 6. provider-oura: export buildOuraBundle from the barrel

- **In scope:** Re-export `buildOuraBundle` (`src/fhir/bundleBuilder.ts`) from `src/index.ts`, so a host that already called `getOuraData` can map without a second fetch.
- **Out of scope:** Mapper or schema changes.
- **Minimal diff:** one export line.
- **Status:** host imports it from `src/` through `oura-bundle.ts` until it lands.

### 7. provider-whoop: workouts

- **In scope:** A `WhoopWorkoutSchema`, `WHOOP_PATHS.workout = '/activity/workout'`, a `workouts` field on `WhoopSyncPayload` fetched by `fetchWhoopSyncPayload`, and a `mapWhoopWorkoutToFHIR` mapper called from `buildWhoopBundle`. `read:workout` is already in `WHOOP_SCOPES`.
- **Out of scope:** Host summary keys and display.
- **Minimal diff:** port `infrastructure/open-twin-adapters/whoop-workout.ts` (schema, fetch, mapper) into the package, with LOINC `41981-2` added to the terminology allowlist for this connector.
- **Status:** host fetches and maps workouts itself until it lands; drop `whoop-workout.ts` then.

### 8. aggregate: see the overlaps the connectors actually emit

- **In scope:** `measureOf` reads `Observation.code` only. Oura and Google Health put sleep duration (LOINC 93832-4) in a sleep panel's components, Oura puts steps (41950-7), lowest heart rate (103222-6) and SpO2 in components too, and WHOOP's HRV and SpO2 use WHOOP-local codes, so one night or day from two connectors is never grouped; with today's builders `reconciliations` is always empty. Read components, or map the panels and local codes, and add WHOOP findings to `reliability.ts`.
- **Also wanted:** an optional caller order for ties and abstentions, so a host can keep a fixed source order on screen while recording aggregate's evidence choice beside it.
- **Out of scope:** Host display.
- **Status:** host aggregates all three without selecting anything; `features/wearables/aggregate-bundles.test.ts` fails on purpose once a same-night overlap is found.

## Verify

```bash
bun run sync:verify   # LOINC codes, provider symbols, anchor-layer sha256 sidecar
```

## Lockfile note

A fresh resolve of the `file:` providers fails: their peer `@open-twin/fhir-core@0.1.0`
is looked up on npm (404). `bun install` therefore keeps the providers' nested
dependency resolutions already in `bun.lock` (zod 4.6.5, ucum-lhc 7.1.9 at this pin,
while upstream package.json files ask for 4.6.7 / 7.1.10, patch releases).
Deleting the `@open-twin/*` lock entries to force a refresh breaks the install.
