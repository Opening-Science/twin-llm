# Contributing to TwinLLM

Thanks for your interest. TwinLLM is research software that handles health data, so the
rules below are stricter than in most projects. Read [`README.md`](README.md), including
**Intended use**, before you start.

Security issues are not reported here: follow [`SECURITY.md`](SECURITY.md).

## Before you write code

- **Open an issue first**, or comment on an existing one, and wait for a maintainer to
  agree on the approach. Pull requests without an agreed issue may be closed.
- **One concern per pull request.** Keep refactors, formatting and dependency bumps out of
  feature PRs.
- Do not add features that give medical advice, name a disease, interpret results for a
  person or recommend a regimen. They are outside TwinLLM's intended use and will not be
  merged.

## Setup

Follow **Run it locally** in the README (`bun run setup:local`). Use **bun** (`bun.lock`); do not add
`pnpm-lock.yaml` or `package-lock.json`. Run with `DATA_MODE=synthetic` unless you are
working on your own wearable data on your own machine.

`bun install` installs the Husky hooks: `pre-commit` runs lint-staged and `pre-push` runs
the typecheck.

## Branches and commits

- Fork the repository and branch from current `main` as `<issue>-<slug>`, for example
  `212-whoop-sleep-stages`. Do not stack a branch on another open pull request.
