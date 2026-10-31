# Lab

`/lab` (Lab in the sidebar) is one place to see what runs on this machine and to check it. Closed
cloud health apps describe their privacy and attestation, but nobody outside can repeat the check.
TwinLLM runs locally, so each claim it makes about itself can be tested here and then repeated by
hand with the command on the card.

The page has three sections: Verifiability, Simulations and Results. Research use only: nothing on
the page is about anyone's health.

## Verifiability

Each check runs on the server when the page loads (`features/lab/run-lab-checks.ts`) and hands what
it found to a pure function that decides the status (`features/lab/*-check.ts`, each with a test).
A card says OK, Not OK or Unknown in words, shows the evidence, and gives a shell command that
repeats the check without the app. A check that cannot run shows Unknown with a plain sentence; the
reason goes to the server log only.

| Check                      | What it proves                                                                                                                                                                                                                                                                                                                                                                                | What it does not prove                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local only                 | Whether `LOCAL_ONLY` is on, the chat provider, and for each configured service (chat models, Carbon-X, GBD, PostHog, Clerk, Arcjet, and the Oura, Whoop and Google Health syncs) whether it runs on this machine. A wearable app that is set counts as off this machine even with `LOCAL_ONLY` on, since the switch does not turn syncs off. Names and switches only; no key or URL is shown. | That nothing else leaves the machine. The check reads the configuration, not the network ([providers.md](providers.md#local-only-mode)).                                                                                                                                                                                                                         |
| Audit chain                | The audit rows hash correctly in `seq` order and each points at the one before. The page reads them in pages of 2,000, gives the server a turn between pages and reads at most 50,000 rows per load (`features/lab/audit-chain-walk.ts`); a longer log is checked over several loads and says how far it got. Shows rows checked, the first broken row and the latest hash checked.           | Rows this server has already checked are not read again while it runs, so a change to an older row shows up after a restart or with the command, which reads every row. Removing the newest rows leaves a shorter chain that still holds; note the latest hash and compare it later. Someone with write access to the database can also rebuild the whole chain. |
| Local models               | Whether `OLLAMA_BASE_URL` is this machine, and the models Ollama lists there (`/api/tags`) with digest, size and family. An address on another machine is Not OK whether or not it answers. The command reads the same address (host, port and path only). The digest's start is the ID `ollama list` prints.                                                                                 | Where the weights came from, or that they are the published ones. The digest identifies what Ollama holds; compare it with the registry yourself.                                                                                                                                                                                                                |
| Pinned artefacts           | SHA-256 of the Synthea JAR, the evaluation cohort archive (`eval-cohort-v1`) and the seven anatomy files, against the pins in `infrastructure/local-artefacts.ts` and `packages/anatomy/`. Each file has its own row: Matches, Differs, Not on this machine, or Could not read (no permission, or removed while read).                                                                        | That the pins themselves are right; they are recorded in `PROVENANCE.md` and the release notes. A rigged body baked on this machine may differ in the last bits of a float, so a different hash there is Unknown.                                                                                                                                                |
| Provenance                 | The app version, git commit, whether the tree was clean, and the open-twin pin and checkout, all as they were when the server was built (`next.config.ts`), against the checkout on disk now. A checkout that moved since the build says a rebuild is needed. A failed `git status` is Unknown, never clean.                                                                                  | That the running code is that commit beyond what the build recorded. Under `bun run dev` the server serves edits as they are saved, so the card is Unknown there; build and start the app to check it.                                                                                                                                                           |
| Software bill of materials | Whether `bun run sbom` has written `.sbom/twin-llm.cdx.json`, its component count and SHA-256, and whether it is byte for byte what the current `bun.lock` and `package.json` give. If not, it says which changed: the package list (bun.lock) or the name and version (package.json).                                                                                                        | That the packages are free of known flaws. Feed the file to a scanner of your choice for that.                                                                                                                                                                                                                                                                   |

None of this is remote attestation. Every check is this machine reporting on itself, so it shows a
careful person what to look at and how to repeat it; it cannot prove anything to someone who does
not trust the machine. Paths on the page are relative to the repository root. A folder set outside
it is written as its variable (`$ANATOMY_DATA_DIR`, `$SYNTHEA_JAR`), so no home path is shown, and
the command first reads that one setting from `.env.local` into the shell without printing it.

If a check cannot run, its card keeps the same title and command as the working card, so the
command still repeats it by hand.

## Simulations

Simulated heart rhythm recordings of synthetic people (#252), made by `packages/rhythm-sim` the same
way the `rhythm_irregularity` tool makes them ([query-layer.md](query-layer.md#rhythm-irregularity),
[rhythm-sim.md](rhythm-sim.md)). Synthetic mode only: with `DATA_MODE=personal` the section says it
is for synthetic people and reads nothing.

- **The form** is a plain GET form, so a recording has a link (`/lab?subject=…&date=…&seconds=…&recording=…`)
  that makes it again. It lists the synthetic people of the pinned evaluation cohort
  (`synthea-v4-seed42`) in this database, first by `subject_ref` and marked when their record lists
  atrial fibrillation (SNOMED CT `49436004`); a day (empty means the last observation day); a length
  from 30 to 600 s; and a recording number from 1 to 1000. `parseSimulationForm` checks the fields.
- **Same code path.** The server calls `runLabRhythmRecording` (`packages/query-tools/rhythm-tools.ts`):
  the tool's scope check, observation span and condition read, then `describeRecording`, audited as
  `lab.rhythm_recording` with the number of intervals. It also returns the plan, which the page uses to
  make the same recording again to draw it. The tool takes 180 to 600 s; the Lab goes down to the
  simulator's 30 s, and a recording under one 128-interval window shows its tachogram and the
  tool's `WINDOW_TOO_SHORT` refusal as a sentence instead of metrics.
- **What it shows.** The RR tachogram (interval against seconds from the first beat, the windows the
  research flag marks shaded), the first 10 s of the pulse-wave proxy, the metrics per window with the
  recording's totals, the research thresholds with their sources (nRMSSD and the turning-point ratio
  after Dash et al. 2009, in the flag; Shannon entropy reported, not applied; sample entropy after
  Richman and Moorman 2000, reported only), and the FHIR Observation from `recordingObservation` in a
  disclosure, with its start at midnight UTC of the recording day. Downloads: the intervals and the
  window metrics as CSV, the Observation as FHIR JSON.
- **Simulator settings (known because this person is simulated).** The rhythm setting, AF episodes,
  share of intervals made in AF, premature beats, whether the Synthea record has AF that day, the
  subject's rates and variability and the seed (`rhythmGroundTruth` and the recording's config). This
  is the researcher's view; the tool's output to a model never holds any of it.
- **Wording.** The copy describes the recording and the research flag, never a person.

The shaping is pure (`features/lab/simulation-view.ts`, tested); the reads are in
`load-simulation.ts`. The charts use the shared chart helpers in `infrastructure/charts/` (moved there
from the Data page so both pages can use them) and the chart colour tokens.

## Results

Evaluation runs and benchmark results found on this machine (#252). Every table has a "Download CSV"
for a paper's tables and figures (`infrastructure/csv.ts`; a cell that a spreadsheet would run as a
formula gets a leading `'`). Only files inside the repository are read, each at most 2 MB.

- **Evaluation runs.** Each folder in `evaluation/runs/` (gitignored, written by `bun run eval`;
  [evaluation/harness.md](evaluation/harness.md)), newest 100: run id, date, kind (run, replay or mock),
  models, selection and line and error counts from `meta.json`, and from `report.md` each model's pass
  rates per criterion and scenario as the report prints them (passes over pass + fail with the Wilson 95 %
  interval in whole percent; not recomputed). Both files are read leniently: a run without a report says
  so. `results.jsonl`, `review.csv` and `review-key.json` are never opened. With no runs the section
  says so and shows the commands that make one.
- **Rhythm benchmark.** The newest `result.json` under `.rhythm-bench/` (`RHYTHM_BENCH_DIR` in
  `infrastructure/local-artefacts.ts`, gitignored), by its `generatedAt`. `bun run rhythm-bench -- --out
.rhythm-bench/<run>` writes it ([rhythm-sim.md](rhythm-sim.md#benchmark)); the page reads the
  benchmark's own file, with no copy in another shape. It shows three tables, each with its CSV: the
  research flag's sensitivity and specificity and the AUROC of each metric on simulated windows (all,
  windows of one rhythm only, by length, rhythm, AF rate and noise), the same on the database the run
  read, MIT-BIH Atrial Fibrillation Database (`--afdb`) or Long-Term AF Database (`--ltafdb`), by
  dominant reference rhythm, and the distances
  between simulated and database windows (Wasserstein-1 over the database SD, Kolmogorov-Smirnov,
  medians). Values are shown to three decimals with their 95 % bootstrap interval; the CSVs keep
  the file's numbers. `features/lab/benchmark-result.ts` reads only the fields it shows, and its test
  runs the benchmark on a small grid and parses the output, so a change to the file's shape fails
  there. With no run the section says "Not run yet" and shows the command.

## Commands

```bash
# Local only: the same switches and service list as the card, names only
bun run lab:local-only

# Audit chain, every row (read-only). Exit 0 OK, 1 broken, 2 no rows, 64 bad flags
bun --env-file=.env.local packages/audit/verify-cli.ts --check

# Software bill of materials: hash the file first, then compare with a fresh one
sha256sum .sbom/twin-llm.cdx.json
fresh="$(mktemp)" && bun run sbom --out "$fresh" && sha256sum "$fresh"

# Models and pinned files (the cards print the exact lines for this machine)
ollama list
sha256sum .synthea/cache/synthea-with-dependencies.jar data/anatomy/*.glb
```

`--check` cannot be combined with `--seed-ok` or `--expect-broken`.

## SBOM

`bun run sbom` (`scripts/sbom/write.ts`, `infrastructure/cyclonedx.ts`) reads `bun.lock` and
`package.json` and writes CycloneDX 1.6 JSON with no extra tool. Every package the lockfile
resolves is listed once, with its package URL and the lockfile's integrity hash as hex SHA-512. The
open-twin packages are local `file:` packages with no registry hash; their path is kept as a
property. `bun run sbom --out <path>` writes the file somewhere else, which the Lab card's command
uses so it never overwrites the file it is checking. The file has no timestamp or serial number, so the same lockfile always gives the same
bytes. The lockfile covers development tools as well as what the app ships, so the list is longer
than the running app needs.

## Pins written once

The Synthea JAR version, URL and SHA-256 and the evaluation archive live in
`infrastructure/local-artefacts.ts`; the default Ollama address lives in
`infrastructure/ollama-context.ts`. `scripts/synthea/generate-local.sh` is plain bash, so it reads
the JAR pin from `scripts/synthea/synthea-pin.sh`, which `bun run synthea:pin` writes from the
TypeScript constants. `infrastructure/pinned-constants.test.ts` fails if that file is stale or if
the hash or the Ollama port is written anywhere else in the source.
