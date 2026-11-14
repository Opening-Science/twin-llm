# open-twin packages

TwinLLM carries copies of `@open-twin/fhir-core`, `@open-twin/fhir-r4`, `@open-twin/aggregate`,
`provider-oura`, `provider-google-health`, `provider-whoop`, and the data of
`@open-twin/anchor-layer` in `packages/open-twin/`, taken from
[open-twin](https://github.com/Opening-Science/open-twin) at one commit and kept as
upstream wrote them (MIT; licence, what was copied and what was changed: `PROVENANCE.md`).
`@open-twin/interpreter`, `interpretation-contract`, `provider-vitronic` and `reader-core`
are not copied: nothing in the app imports them.

## Where it lives

- Base commit: `4b42ef944db0b461ca414b8066a5f7aa2594a9ce` (open-twin `main`, 2026-11-08), per package in `packages/open-twin/UPSTREAM.json`
- `packages/open-twin/<name>/`: upstream's `src/` and `README.md`, its `LICENSE`, and a `package.json` adapted to this repository (`private`, `exports` pointing at `src/index.ts`, dependencies pinned to what `bun.lock` already resolved)
- `packages/open-twin/MANIFEST.sha256`: sha256 of every file kept as upstream wrote it
- Bun workspaces (`packages/open-twin/*`) under their `@open-twin/*` names, so the 48 upstream files that import `@open-twin/fhir-core` and the host imports stay as they are. Each package keeps its own dependencies: provider-google-health runs on `googleapis` 181.0.0 and `@googleapis/health` 6.0.0 while the app uses 173.0.0 and 2.0.0. `bunfig.toml` keeps Bun's hoisted `node_modules` layout.
- Next compiles the six code packages from source (`transpilePackages` in `next.config.ts`)
- `anchor-layer`: only `data/anchor-layer.v1.json` is imported; see `docs/biomarkers.md`

## Rules

- Do not edit `packages/open-twin/`. Fixes go to open-twin first and come back by merge. ESLint and Prettier leave the folder alone; upstream formats with biome.
- Host-only behaviour stays in `infrastructure/open-twin-adapters/`.
- An urgent local fix is allowed only with a line in the PROVENANCE "Changes since import" log and the manifest updated in the same commit.

## Checks

```bash
bun run open-twin:verify   # manifest, UPSTREAM.json, LOINC codes, provider symbols, anchor-layer sha256 sidecar
bun run test:open-twin     # upstream's own tests, under vitest, one process per package
```

Upstream's tests use `vi.mocked`, `vi.setSystemTime` and `vi.stubGlobal`, which Bun's
test runner does not have, so they run under vitest (`scripts/open-twin/test.ts`, one
shared config in `scripts/open-twin/vitest.config.ts`). Bare `bun test` skips the folder
(`pathIgnorePatterns` in `bunfig.toml`); CI runs `test:open-twin` as its own job.

## Taking in later upstream changes

In an open-twin clone, for each package to bring forward from its base in `UPSTREAM.json`:

```bash
git diff <base> <new> --relative=packages/<name> -- src README.md \
  | git -C ../twin-llm apply --3way --directory=packages/open-twin/<name>
```

Then update that package's `base` and `imported` in `UPSTREAM.json`, rewrite
`MANIFEST.sha256` (`cd packages/open-twin && find . -type f ! -name package.json ! -name UPSTREAM.json ! -name MANIFEST.sha256 ! -path '*/node_modules/*' | sed 's|^\./||' | LC_ALL=C sort | xargs sha256sum > MANIFEST.sha256`), add a line to the PROVENANCE log, compare the upstream `package.json` dependencies with ours, and run `typecheck`, `test:open-twin`, `test` and `build`.

The first likely merge is the Google Health reader branch (`257-google-health-reader`, with the new `reader-core`); `reader-core` comes in only when a host import needs it.

## Leftover `.open-twin/` checkouts

Before this, the packages were synced into a gitignored `.open-twin/`. `bun run doctor` flags one that is left over. Remove it with `rm -rf .open-twin node_modules/@open-twin && bun install`; where `.open-twin` is a symlink, run `rm .open-twin` with no trailing slash, since `rm -rf .open-twin/` follows the link.

## Host adapters

TwinLLM-only behaviour lives under `infrastructure/open-twin-adapters/`. Code outside the folder imports one entry per vendor (`oura.ts`, `whoop.ts`, `google-health.ts`, `aggregate.ts` under `@/infrastructure/open-twin-adapters/`), never a file behind them, so an Oura route does not load Google's auth library; lint (`twin-llm/wearable-entry` and the layer rules) enforces this, so replacing the adapters touches this folder only:

- `oura.ts` / `oura-authorize.ts` — `HostOuraTokenHandler.lastTokens()`; `getAuthorizationUrl` over the public barrel, adding `state`
- `oura-bundle.ts` — `buildOuraFhirBundle` over `buildOuraBundle` from `packages/open-twin/provider-oura/src/fhir/bundleBuilder`, so a sync builds the bundle from the data it already fetched instead of calling every endpoint twice
- `whoop.ts` — `fetchWhoopWindow` / `buildWhoopFhirBundle` over the public barrel (`getWhoopData`, `buildWhoopBundleFromPayload`); no longer needs `fetchWhoopSyncPayload` or any import from a package's `src/`
- `whoop-workout.ts` — workout schema, paginated `GET /v2/activity/workout` fetch and `mapWhoopWorkoutsToFHIR`, appended to the upstream bundle by `withWhoopWorkouts`; uses only the public `@open-twin/fhir-core` barrel. Belongs upstream (request 7)
- `google-health.ts` — `setGoogleHealthCredentials` / `getGoogleHealthCredentials` / `ensureGoogleHealthAccessToken`; re-exports `buildGoogleHealthFhirBundle`
- `google-health-bundle.ts` — `buildGoogleHealthFhirBundle` over `buildBundleFromResponses` from the public barrel, with the person's shared subject (`person-subject.ts`) and the Patient it points at; the sync fetches with `getDataTypes` and builds from those responses
- `aggregate.ts` — `aggregateWearableBundles` over `aggregate` from `@open-twin/aggregate`: one subject's Oura, WHOOP and Google Health bundles as one, overlaps reconciled on published evidence. No screen reads the bundle yet. The same file's `judgeByEvidence` reads aggregate's `selectSource` and fhir-core's `reliabilityFor` for the wearable source rules (#464, [wearable-sources.md](wearable-sources.md)), which resolve overlapping summary keys per measure and day; vitals the rules do not compare still take the first source in `VITAL_ANATOMY`. At this pin it also finds no overlap between the three connectors (request 8). Aggregate refuses Observations under more than one subject, so the person's Patient is carried once, with each connector's identifier (`mergePersonPatients`)
- `person-subject.ts` — one subject per person (#476). Upstream keeps the connector in its patient id (`patientUuid(connector, subjectKey)`), so the host passes the Oura, WHOOP and Google Health builders their `subject` option: `urn:uuid:` UUIDv5 of the host's subject key under the host namespace `uuidv5("twin-llm/person")`, never a connector or vendor id. `withPersonPatient` adds the Patient it points at, with the connector's identifier, and links a Patient the connector built itself (Oura `personal_info`, still under its per-connector id); Observation ids and bundle tags still carry the connector
- BodyLoop — host Bearer client in `packages/vitronic/`. `provider-vitronic` is not copied; TwinLLM does not persist `fhirBundle` and does not call `createBodyLoopClient` (password grant + `/probands`).

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
- **Status:** landed in this pin (`getAuthorizationUrl(config, state?)` on the public barrel). The host adapter imports it from the barrel and appends `state`.

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

### 9. provider-oura: re-export OuraRingAppConfig as a type

- **In scope:** `src/index.ts` line 20, `export { OuraRingAppConfig }` → `export type { OuraRingAppConfig }`. It is an interface, so a consumer that compiles the source one file at a time (Bun, Next, `tsc` with `isolatedModules`) sees a re-export of a name that does not exist, and the barrel fails to load.
- **Minimal diff:** one keyword.
- **Status:** made locally (PROVENANCE "Changes since import"); drop it at the next merge once upstream has it.