- **Sign off every commit** (`git commit -s`) with your real name and an email you
  control. The sign-off certifies the [Developer Certificate of Origin](https://developercertificate.org/):
  you wrote the change or have the right to submit it under the project's licence.
- Write commit subjects as `type(#issue): summary`, for example
  `fix(#212): keep missing sleep stages as null`.

## Licence of contributions

Contributions are accepted under the licence in [`LICENSE`](LICENSE) for TwinLLM original
work. Third-party code, data, models or assets need a compatible licence and an entry in
[`NOTICE`](NOTICE) and [`PROVENANCE.md`](PROVENANCE.md). Do not copy code from sources
that publish no licence.

## Data and secrets

- **Never commit real data**: no wearable records, scans, genomes, FHIR bundles from real
  people, raw vendor API responses or participant identifiers, not even "anonymised"
  ones. Fixtures are synthetic.
- **Never commit secrets**: no tokens, keys, cookies, OAuth payloads or `.env*` values.
  `.env.local` stays local; only `.env.example` and `.env.synthetic.example` are tracked.
- Keep the privacy posture in the README: personal context goes only to Ollama, or to
  Exoscale with `EXOSCALE_PERSONAL_DATA=consented-pilot`. OpenRouter, the remote GPU and
  legacy Infomaniak are permitted only with `DATA_MODE=synthetic` and no wearable
  snapshot. Error messages carry no
  provider response bodies.
- Missing is not zero: an absent measurement stays absent, never `0`.

## Code and tests

- Tests assert exact values, not counts or truthiness. A test written for a fix should
  fail on `main`.
- Inject dependencies into the code under test. `mock.module` is banned in new tests,
  because its replacements leak into later files in the same bun process. Pass fakes into
  a handler factory (see `createWearablesSummaryHandler`). `bunfig.toml` preloads the
  `server-only` stub; do not stub it in a test file.
- Do not edit `.open-twin/`. Those packages are synced from
  [open-twin](https://github.com/Opening-Science/open-twin) at the SHA in `OPEN_TWIN_SHA`
  (`bun run sync:open-twin`); send fixes upstream. Do not invent LOINC or UCUM codes.
- Database migrations are additive and nullable unless the issue agrees otherwise.
  Maintainers run every `prisma migrate` and deploy command.
- Update every doc your change makes wrong.

## Claim lint

`bun run lint:claims` scans `app/**`, `features/**` and `packages/biomarkers/**` string
literals plus `README.md` and `docs/**/*.md` for banned copy stems listed in
`scripts/lint-claims.ts`. Rephrase rather than allowlist. Exceptions in
`docs/claims-allowlist.json` (`{file, line-pattern, reason}`) need a maintainer's
agreement.

## Checks before you push

```bash
bun run typecheck
bun run lint
bun test
bun run test:isolation
bun run lint:claims
bunx prisma generate
gitleaks detect --source . --no-git --config .gitleaks.toml
```

CI runs the same jobs plus `prisma` (migration check against Postgres) and `ark-app`.
Workflows from forks may wait for a maintainer to approve them before they run.

## How changes land

TwinLLM works trunk-based: `main` is always releasable, and every change reaches it through
a short-lived branch and one pull request.

- One issue, one branch, one pull request. Aim to merge within a few days; split larger
  work into small pull requests, and keep unfinished behaviour behind a setting rather than
  on a long-lived branch.
- Open a **draft** pull request early if you want feedback. Mark it ready for review when
  CI is green.
- Keep your branch current with `main` (GitHub's "Update branch" button, or a merge of
  `main`). Required checks must pass on the up-to-date branch.
- Pull requests are **squash-merged**, so the pull request title becomes the commit on
  `main`. Write it like a commit subject: `type(#issue): summary`, where `type` is one of
  `feat`, `fix`, `docs`, `refactor`, `test`, `chore` or `perf`.
- `main` is protected: no direct pushes, no force pushes, signed commits, required review
  and checks.

## Releases

TwinLLM follows [Semantic Versioning](https://semver.org/). Until 1.0, a minor version
(`0.x.0`) may change behaviour; a patch version (`0.x.y`) only fixes.

- Planned work is grouped in a [milestone](https://github.com/Opening-Science/twin-llm/milestones)
  per release.
- A maintainer releases by tagging `main` (`vX.Y.Z`), adding the release to
  [`CHANGELOG.md`](CHANGELOG.md) from the squashed commit titles, and publishing the GitHub
  release. Tags matching `v*` are protected and never move.
- If a released version needs a fix after `main` has moved on, the fix lands on `main`
  first and is then cherry-picked onto a `release/X.Y` branch cut from the tag, which is
  tagged `vX.Y.Z+1`.
- Database changes ship as Prisma migrations; deployments apply them with
  `bunx prisma migrate deploy`. Release notes name any manual step.

## Pull requests

Describe what changed, how you checked it and what is still limited, in a few lines.
Link the issue (`Closes #123`). Keep the PR small enough to review in one sitting.

A maintainer reviews every pull request; `.github/CODEOWNERS` says who reviews which
paths. Reviews check, with file and line evidence:

1. **Scope**: every changed file belongs to the issue; no drive-by edits.
2. **Behaviour**: each "unchanged behaviour" claim holds when old and new code are
   compared.
3. **Tests**: exact values; the new test fails on `main`.
4. **Secrets and data**: none, anywhere: code, tests, fixtures, logs, errors or docs.
5. **Privacy posture**: personal data paths as above; subject data reads audited; missing
   is not zero.
6. **Interop**: no edits under `.open-twin/`; no invented LOINC or UCUM.
7. **Migrations**: additive and nullable; `bun run db:verify` passes.
8. **Docs**: updated where the change invalidates them.
9. **Commits**: signed off, one concern each.
10. **Body scan data**: the chat prompt receives only numeric `vitronic.*` keys with
    units and a fixed narrative, never stored narrative, positions, contours, markers or
    mesh.

Maintainers merge. Contributors do not merge, force-push shared branches or change
repository settings.

Maintainers merge with `scripts/merge-green.sh <pr> [<pr> ...]`, never a bare loop. It
merges one pull request at a time and only when it targets `main`, merges cleanly, is up
to date with `main`, and every check on its head commit ran and passed. After each merge
it waits for `main`'s CI on the new commit to finish green before the next one. A pending,
cancelled, failed or missing check stops it.

## Maintainers

For a change to product behaviour, write the plan in the issue and implement it only after
it is agreed. Maintainers work one issue, one branch, one worktree, each with its own dev
server port, as in [`docs/runbook.md`](docs/runbook.md) under "Parallel worktrees".
